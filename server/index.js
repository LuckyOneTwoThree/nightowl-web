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
import { createProxy, loadRules, ProxyError } from './proxy.js';
import { syncScores, applyPatches, validateFixtures } from './scores.js';
import { getLiveSourcesForMatch } from './scraper.js';
import { loadFixtures, saveFixtures, freshness } from './data-store.js';

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
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
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

/** 读取并解析 JSON 请求体（限长，避免被大 body 打爆） */
function readJsonBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => {
      buf += c;
      if (buf.length > limit) {
        reject(new Error('请求体超出限制'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function createServer(rules = loadRules(), log = console) {
  const proxy = createProxy(rules, log);
  let syncing = false;
  let lastSync = null;

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
          }
        });
        return;
      }

      /* ---------------- 会话级域名授权 ---------------- */
      if (pathname === '/api/proxy/allow' && req.method === 'POST') {
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
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
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
        try {
          const fixtures = await loadFixtures();
          sendJSON(res, 200, {
            ok: true,
            freshness: freshness(fixtures),
            lastSync,
            note: freshness(fixtures).writable
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
        try {
          const fixtures = await loadFixtures();
          sendJSON(
            res,
            200,
            {
              ok: true,
              count: fixtures.length,
              freshness: freshness(fixtures),
              fixtures
            },
            { 'Cache-Control': 'no-store' }
          );
        } catch (err) {
          sendJSON(res, 500, { error: String(err?.message || err) });
        }
        return;
      }

      if (pathname === '/api/scores/sync' && req.method === 'POST') {
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
          const body = await readJsonBody(req).catch(() => ({}));
          // apply=true 时写回用户数据目录；否则只预览（保持旧行为）
          const apply = body?.apply === true || searchParams.get('apply') === '1';
          const allMonths = body?.allMonths === true || searchParams.get('all') === '1';
          const months = body?.months || (searchParams.get('months') ? searchParams.get('months').split(',') : null);
          const fixtures = await loadFixtures();
          const result = await syncScores({ fixtures, rules, months, allMonths, log });

          let written = null;
          let nextFixtures = null;
          if (apply && result.patches.size > 0) {
            const { fixtures: next, changed } = applyPatches(fixtures, result.patches);
            const issues = validateFixtures(next);
            if (issues.length) {
              // 与 CLI 一致：校验不通过就绝不写盘，宁可这次不同步
              written = { ok: false, reason: '校验未通过，已放弃写盘', issues: issues.slice(0, 5) };
            } else {
              const saved = saveFixtures(next);
              written = { ...saved, changed };
              nextFixtures = next;
            }
          } else if (apply) {
            written = { ok: true, changed: 0, note: '没有需要写入的补丁' };
          }

          lastSync = {
            at: new Date().toISOString(),
            ms: Date.now() - startedAt,
            patches: result.patches.size,
            applied: !!apply,
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

  // 自动化后台常态保鲜：服务启动 3 秒后执行首次增量自检，随后每 30 分钟自检一次
  const runBackgroundSync = async () => {
    if (rules.scores?.enabled === false || syncing) return;
    try {
      syncing = true;
      const startedAt = Date.now();
      const fixtures = await loadFixtures();
      const result = await syncScores({ fixtures, rules, log });
      if (result.patches.size > 0) {
        const { fixtures: next, changed } = applyPatches(fixtures, result.patches);
        const issues = validateFixtures(next);
        if (!issues.length) {
          const saved = saveFixtures(next);
          log.log?.(`[scores] 后台自动保鲜完成：写入 ${changed} 场新完赛比分 (${Date.now() - startedAt}ms)`);
          lastSync = {
            at: new Date().toISOString(),
            ms: Date.now() - startedAt,
            patches: result.patches.size,
            applied: true,
            written: { ...saved, changed },
            errors: result.errors.length,
            stats: result.stats
          };
        }
      }
    } catch (err) {
      log.warn?.(`[scores] 后台保鲜异常: ${err?.message || err}`);
    } finally {
      syncing = false;
    }
  };

  const startupTimer = setTimeout(runBackgroundSync, 500);
  const cronTimer = setInterval(runBackgroundSync, 30 * 60 * 1000);

  server.on('close', () => {
    clearTimeout(startupTimer);
    clearInterval(cronTimer);
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
