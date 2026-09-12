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
import { syncScores } from './scores.js';

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
            activeRequests: proxy.gate.active,
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
          const fixtures = JSON.parse(
            await readFile(resolve(ROOT, 'src/data/fixtures.json'), 'utf8')
          );
          const result = await syncScores({ fixtures, rules, log });
          lastSync = {
            at: new Date().toISOString(),
            ms: Date.now() - startedAt,
            patches: result.patches.size,
            errors: result.errors.length,
            stats: result.stats,
            bySource: result.bySource
          };
          sendJSON(res, 200, {
            ok: true,
            dryRun: true,
            note: '本接口只做预览，不写盘。落盘请执行 `node tools/sync-scores.mjs --apply`',
            summary: lastSync,
            conflicts: result.conflicts.slice(0, 20),
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
