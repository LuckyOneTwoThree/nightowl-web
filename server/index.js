/**
 * 本地服务入口
 *
 * 职责：静态资源托管 + /api/proxy 流代理 + /api/scores 保鲜。
 *
 * 硬边界（PRD §1.3）：**仅监听 127.0.0.1**，绝不 0.0.0.0，不对外暴露。
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname, normalize } from 'node:path';
import { createProxy, loadRules, ProxyError, allowedLocalOrigin } from './proxy.js';
import { syncScores, applyPatches, validateFixtures } from './scores.js';
import { getLiveSourcesForMatch } from './scraper.js';
import { loadFixtures, saveFixtures, freshness } from './data-store.js';
import { resolveHighlights } from './highlights.js';
import { resolveLive } from './live.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.m3u8': 'application/vnd.apple.mpegurl'
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/** 静态文件；找不到则回落到 index.html（前端单页） */
async function serveStatic(pathname, res) {
  if (!existsSync(DIST)) {
    sendJSON(res, 503, {
      error: 'dist 不存在',
      hint: '先执行 `npm run build`，或在开发模式下直接访问 Vite 的 5173 端口'
    });
    return;
  }

  // 防目录穿越：normalize 后必须仍在 DIST 内
  // decodeURIComponent 对 /%zz 这类非法百分号编码会抛 URIError（实测），
  // 落到通用 catch 会返回 500 —— 是客户端的坏请求，给 404 更准确
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    sendJSON(res, 404, { error: '非法路径编码', path: pathname });
    return;
  }
  let filePath = join(DIST, rel);
  if (!filePath.startsWith(DIST)) {
    sendJSON(res, 403, { error: '非法路径' });
    return;
  }

  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(DIST, 'index.html');
  }

  try {
    const buf = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length
    });
    res.end(buf);
  } catch {
    sendJSON(res, 404, { error: 'not found', path: pathname });
  }
}

/**
 * 读取并解析 JSON 请求体（限长，避免被大 body 打爆）
 *
 * ⚠️ 限长必须按**字节**而不是字符串长度：多字节字符（中文 3 字节、emoji 4 字节）
 *    在 JS 字符串里只占 1-2 个码元，按 .length 限长实际允许的体积是上限的 2-3 倍。
 */
function readJsonBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += Buffer.byteLength(c);
      chunks.push(c);
      if (total > limit) {
        reject(new Error('请求体超出限制'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks).toString('utf8');
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function createServer(rules = loadRules(), log = console, deps = {}) {
  // 依赖注入：让集成测试可以用假数据验证端点语义，而不是真的联网 + 写盘。
  // 生产调用（server/index.js 直接运行、electron/main.cjs）不传 deps，行为不变。
  const syncScoresImpl = deps.syncScores || syncScores;
  const loadFixturesImpl = deps.loadFixtures || loadFixtures;
  const saveFixturesImpl = deps.saveFixtures || saveFixtures;
  const resolveHighlightsImpl = deps.resolveHighlights || resolveHighlights;
  const resolveLiveImpl = deps.resolveLive || resolveLive;
  const backgroundSync = deps.backgroundSync !== false;

  const proxy = createProxy(rules, log);
  let syncing = false;
  let lastSync = null;

  /**
   * 来源校验：浏览器跨域请求不认「只绑 127.0.0.1」这个限制，
   * 任意外部网页原本可以驱动本服务的写接口（授权主机 / 触发同步）。
   * 只放行本机回环来源（见 proxy.js 的 allowedLocalOrigin）。
   * 同源请求与非浏览器请求不带 Origin，直接放行。
   */
  const rejectForeignOrigin = (req, res) => {
    if (req.headers.origin && !allowedLocalOrigin(req, rules)) {
      sendJSON(res, 403, { error: `来源不在允许列表：${req.headers.origin}（仅允许本机回环来源）` });
      return true;
    }
    return false;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const { pathname, searchParams } = url;

    try {
      /* ---------------- 健康检查 ---------------- */
      if (pathname === '/api/health') {
        sendJSON(res, 200, {
          ok: true,
          listening: `${rules.listen.host}:${rules.listen.port}`,
          proxy: {
            allowedHosts: rules.proxy?.allowedHosts?.length || 0,
            allowedHostSuffixes: rules.proxy?.allowedHostSuffixes?.length || 0,
            sessionAllowedHosts: proxy.sessionAllowed.size,
            session: proxy.sessionStats,
            activeRequests: proxy.gate.active,
            queuedRequests: proxy.gate.queued,
            maxConcurrent: rules.proxy?.maxConcurrent
          },
          scores: {
            enabled: rules.scores?.enabled !== false,
            syncing,
            lastSync
          },
          highlights: {
            enabled: rules.highlights?.enabled !== false
          },
          live: {
            enabled: rules.live?.enabled !== false
          }
        });
        return;
      }

      /* ---------------- 会话级域名授权 ---------------- */
      if (pathname === '/api/proxy/allow' && req.method === 'POST') {
        // 外部网页原本可以跨域调用本接口把任意主机写进会话白名单
        // （预检此前无脑放行，实测确认）。必须校验来源。
        if (rejectForeignOrigin(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const list = Array.isArray(body.hosts) ? body.hosts : [body.host];
          const result = [];
          for (const h of list.filter(Boolean)) {
            const r = proxy.allowHost(h, body.headers || null);
            result.push({ host: h, ...r });
          }
          sendJSON(res, 200, {
            ok: result.every(r => r.ok),
            results: result,
            sessionCount: proxy.sessionAllowed.size,
            note: `自定义请求头仅存于本机会话内存，不写盘、重启失效；授权 ${Math.round(
              proxy.sessionStats.ttlMs / 3600000
            )} 小时后自动回收`
          });
        } catch (err) {
          sendJSON(res, 400, { error: `解析请求体失败：${err.message}` });
        }
        return;
      }

      /* ---------------- 会话授权回收 ---------------- */
      if (pathname === '/api/proxy/revoke' && req.method === 'POST') {
        if (rejectForeignOrigin(req, res)) return;
        try {
          const body = await readJsonBody(req);
          if (body.all === true) {
            const r = proxy.revokeAll();
            sendJSON(res, 200, { ok: true, ...r, sessionCount: proxy.sessionAllowed.size });
          } else if (body.host) {
            const r = proxy.revokeHost(body.host);
            sendJSON(res, 200, { ok: true, ...r, sessionCount: proxy.sessionAllowed.size });
          } else {
            const pruned = proxy.pruneSessions();
            sendJSON(res, 200, { ok: true, pruned, sessionCount: proxy.sessionAllowed.size });
          }
        } catch (err) {
          sendJSON(res, 400, { error: `解析请求体失败：${err.message}` });
        }
        return;
      }

      /* ---------------- 流代理 ---------------- */
      if (pathname === '/api/proxy') {
        if (req.method === 'OPTIONS') {
          // 只放行本机回环来源；外部来源的预检直接拒绝，actual request 也就发不出来
          if (req.headers.origin && !allowedLocalOrigin(req, rules)) {
            sendJSON(res, 403, { error: '来源不在允许列表（仅允许本机回环来源）' });
            return;
          }
          // 允许的头取自转发白名单 + POST body 需要的 content-type，不再无脑回 *
          const acah = [...(rules.proxy?.forwardHeaders || []), 'content-type']
            .map(h => h.toLowerCase())
            .join(', ');
          const preflightHeaders = {
            'Access-Control-Allow-Headers': acah,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            Vary: 'Origin'
          };
          const origin = allowedLocalOrigin(req, rules);
          if (origin) preflightHeaders['Access-Control-Allow-Origin'] = origin;
          res.writeHead(204, preflightHeaders);
          res.end();
          return;
        }
        await proxy.handle(searchParams, req, res);
        return;
      }

      /* ---------------- 保鲜 ---------------- */
      // 数据新鲜度：界面据此显示「数据更新于 X · 落后 N 场待录」，
      // 而不是让用户误以为应用坏了
      if (pathname === '/api/scores/status' && req.method === 'GET') {
        if (rejectForeignOrigin(req, res)) return;
        try {
          const fixtures = await loadFixturesImpl();
          const fresh = freshness(fixtures);
          sendJSON(res, 200, {
            ok: true,
            syncing,
            freshness: fresh,
            lastSync,
            note: fresh.writable
              ? '可写数据目录已就绪，支持在应用内同步比分'
              : '当前没有可写的数据目录（纯预览模式），同步结果不会保存'
          });
        } catch (err) {
          sendJSON(res, 500, { error: String(err?.message || err) });
        }
        return;
      }

      // 当前生效的赛程数据（前端启动时拉取，用于把静态快照热更新为最新数据）
      if (pathname === '/api/fixtures' && req.method === 'GET') {
        if (rejectForeignOrigin(req, res)) return;
        try {
          const fixtures = await loadFixturesImpl();
          sendJSON(res, 200, {
            ok: true,
            count: fixtures.length,
            freshness: freshness(fixtures),
            fixtures
          });
        } catch (err) {
          sendJSON(res, 500, { error: String(err?.message || err) });
        }
        return;
      }

      /* ---------------- 赛后集锦 ---------------- */
      if (pathname === '/api/highlights' && req.method === 'GET') {
        if (rejectForeignOrigin(req, res)) return;
        const matchId = searchParams.get('matchId') || '';
        try {
          const fixtures = await loadFixturesImpl();
          const match = fixtures.find(m => m.id === matchId);
          if (!match) {
            sendJSON(res, 404, { ok: false, videos: [], error: '比赛不存在' });
            return;
          }
          if (match.st !== 'done') {
            sendJSON(res, 200, { ok: false, videos: [], reason: 'not-finished' });
            return;
          }
          const force = searchParams.get('refresh') === '1';
          const result = await resolveHighlightsImpl(match, { rules, log, force });
          sendJSON(res, 200, { matchId, ...result });
        } catch (err) {
          sendJSON(res, 500, { ok: false, videos: [], error: String(err?.message || err) });
        }
        return;
      }

      /* ---------------- 实时比分与关键事件 ---------------- */
      if (pathname === '/api/live' && req.method === 'GET') {
        if (rejectForeignOrigin(req, res)) return;
        const matchId = searchParams.get('matchId') || '';
        try {
          const fixtures = await loadFixturesImpl();
          const match = fixtures.find(m => m.id === matchId);
          if (!match) {
            sendJSON(res, 404, { ok: false, error: '比赛不存在' });
            return;
          }
          const force = searchParams.get('refresh') === '1';
          const result = await resolveLiveImpl(match, { rules, log, force });
          sendJSON(res, 200, { matchId, ...result });
        } catch (err) {
          sendJSON(res, 500, { ok: false, error: String(err?.message || err) });
        }
        return;
      }

      /* ---------------- 赛后回顾（与实时同一份 ESPN 解析，只对已完赛开放） ---------------- */
      if (pathname === '/api/recap' && req.method === 'GET') {
        if (rejectForeignOrigin(req, res)) return;
        const matchId = searchParams.get('matchId') || '';
        try {
          const fixtures = await loadFixturesImpl();
          const match = fixtures.find(m => m.id === matchId);
          if (!match) {
            sendJSON(res, 404, { ok: false, error: '比赛不存在' });
            return;
          }
          if (match.st !== 'done') {
            sendJSON(res, 200, { ok: false, reason: 'not-finished', events: [] });
            return;
          }
          const force = searchParams.get('refresh') === '1';
          const result = await resolveLiveImpl(match, { rules, log, force });
          sendJSON(res, 200, { matchId, ...result });
        } catch (err) {
          sendJSON(res, 500, { ok: false, events: [], error: String(err?.message || err) });
        }
        return;
      }

      if (pathname === '/api/scores/sync' && req.method === 'POST') {
        if (rejectForeignOrigin(req, res)) return;
        if (rules.scores?.enabled === false) {
          sendJSON(res, 503, { error: '保鲜模块已禁用（rules.scores.enabled=false）' });
          return;
        }
        if (syncing) {
          sendJSON(res, 409, { error: '已有同步任务进行中' });
          return;
        }
        syncing = true;
        const startedAt = Date.now();
        try {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (err) {
            // 非法/超长请求体是客户端问题，不能静默降级成 dry-run 后回 200。
            sendJSON(res, 400, { error: `解析请求体失败：${err.message}` });
            return;
          }
          // apply=true 时写回用户数据目录；否则只预览（保持旧行为）
          const apply = body?.apply === true || searchParams.get('apply') === '1';
          const allMonths = body?.allMonths === true || searchParams.get('all') === '1';
          const months = body?.months || (searchParams.get('months') ? searchParams.get('months').split(',') : null);
          const backfillDays = Number(body?.backfillDays ?? searchParams.get('backfill') ?? 0) || 0;
          const fixtures = await loadFixturesImpl();
          const result = await syncScoresImpl({ fixtures, rules, months, allMonths, backfillDays, log });

          let written = null;
          let nextFixtures = null;
          if (apply && result.patches.size > 0) {
            const { fixtures: next, changed } = applyPatches(fixtures, result.patches);
            const issues = validateFixtures(next);
            if (issues.length) {
              // 与 CLI 一致：校验不通过就绝不写盘，宁可这次不同步
              written = { ok: false, reason: '校验未通过，已放弃写盘', issues: issues.slice(0, 5) };
            } else {
              const saved = saveFixturesImpl(next) || { ok: false, reason: '写盘结果缺失' };
              written = { ...saved, changed };
              // 只有真正写盘成功才把新数据回传前端。
              // 否则前端会拿未落盘的比分替换内存数据 —— 界面显示已更新，重启后却回滚。
              if (saved.ok === true) nextFixtures = next;
            }
          } else if (apply) {
            written = { ok: true, changed: 0, note: '没有需要写入的补丁' };
          }

          lastSync = {
            at: new Date().toISOString(),
            ms: Date.now() - startedAt,
            patches: result.patches.size,
            attempted: result.attempted !== false,
            applied: !!apply && written?.ok === true,
            written,
            errors: result.errors.length,
            stats: result.stats,
            bySource: result.bySource
          };
          sendJSON(res, 200, {
            ok: true,
            dryRun: !apply,
            summary: lastSync,
            fixtures: nextFixtures,
            conflicts: result.conflicts.slice(0, 20),
            incompleteScore: (result.incompleteScore || []).slice(0, 20),
            unmatchedCount: result.unmatched.length,
            patches: [...result.patches.entries()].slice(0, 50).map(([id, p]) => ({ id, ...p }))
          });
        } catch (err) {
          sendJSON(res, 500, { error: String(err?.message || err) });
        } finally {
          syncing = false;
        }
        return;
      }

      /* ---------------- 观赛源注册表 ---------------- */
      if (pathname === '/api/watch-sources') {
        if (rejectForeignOrigin(req, res)) return;
        try {
          const reg = JSON.parse(await readFile(resolve(ROOT, 'server/watch-sources.json'), 'utf8'));
          sendJSON(res, 200, {
            official: reg.official || [],
            watch: reg.watch || []
          });
        } catch (err) {
          sendJSON(res, 500, { error: `注册表读取失败：${err.message}` });
        }
        return;
      }

      /* ---------------- 自动赛事直播源 ---------------- */
      if (pathname === '/api/live-sources') {
        // 该接口会联网抓取并自动授权代理域名，必须校验来源，不能只依赖回环绑定。
        if (rejectForeignOrigin(req, res)) return;
        const matchId = searchParams.get('matchId') || '';
        const h = searchParams.get('h') || '';
        const a = searchParams.get('a') || '';
        const date = searchParams.get('date') || '';
        const t = searchParams.get('t') || '';

        try {
          const result = await getLiveSourcesForMatch({ matchId, h, a, date, t });

          // 自动将抓取到的各线路域名授权给当前代理会话，无需用户手动登记
          for (const line of result.lines || []) {
            try {
              if (line.url && (line.url.startsWith('http://') || line.url.startsWith('https://'))) {
                const u = new URL(line.url);
                proxy.allowHost(u.hostname);
              }
            } catch {}
          }

          sendJSON(res, 200, result);
        } catch (err) {
          log.warn?.(`[scraper] 获取直播源失败: ${err.message}`);
          sendJSON(res, 500, { ok: false, error: err.message, lines: [] });
        }
        return;
      }

      /* ---------------- 静态资源 ---------------- */
      // 未匹配的 /api/* 必须回 404：回落 index.html 会让客户端把坏路径当成功解析。
      if (pathname.startsWith('/api/')) {
        sendJSON(res, 404, { error: 'not found', path: pathname });
        return;
      }
      await serveStatic(pathname, res);
    } catch (err) {
      if (err instanceof ProxyError) {
        log.warn?.(`[proxy] ${err.kind}: ${err.message}`);
        sendJSON(res, err.status, { error: err.message, kind: err.kind });
        return;
      }
      log.error?.('[server] 未捕获错误:', err);
      if (!res.headersSent) sendJSON(res, 500, { error: String(err?.message || err) });
      else res.destroy();
    }
  });

  /** 合并后台多阶段同步的结果：任一阶段的错误/写盘失败都不能被后一阶段覆盖掉。 */
  const combineSyncStages = infos => {
    const list = infos.filter(Boolean);
    if (!list.length) return null;
    const bySource = {};
    const stats = {};
    for (const info of list) {
      for (const [key, value] of Object.entries(info.bySource || {})) {
        const current = bySource[key] || { events: 0, requests: 0, ok: 0, failed: 0 };
        bySource[key] = {
          events: current.events + (value.events || 0),
          requests: current.requests + (value.requests || 0),
          ok: current.ok + (value.ok || 0),
          failed: current.failed + (value.failed || 0)
        };
      }
      for (const [key, value] of Object.entries(info.stats || {})) {
        if (typeof value === 'number') stats[key] = (stats[key] || 0) + value;
      }
    }
    const errors = list.reduce((sum, info) => sum + (info.errors || 0), 0);
    const patches = list.reduce((sum, info) => sum + (info.patches || 0), 0);
    const changed = list.reduce((sum, info) => sum + (info.written?.changed || 0), 0);
    const failedWrites = list.filter(info => info.written?.ok === false);
    return {
      at: new Date().toISOString(),
      ms: list.reduce((sum, info) => sum + (info.ms || 0), 0),
      patches,
      attempted: list.some(info => info.attempted !== false),
      applied: list.some(info => info.applied),
      written: failedWrites.length
        ? { ok: false, changed, reason: failedWrites[0].written.reason || '写盘失败' }
        : { ok: true, changed },
      errors,
      error: list.map(info => info.error).filter(Boolean).join('；') || undefined,
      stats,
      bySource
    };
  };

  /** 执行一轮同步并落盘；返回下一阶段应使用的 fixtures 与本阶段结果。 */
  const runSyncStage = async (fixtures, sources, label) => {
    const startedAt = Date.now();
    const result = await syncScoresImpl({ fixtures, rules, sources, log });
    let written = { ok: true, changed: 0, note: '没有需要写入的补丁' };
    let applied = false;
    let nextFixtures = fixtures;
    if (result.patches.size > 0) {
      const { fixtures: next, changed } = applyPatches(fixtures, result.patches);
      const issues = validateFixtures(next);
      if (issues.length) {
        written = { ok: false, reason: '校验未通过，已放弃写盘', issues: issues.slice(0, 5) };
      } else {
        const saved = saveFixturesImpl(next) || { ok: false, reason: '写盘结果缺失' };
        // ⚠️ 不能不看 saved.ok 就报「完成」：数据目录不可写时 saveFixtures 返回
        //    {ok:false, reason}，此时日志在撒谎、lastSync.applied 也错报为 true。
        written = { ...saved, changed };
        applied = saved.ok === true;
        if (applied) nextFixtures = next;
        log[applied ? 'log' : 'warn']?.(
          applied
            ? `[scores] ${label}完成：写入 ${changed} 场新完赛比分 (${Date.now() - startedAt}ms)`
            : `[scores] ${label}写盘失败：${saved?.reason || '未知原因'}（${changed} 场未落盘）`
        );
      }
    }
    // 即使没有补丁也要记录「这次检查发生过」；否则设置页会永远显示
    // 「本次启动后未运行」，用户无法区分健康自检与从未执行。
    return {
      fixtures: nextFixtures,
      info: {
        at: new Date().toISOString(),
        ms: Date.now() - startedAt,
        patches: result.patches.size,
        attempted: result.attempted !== false,
        applied,
        written,
        errors: result.errors.length,
        stats: result.stats,
        bySource: result.bySource
      }
    };
  };

  // 自动化后台常态保鲜：先跑 ESPN 快通道让当前比分尽快可见，再用 openfootball 补全历史/时间。
  // openfootball 在部分网络会走 curl 兜底，单轮可达数十秒；不能让它拖住首屏比分。
  const runBackgroundSync = async () => {
    if (rules.scores?.enabled === false || syncing) return;
    syncing = true;
    let fixtures = null;
    let espnOk = true;
    const stages = [];
    const recordFailure = (label, message) => {
      log.warn?.(`[scores] ${label}异常: ${message}`);
      stages.push({
        at: new Date().toISOString(),
        ms: 0,
        patches: 0,
        attempted: true,
        applied: false,
        // 本阶段异常不等于写盘失败：写盘结果由已完成阶段的 info 保留。
        written: { ok: true, changed: 0, note: '本阶段异常，未写盘' },
        errors: 1,
        stats: {},
        bySource: {},
        error: `[${label}] ${message}`
      });
    };
    try {
      fixtures = await loadFixturesImpl();
      try {
        const stage = await runSyncStage(fixtures, ['espn'], '后台快检');
        fixtures = stage.fixtures;
        stages.push(stage.info);
      } catch (err) {
        espnOk = false;
        recordFailure('后台快检', err?.message || String(err));
      }
      try {
        const stage = await runSyncStage(
          fixtures,
          espnOk ? ['openfootball'] : undefined,
          espnOk ? '后台补全' : '后台完整保鲜'
        );
        fixtures = stage.fixtures;
        stages.push(stage.info);
      } catch (err) {
        recordFailure('后台补全', err?.message || String(err));
      }
    } catch (err) {
      recordFailure('后台保鲜', err?.message || String(err));
    } finally {
      lastSync = combineSyncStages(stages);
      syncing = false;
    }
  };

  // 测试注入 backgroundSync:false 时不启动定时器，避免假数据被后台任务干扰。
  let startupTimer = null;
  let cronTimer = null;
  if (backgroundSync) {
    startupTimer = setTimeout(runBackgroundSync, 500);
    cronTimer = setInterval(runBackgroundSync, 30 * 60 * 1000);
  }

  server.on('close', () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (cronTimer) clearInterval(cronTimer);
  });

  return server;
}

/* ---------------- 直接运行时启动 ---------------- */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rules = loadRules();
  const { host, port } = rules.listen || { host: '127.0.0.1', port: 3100 };

  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error(`✖ 拒绝启动：监听地址必须是 127.0.0.1，当前为 ${host}（PRD §1.3 硬边界）`);
    process.exit(1);
  }

  const server = createServer(rules);
  server.listen(port, host, () => {
    console.log(`夜猫看台 · 本地服务`);
    console.log(`  监听      http://${host}:${port}`);
    console.log(`  流代理    /api/proxy?url=<encoded>`);
    console.log(`  保鲜预览  POST /api/scores/sync`);
    if (!(rules.proxy?.allowedHosts?.length || rules.proxy?.allowedHostSuffixes?.length)) {
      console.log(`  ⚠️  代理白名单为空 → /api/proxy 一律拒绝（安全默认）。请先在 server/rules.json 填入直播域名。`);
    }
  });
}
