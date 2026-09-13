/**
 * 代理超时测试（P1-2 回归）
 *
 * 覆盖两条此前完全缺失的防线：
 *   ① body 阶段的静默超时 —— 上游把响应头发出来后就不动了，
 *      此时 timeoutMs 早已失效（它只管"等到响应头"），若无 idle 保护则并发槽位永久泄漏。
 *   ② 排队超时 —— 槽位被占满时，排队请求必须有上限，否则整个播放链路无限等待。
 *
 * 复现要点（踩过的坑）：Node 会缓冲响应头，若上游只 writeHead 而不写任何 body，
 * 响应头根本不会发出去 —— 那样代理会停在"等响应头"阶段，由 timeoutMs 正常兜住，
 * 测不到真正的泄漏形态。必须用 res.flushHeaders() 强制把头送出去。
 *
 * 运行：node tools/test-proxy-timeout.mjs
 */

import http from 'node:http';
import net from 'node:net';
import { createServer } from '../server/index.js';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const quiet = { warn() {}, error() {}, log() {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 上游源站 ---------------- */

/** 僵住：发完响应头就什么都不做 */
const stuck = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/mp2t' });
  res.flushHeaders();
});

/** 稳定慢速：每 200ms 发 64B，共 3 秒 —— 用于验证 idle 不会误杀正常流 */
const slow = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/mp2t' });
  res.flushHeaders();
  let n = 0;
  const timer = setInterval(() => {
    if (n++ >= 15) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(Buffer.alloc(64));
  }, 200);
  res.on('close', () => clearInterval(timer));
});

await new Promise(r => stuck.listen(0, '127.0.0.1', r));
await new Promise(r => slow.listen(0, '127.0.0.1', r));
const stuckPort = stuck.address().port;
const slowPort = slow.address().port;

/* ---------------- 测试用代理实例 ---------------- */

async function makeProxy(overrides = {}) {
  const rules = {
    listen: { host: '127.0.0.1', port: 0 },
    proxy: {
      allowedHosts: ['127.0.0.1'],
      allowedHostSuffixes: [],
      forwardHeaders: [],
      upstreamHeaders: {},
      timeoutMs: 800,
      streamIdleTimeoutMs: 1200,
      queueTimeoutMs: 1000,
      maxConcurrent: 2,
      maxPlaylistBytes: 4194304,
      ...overrides
    },
    scores: { enabled: false }
  };
  const server = createServer(rules, quiet);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const proxyUrl = url => `http://127.0.0.1:${port}/api/proxy?url=${encodeURIComponent(url)}`;
  const health = async () => (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).proxy;
  return { server, port, proxyUrl, health };
}

/** 裸 socket：发出请求后保持连接不关（进程内 fetch 会自动中止未消费的响应，会污染实验） */
function rawGet(port, path, bag) {
  const s = net.connect(port, '127.0.0.1');
  s.on('error', () => {});
  s.on('data', () => {});
  s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`);
  bag.push(s);
  return s;
}

console.log('代理超时测试');
console.log('');

/* ================================================================== */
console.log('一、body 阶段静默超时（上游发完响应头后僵住）');
{
  const { server, port, proxyUrl, health } = await makeProxy();
  const path = proxyUrl(`http://127.0.0.1:${stuckPort}/live/seg.ts`).replace(`http://127.0.0.1:${port}`, '');

  const bag = [];
  rawGet(port, path, bag);
  rawGet(port, path, bag);
  await sleep(400);
  const occupied = await health();
  ok('两个请求已占住全部并发槽位', occupied.activeRequests === 2, `active=${occupied.activeRequests}`);

  // 关键断言：timeoutMs=800 早就过了，能救回来的必须是 idle（1200ms）
  await sleep(2200);
  const after = await health();
  ok('★ 静默超时后槽位已归还（未泄漏）', after.activeRequests === 0, `active=${after.activeRequests}`);
  ok('归还后队列也清空', after.queuedRequests === 0, `queued=${after.queuedRequests}`);

  bag.forEach(s => s.destroy());
  server.close();
}

/* ================================================================== */
console.log('');
console.log('二、排队超时（槽位占满时不能无限等）');
{
  const { server, port, proxyUrl, health } = await makeProxy();
  const path = proxyUrl(`http://127.0.0.1:${stuckPort}/live/seg.ts`).replace(`http://127.0.0.1:${port}`, '');

  const bag = [];
  rawGet(port, path, bag);
  rawGet(port, path, bag); // 占满 2 个
  await sleep(150);

  const t0 = Date.now();
  let status = 0;
  let body = '';
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(4000) });
    status = r.status;
    body = await r.text();
  } catch (e) {
    status = -1;
    body = e.name;
  }
  const waited = Date.now() - t0;

  ok('排队请求拿到明确响应而非无限等待', status !== -1, `status=${status} ${body.slice(0, 80)}`);
  ok('排队超时返回 503', status === 503, `实际 status=${status}`);
  ok('在 queueTimeoutMs 附近被拒（不是等到天荒地老）', waited < 3000, `等待 ${waited}ms`);
  ok('错误信息说明了并发与排队状态', /等待并发槽位超时/.test(body), body.slice(0, 120));

  const h = await health();
  ok('被拒请求未占用槽位', h.activeRequests === 2, `active=${h.activeRequests}`);

  bag.forEach(s => s.destroy());
  server.close();
}

/* ================================================================== */
console.log('');
console.log('三、不误杀正常慢速流（防止过度修正）');
{
  const { server, proxyUrl } = await makeProxy();
  let received = 0;
  let errored = null;
  try {
    const r = await fetch(proxyUrl(`http://127.0.0.1:${slowPort}/live/seg.ts`), {
      signal: AbortSignal.timeout(6000)
    });
    for await (const chunk of r.body) received += chunk.length;
  } catch (e) {
    errored = e.name;
  }
  ok('持续有数据的流未被 idle 超时中断', errored === null, `异常：${errored}`);
  ok('完整收到 15×64B = 960B', received === 960, `收到 ${received}B`);
  server.close();
}

/* ================================================================== */
console.log('');
console.log('四、idle 超时可关停（streamIdleTimeoutMs=0）');
{
  const { server, port, proxyUrl, health } = await makeProxy({ streamIdleTimeoutMs: 0 });
  const path = proxyUrl(`http://127.0.0.1:${stuckPort}/live/seg.ts`).replace(`http://127.0.0.1:${port}`, '');
  const bag = [];
  rawGet(port, path, bag);

  await sleep(2000); // 远超过第一节用的 1200ms
  const h = await health();
  ok('idleMs=0 时不做静默中断（槽位按预期保持占用）', h.activeRequests === 1, `active=${h.activeRequests}`);
  ok('说明该超时确实由配置驱动，而非硬编码副作用', h.activeRequests !== 0);

  bag.forEach(s => s.destroy());
  server.close();
}

/* ================================================================== */
console.log('');
console.log('五、未配置时的默认值不会退化成「立即拒绝」');
{
  const { server, port, proxyUrl } = await makeProxy({ queueTimeoutMs: undefined, streamIdleTimeoutMs: undefined });
  const path = proxyUrl(`http://127.0.0.1:${stuckPort}/live/seg.ts`).replace(`http://127.0.0.1:${port}`, '');

  const bag = [];
  rawGet(port, path, bag);
  rawGet(port, path, bag); // 占满
  await sleep(150);

  // 若默认值被写成 0 或极小，排队请求会立刻被拒；默认给了足够窗口则应继续等待
  let status = 0;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) });
    status = r.status;
  } catch {
    status = -1; // 客户端超时 —— 说明服务端仍在排队，符合预期
  }
  ok('未配置时排队请求不会被立即拒绝（默认窗口足够）', status === -1, `status=${status}`);

  bag.forEach(s => s.destroy());
  server.close();
}

console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  stuck.close();
  slow.close();
  process.exit(1);
}
stuck.close();
slow.close();
process.exit(0);
