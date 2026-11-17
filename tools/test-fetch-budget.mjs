import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchJSON } from '../server/sources/normalize.js';

// fetchJSON 的 timeoutMs 是整次拉取的总预算（含重试与退避），不是单请求上限。
// 旧语义 retries×timeoutMs 会击穿调用方总 deadline（90s 完整同步被拖到 ~180s）。
// 手机端 mobile/src/data/sync/normalize.js 为同款逻辑（Metro 环境 JSON import，
// Node 无法直接导入），语义由本测试覆盖桌面实现 + 两端代码对齐保证。

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
}

function listen(handler) {
  return new Promise(resolve => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const port = srv => srv.address().port;
const close = srv => new Promise(r => srv.close(r));

await check('★ 连续 500：总耗时不超过 timeoutMs（重试共享预算，不再 retries×timeout）', async () => {
  const srv = await listen((_req, res) => {
    res.writeHead(500);
    res.end('err');
  });
  const started = Date.now();
  await assert.rejects(
    fetchJSON(`http://127.0.0.1:${port(srv)}/x`, { timeoutMs: 1200, retries: 3, baseDelayMs: 100, log: { warn() {} } })
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `elapsed ${elapsed}ms 应接近 1200ms 预算而非 3×1200`);
  await close(srv);
});

await check('★ 慢响应成功：预算内拿到结果', async () => {
  const srv = await listen((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 300);
  });
  const j = await fetchJSON(`http://127.0.0.1:${port(srv)}/x`, { timeoutMs: 2000, retries: 3, log: { warn() {} } });
  assert.equal(j.ok, true);
  await close(srv);
});

await check('★ 响应体超预算：abort 生效并抛错', async () => {
  const srv = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // headers 立即到达，body 拖延——超时必须覆盖 body 阶段
    setTimeout(() => res.end('{"ok":true}'), 1500);
  });
  await assert.rejects(
    fetchJSON(`http://127.0.0.1:${port(srv)}/x`, { timeoutMs: 500, retries: 1, log: { warn() {} } })
  );
  await close(srv);
});

await check('首次失败后重试在预算内成功', async () => {
  let hits = 0;
  const srv = await listen((_req, res) => {
    hits += 1;
    if (hits === 1) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits }));
  });
  const j = await fetchJSON(`http://127.0.0.1:${port(srv)}/x`, { timeoutMs: 3000, retries: 3, baseDelayMs: 50, log: { warn() {} } });
  assert.equal(j.hits, 2);
  await close(srv);
});

console.log(`[test:fetch-budget] ${passed} passed`);