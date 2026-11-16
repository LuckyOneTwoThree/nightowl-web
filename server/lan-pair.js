/**
 * 隔离临时局域网配对 & 「回被窝接力」微服务器
 *
 * 绝对安全边界（Strict Isolation）：
 *   1. 主业务服务 server/index.js 保持 100% 绑定 127.0.0.1 不变；
 *   2. 本微服务器默认不启动，仅用户主动点击时临时创建独立 http.Server（120 秒硬编码 TTL 自动销毁）；
 *   3. 严格白名单：只挂载 GET /pair/info、POST /pair/sync、GET /pair/handoff 三个路由，
 *      其余任何路径（尤其 /api/proxy 等代理端点）全部返回 404，绝不充当局域网代理！
 */

import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { buildSyncBundle, mergeSyncBundles } from '../src/core/sync-bundle.js';

export const PAIR_TTL_MS = 120_000;
export const PAIR_MAX_BODY_BYTES = 256 * 1024;
export const PAIR_BODY_TIMEOUT_MS = 10_000;
const MAX_PIN_ATTEMPTS = 5;
const MAX_TOKEN_ATTEMPTS = 20;

function safeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const VIRTUAL_IFACE_RE = /^(utun|tun|tap|wg|tailscale|docker|br-|veth|vboxnet|vmnet|wsl|vethernet|loopback|lo)/i;

function scoreLanCandidate(ifaceName, ip) {
  const isVirtual = VIRTUAL_IFACE_RE.test(String(ifaceName || '')) || ip.startsWith('169.254.') || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
  let subnetScore = 1;
  if (ip.startsWith('192.168.')) subnetScore = 30;
  else if (ip.startsWith('10.')) subnetScore = 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) subnetScore = 10;
  return (isVirtual ? 0 : 100) + subnetScore;
}

/**
 * 列出本机局域网候选 IPv4（物理网卡与常见私有网段优先，过滤或降权虚拟隧道/容器网卡）
 */
export function listLanCandidates() {
  const ifaces = os.networkInterfaces();
  const entries = [];
  for (const [ifaceName, list] of Object.entries(ifaces)) {
    for (const info of list || []) {
      if (!info || info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      entries.push({ ip: info.address, score: scoreLanCandidate(ifaceName, info.address) });
    }
  }
  entries.sort((a, b) => b.score - a.score);
  return [...new Set(entries.map(e => e.ip))];
}

/**
 * 探测本机最合适的局域网 IPv4（未联网时回退 127.0.0.1）
 */
export function detectLanIp() {
  const candidates = listLanCandidates();
  return candidates[0] || '127.0.0.1';
}

/**
 * 脱敏桌面端线路：绝不下发 127.0.0.1/api/proxy 地址给手机，标注 proxyRequired 与 isDirect 供手机端直连起播或重抓
 */
export function sanitizeHandoffLines(rawLines = []) {
  if (!Array.isArray(rawLines)) return [];
  const out = [];
  for (const line of rawLines) {
    if (!line || !line.url) continue;
    const rawUrl = String(line.url);
    const label = String(line.name || line.label || '线路');
    const id = line.id ? String(line.id) : label;
    const kind = line.kind ? String(line.kind) : 'm3u8';
    if (rawUrl.includes('/api/proxy') || rawUrl.includes('127.0.0.1')) {
      let originUrl = rawUrl;
      try {
        const parsed = new URL(rawUrl, 'http://127.0.0.1');
        originUrl = parsed.searchParams.get('url') || rawUrl;
      } catch {
        originUrl = rawUrl;
      }
      out.push({
        id,
        name: label,
        label,
        url: originUrl.startsWith('http') ? originUrl : null,
        kind,
        isDirect: false,
        proxyRequired: true
      });
    } else {
      const proxyRequired = Boolean(line.proxyRequired);
      const isDirect = !proxyRequired && line.isDirect !== false;
      out.push({
        id,
        name: label,
        label,
        url: rawUrl,
        kind,
        isDirect,
        proxyRequired
      });
    }
  }
  return out;
}

function sendJson(res, status, data) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = PAIR_MAX_BODY_BYTES, timeoutMs = PAIR_BODY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(val);
    };
    const timer = setTimeout(() => {
      finish(Object.assign(new Error('Request body timeout'), { status: 408 }));
      try {
        req.destroy();
      } catch {}
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    req.on('data', chunk => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        finish(Object.assign(new Error('Payload too large'), { status: 413 }));
        try {
          req.destroy();
        } catch {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        finish(null, raw ? JSON.parse(raw) : {});
      } catch {
        finish(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', err => finish(err));
    req.on('aborted', () => finish(Object.assign(new Error('Request aborted'), { status: 400 })));
  });
}

/**
 * 创建隔离配对微服务器管理器
 */
export function createLanPairManager() {
  let active = null;

  async function stopSession() {
    if (!active) return;
    const current = active;
    active = null;
    if (current.timer) clearTimeout(current.timer);
    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(fallbackTimer);
        resolve();
      };
      const fallbackTimer = setTimeout(finish, 500);
      if (typeof fallbackTimer.unref === 'function') fallbackTimer.unref();
      try {
        current.server.closeIdleConnections?.();
        current.server.close(() => finish());
        current.server.closeAllConnections?.();
      } catch {
        finish();
      }
    });
  }

  function getStatus() {
    if (!active) return { active: false };
    const now = Date.now();
    if (now >= active.expiresAt) return { active: false };
    return {
      active: true,
      mode: active.mode,
      host: active.displayHost,
      candidates: active.candidates || [active.displayHost],
      port: active.port,
      pin: active.pin,
      token: active.token,
      pairUri: active.pairUri,
      expiresAt: active.expiresAt,
      ttlRemainingMs: Math.max(0, active.expiresAt - now),
      handoffMatchId: active.handoff?.matchId || null
    };
  }

  async function startSession({
    bindHost = '0.0.0.0',
    displayHost = null,
    port = 0,
    ttlMs = PAIR_TTL_MS,
    mode = 'sync',
    getLocalBundle = () => buildSyncBundle({}),
    onMergedBundle = null,
    handoff = null
  } = {}) {
    await stopSession();

    const candidates = listLanCandidates();
    const resolvedDisplayHost = displayHost || (bindHost !== '0.0.0.0' ? bindHost : candidates[0] || '127.0.0.1');
    const token = crypto.randomBytes(12).toString('hex');
    const pin = String(crypto.randomInt(100000, 1000000));
    const effectiveTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, PAIR_TTL_MS) : PAIR_TTL_MS;
    const cleanHandoff = handoff
      ? {
          matchId: String(handoff.matchId || ''),
          title: String(handoff.title || ''),
          lines: sanitizeHandoffLines(handoff.lines || [])
        }
      : null;

    let failedPinAttempts = 0;
    let failedTokenAttempts = 0;
    let authRevoked = false;
    let syncChain = Promise.resolve();
    const runSerialized = fn => {
      const next = syncChain.then(fn, fn);
      syncChain = next.catch(() => {});
      return next;
    };

    const verifyAuth = (searchParams, req) => {
      const qToken = searchParams.get('token') || req.headers['x-pair-token'] || '';
      const qPin = searchParams.get('pin') || req.headers['x-pair-pin'] || '';

      if (qPin) {
        const pinOk = safeEqualText(String(qPin), pin);
        const tokenOk = !qToken || safeEqualText(String(qToken), token);
        if (pinOk && tokenOk) return { ok: true, revoke: false };
        failedPinAttempts += 1;
        const revoke = failedPinAttempts >= MAX_PIN_ATTEMPTS;
        if (revoke) authRevoked = true;
        return { ok: false, revoke };
      }
      if (qToken) {
        if (safeEqualText(String(qToken), token)) return { ok: true, revoke: false };
        failedTokenAttempts += 1;
        const revoke = failedTokenAttempts >= MAX_TOKEN_ATTEMPTS;
        if (revoke) authRevoked = true;
        return { ok: false, revoke };
      }
      return { ok: false, revoke: false };
    };

    const server = http.createServer(async (req, res) => {
      try {
        // 原生手机客户端不走浏览器 CORS；显式拒绝跨域预检，防局域网恶意网页探测端口
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Cache-Control': 'no-store' });
          res.end();
          return;
        }

        let urlObj;
        try {
          urlObj = new URL(req.url || '/', 'http://127.0.0.1');
        } catch {
          sendJson(res, 400, { ok: false, error: 'Bad Request' });
          return;
        }
        const pathname = urlObj.pathname;

        // 严格路由白名单：除 3 个 /pair/* 路由外全部 404
        if (
          pathname !== '/pair/info' &&
          pathname !== '/pair/sync' &&
          pathname !== '/pair/handoff'
        ) {
          sendJson(res, 404, { ok: false, error: 'Not Found' });
          return;
        }

        const sessionRef = active;
        if (!sessionRef || authRevoked || Date.now() >= sessionRef.expiresAt || sessionRef.server !== server) {
          await stopSession();
          sendJson(res, 410, { ok: false, error: '配对会话已过期，请在桌面端重新生成' });
          return;
        }

        const auth = verifyAuth(urlObj.searchParams, req);
        if (!auth.ok) {
          sendJson(res, 401, { ok: false, error: '配对口令或 Token 无效' });
          if (auth.revoke) {
            setImmediate(() => {
              void stopSession();
            });
          }
          return;
        }

        if (pathname === '/pair/info' && req.method === 'GET') {
          const rawLocal = await getLocalBundle();
          const local = buildSyncBundle(rawLocal || {});
          sendJson(res, 200, {
            ok: true,
            mode: sessionRef.mode,
            expiresAt: sessionRef.expiresAt,
            ttlRemainingMs: Math.max(0, sessionRef.expiresAt - Date.now()),
            summary: {
              followedTeams: local.prefs.followedTeams.length,
              watchLaterCount: local.watchLater.length,
              revealedCount: local.revealedIds.length,
              diaryCount: Object.keys(local.diary.entries).length
            },
            hasHandoff: Boolean(cleanHandoff?.matchId)
          });
          return;
        }

        if (pathname === '/pair/handoff' && req.method === 'GET') {
          if (!cleanHandoff || !cleanHandoff.matchId) {
            sendJson(res, 404, { ok: false, error: '当前桌面端未发起接力播控' });
            return;
          }
          sendJson(res, 200, { ok: true, handoff: cleanHandoff });
          return;
        }

        if (pathname === '/pair/sync' && req.method === 'POST') {
          try {
            const remoteBody = await readJsonBody(req, PAIR_MAX_BODY_BYTES);
            const merged = await runSerialized(async () => {
              if (!active || active.server !== server) {
                throw Object.assign(new Error('配对会话已结束'), { status: 410 });
              }
              const rawLocal = await getLocalBundle();
              const localBundle = buildSyncBundle(rawLocal || {});
              const nextMerged = mergeSyncBundles(localBundle, remoteBody, Date.now());
              if (typeof onMergedBundle === 'function') {
                await onMergedBundle(nextMerged);
              }
              return nextMerged;
            });
            sendJson(res, 200, { ok: true, merged });
          } catch (err) {
            sendJson(res, err?.status || 400, {
              ok: false,
              error: String(err?.message || '同步数据包无效')
            });
          }
          return;
        }

        sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      } catch (err) {
        sendJson(res, err?.status || 500, { ok: false, error: '配对服务内部异常' });
      }
    });
    server.requestTimeout = PAIR_BODY_TIMEOUT_MS + 2000;
    server.headersTimeout = 5000;

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, bindHost, () => resolve());
    });

    const addr = server.address();
    const listeningPort = typeof addr === 'object' && addr ? addr.port : port;
    const pairUri = `nightowl://pair?host=${encodeURIComponent(resolvedDisplayHost)}&port=${listeningPort}&token=${token}&mode=${mode === 'handoff' ? 'handoff' : 'sync'}`;
    const expiresAt = Date.now() + effectiveTtl;

    const timer = setTimeout(() => {
      void stopSession();
    }, effectiveTtl);
    if (typeof timer.unref === 'function') timer.unref();

    active = {
      server,
      timer,
      mode: mode === 'handoff' ? 'handoff' : 'sync',
      displayHost: resolvedDisplayHost,
      candidates: candidates.length ? candidates : [resolvedDisplayHost],
      port: listeningPort,
      token,
      pin,
      pairUri,
      expiresAt,
      handoff: cleanHandoff
    };

    return getStatus();
  }

  return {
    startSession,
    stopSession,
    getStatus
  };
}
