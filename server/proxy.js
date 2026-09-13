/**
 * 直播流代理
 *
 * 职责：剥掉防盗链、重写 M3U8 里全部 URI、分片流式转发。
 *
 * 硬约束（《开工前技术检查清单》Step 2 / PRD §8）：
 *   1. 流转发必须用 `Readable.fromWeb(upstream.body).pipe(res)`
 *      —— Node 原生 fetch 返回的是 WHATWG ReadableStream，**没有 .pipe()**
 *         （实测 Node v22 / v26 均抛 `TypeError: b.pipe is not a function`）
 *   2. 仅监听 127.0.0.1（由 index.js 保证）
 *   3. 目标域名白名单：不在名单里一律拒绝，不做开放代理
 *   4. 请求头白名单：只放行 Range / Accept 等必要字段，不透传任意头
 *   5. 透传 Content-Type；**支持 Range 请求**（拖动与分片必需）
 *   6. 查询串完整透传（签名 URL 会过期，丢参数就 403）
 *   7. 缓存分级：m3u8 索引不缓存；分片长缓存
 *   8. 并发上限 + 单请求超时
 *   9. 失败语义：区分「上游无源」与「网络失败」，后者不缓存、不闩锁
 *  10. 流式转发，不做内存驻留（单场 1080p 数据量在 GB 级）
 */

import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rewritePlaylist, isPlaylistResponse, cacheControlFor } from './m3u8.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadRules() {
  return JSON.parse(readFileSync(resolve(__dirname, 'rules.json'), 'utf8'));
}

/** 失败语义：区分「上游确实没有」与「我们这边没连上」 */
export class ProxyError extends Error {
  constructor(kind, message, status = 502) {
    super(message);
    this.kind = kind; // 'blocked' | 'bad-request' | 'upstream-absent' | 'network'
    this.status = status;
  }
}

/** 域名是否在白名单内 */
export function isHostAllowed(hostname, rules, sessionAllowed = null) {
  const p = rules.proxy || {};
  const exact = p.allowedHosts || [];
  const suffixes = p.allowedHostSuffixes || [];
  return (
    exact.includes(hostname) ||
    suffixes.some(s => {
      const clean = s.startsWith('.') ? s.slice(1) : s;
      return hostname === clean || hostname.endsWith(`.${clean}`);
    }) ||
    (sessionAllowed ? sessionAllowed.has(hostname) : false)
  );
}

/** 是否为合法主机名（防止把整段 URL 或路径塞进来） */
export function isValidHost(h) {
  return typeof h === 'string' && h.length > 0 && h.length <= 253 && /^[a-z0-9.-]+$/i.test(h) && !h.startsWith('.');
}

/** 只挑白名单里的请求头回传上游 */
function pickHeaders(incoming, rules) {
  const allow = new Set((rules.proxy?.forwardHeaders || []).map(h => h.toLowerCase()));
  const out = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (allow.has(k.toLowerCase()) && v != null) out[k] = String(v);
  }
  return out;
}

/** 并发闸门 */
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < max) {
        active++;
        return;
      }
      await new Promise(r => queue.push(r));
      active++;
    },
    release() {
      active--;
      const next = queue.shift();
      if (next) next();
    },
    get active() {
      return active;
    }
  };
}

/**
 * 创建代理实例
 *
 * @param {object} rules 外置规则
 * @param {object} log
 * @param {Set<string>} sessionAllowed 会话级白名单
 *
 * 会话级授权的设计意图：
 *   代理的硬要求是"不做开放代理"。但用户**手动提供一条直链**时，其域名不可能预先写进
 *   rules.json。因此提供「用户本机会话内显式授权」：前端在播放前 POST /api/proxy/allow
 *   声明该域名，服务端加入**内存 Set**（不写盘、重启即失效、上限 50 个）。
 *   这样既不是开放代理（需显式授权 + 仅 127.0.0.1 可达），又能正常使用。
 *
 * 会话级请求头：
 *   很多源站校验收看来源（Referer）或登录态（Cookie）。用户从浏览器 DevTools
 *   「Copy as cURL」拿到的正是这些头。这里允许用户在授权时一并提交，**仅存内存**，
 *   且只作用于其声明的那个域名。
 *   ⚠️ 用户提交的是**自己的**会话信息，仅发往其指定的域名，不落盘、不外发。
 */
export function createProxy(rules = loadRules(), log = console, sessionAllowed = new Set()) {
  const gate = createSemaphore(rules.proxy?.maxConcurrent || 16);
  const MAX_SESSION_HOSTS = 50;
  const sessionHeaders = new Map(); // host -> { Referer?, Cookie? }

  const allowHost = (host, headers = null) => {
    if (!isValidHost(host)) return { ok: false, reason: '非法主机名' };
    if (sessionAllowed.has(host) && !headers) return { ok: true, already: true };
    if (!sessionAllowed.has(host) && sessionAllowed.size >= MAX_SESSION_HOSTS) {
      return { ok: false, reason: `会话白名单已达上限（${MAX_SESSION_HOSTS}）` };
    }
    sessionAllowed.add(host);

    if (headers && typeof headers === 'object') {
      const clean = {};
      for (const k of ['Referer', 'Cookie', 'Origin']) {
        const v = headers[k];
        if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
      }
      if (Object.keys(clean).length) sessionHeaders.set(host, clean);
    }
    return { ok: true };
  };

  /** 拉取上游（带超时）；命中重定向时跟随（fetch 默认 follow） */
  async function fetchUpstream(target, incomingHeaders, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      // 优先级：用户会话头 > 请求自带（白名单内）> rules 里的上游头
      const custom = sessionHeaders.get(new URL(target).hostname) || {};
      return await fetch(target, {
        headers: {
          ...(rules.proxy?.upstreamHeaders || {}),
          ...incomingHeaders,
          ...custom
        },
        redirect: 'follow',
        signal: ac.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 处理一次 /api/proxy 请求
   * @param {URLSearchParams} query 形如 { url: 'https://...' }
   */
  async function handle(query, req, res) {
    const raw = query.get('url');
    if (!raw) throw new ProxyError('bad-request', '缺少 url 参数', 400);

    let target;
    try {
      target = new URL(raw);
    } catch {
      throw new ProxyError('bad-request', 'url 参数不是合法地址', 400);
    }

    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new ProxyError('bad-request', `不支持的协议 ${target.protocol}`, 400);
    }

    if (!isHostAllowed(target.hostname, rules, sessionAllowed)) {
      throw new ProxyError('blocked', `目标域名不在白名单：${target.hostname}`, 403);
    }

    const timeoutMs = rules.proxy?.timeoutMs || 15000;
    await gate.acquire();

    // 释放必须幂等：一条请求存在多条退出路径（上游失败 / 空 body / M3U8 写回 / 流结束 / 异常），
    // 直接各处调 gate.release() 会重复扣减。实测 health 里 active 变成了 -12，
    // 一旦为负，`active < max` 恒成立，并发闸门等于失效。
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      gate.release();
    };

    let upstream;
    try {
      upstream = await fetchUpstream(target.toString(), pickHeaders(req.headers, rules), timeoutMs);
    } catch (err) {
      releaseOnce();
      const msg = err?.name === 'AbortError' ? `上游超时（${timeoutMs}ms）` : `连接上游失败：${err?.message || err}`;
      // 网络失败不缓存、不闩锁 —— 下次请求照常重试
      throw new ProxyError('network', msg, 504);
    }

    try {
      const contentType = upstream.headers.get('content-type') || '';

      /* ---- 上游无源：明确区别于网络失败 ---- */
      if (!upstream.ok) {
        releaseOnce();
        const kind = upstream.status === 404 || upstream.status === 410 ? 'upstream-absent' : 'network';
        throw new ProxyError(kind, `上游返回 ${upstream.status}`, upstream.status === 404 ? 404 : 502);
      }

      /* ---- M3U8：必须整体读出并重写 ---- */
      if (isPlaylistResponse(contentType, target.pathname + target.search)) {
        const buf = await readLimited(upstream, rules.proxy?.maxPlaylistBytes || 4194304);
        const raw = Buffer.from(buf).toString('utf8');
        const finalBaseUrl = upstream.url || target.toString();
        const { text } = rewritePlaylist(raw, finalBaseUrl);

        res.writeHead(200, {
          'Content-Type': contentType || 'application/vnd.apple.mpegurl',
          'Cache-Control': cacheControlFor(finalBaseUrl, contentType),
          'Access-Control-Allow-Origin': '*',
          'Content-Length': Buffer.byteLength(text)
        });
        res.end(text);
        releaseOnce();
        return;
      }

      /* ---- 分片 / 其它媒体：流式转发，零内存驻留 ---- */
      const headers = {
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': cacheControlFor(target.toString(), contentType),
        'Access-Control-Allow-Origin': '*'
      };
      // Range 相关响应头必须透传，否则拖动会失败
      for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const v = upstream.headers.get(h);
        if (v) headers[h.replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase())] = v;
      }

      res.writeHead(upstream.status, headers);

      if (!upstream.body) {
        res.end();
        releaseOnce();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on('error', err => {
        log.warn?.(`[proxy] 流转发中断：${err.message}（${target.hostname}）`);
        res.destroy();
      });
      res.on('close', () => {
        nodeStream.destroy();
        releaseOnce();
      });

      nodeStream.pipe(res);
    } catch (err) {
      releaseOnce();
      if (err instanceof ProxyError) throw err;
      throw new ProxyError('network', `转发失败：${err?.message || err}`, 502);
    }
  }

  return {
    handle,
    gate,
    rules,
    allowHost,
    sessionAllowed,
    isAllowed: h => isHostAllowed(h, rules, sessionAllowed)
  };
}

/** 限制读取体积，防止上游返回超大 body 撑爆内存 */
async function readLimited(response, maxBytes) {
  const chunks = [];
  let total = 0;
  const reader = response.body?.getReader?.();
  if (!reader) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) throw new ProxyError('network', 'playlist 体积超限', 502);
    return ab;
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ProxyError('network', 'playlist 体积超限', 502);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
