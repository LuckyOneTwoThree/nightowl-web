/**
 * 流代理集成测试
 *
 * 真起两个 HTTP 服务：一个「上游源站」（本地），一个「代理」。
 * 验证：白名单拦截 / M3U8 重写 / 分片透传 / Range 支持 / 缓存分级 / 失败语义。
 *
 * 运行：node tools/test-proxy.mjs
 */

import http from 'node:http';
import { createServer } from '../server/index.js';
import { assertPublicDestination, createProxy, isPublicIp } from '../server/proxy.js';

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

/* ================================================================== */
/* 上游源站（模拟直播 CDN）                                            */
/* ================================================================== */

const SEG_BODY = Buffer.alloc(2048);
for (let i = 0; i < SEG_BODY.length; i++) SEG_BODY[i] = i % 251;

const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="原声",URI="audio/orig.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
  'hls/1080/index.m3u8?token=abc%2Bdef',
  '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720',
  '/hls/720/index.m3u8'
].join('\n');

const MEDIA = [
  '#EXTM3U',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-KEY:METHOD=AES-128,URI="key/k1.key"',
  '#EXTINF:4.000,',
  'seg1.ts',
  '#EXTINF:4.000,',
  'seg2.ts'
].join('\n');

const origin = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (p === '/master.m3u8') {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(MASTER);
    return;
  }
  if (p === '/hls/1080/index.m3u8') {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(MEDIA);
    return;
  }
  if (p === '/seg1.ts' || p === '/hls/1080/seg1.ts' || p === '/hls/1080/seg2.ts') {
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m?.[1] || 0);
      const end = m?.[2] ? Number(m[2]) : SEG_BODY.length - 1;
      const chunk = SEG_BODY.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Type': 'video/mp2t',
        'Content-Range': `bytes ${start}-${end}/${SEG_BODY.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunk.length
      });
      res.end(chunk);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Content-Length': SEG_BODY.length,
      'Accept-Ranges': 'bytes'
    });
    res.end(SEG_BODY);
    return;
  }
  if (p === '/not-modified') {
    res.writeHead(304, { ETag: '"v1-test"', 'Cache-Control': 'max-age=60' });
    res.end();
    return;
  }
  if (p === '/boom') {
    res.writeHead(500);
    res.end('upstream error');
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

const originPort = await listen(origin);
const ORIGIN = `http://127.0.0.1:${originPort}`;
console.log(`上游源站已启动：${ORIGIN}`);

/* ================================================================== */
/* 代理（测试用白名单：只放行本机源站）                                */
/* ================================================================== */

const rules = {
  listen: { host: '127.0.0.1', port: 0 },
  proxy: {
    allowedHosts: ['127.0.0.1'],
    allowedHostSuffixes: [],
    forwardHeaders: ['Range', 'Accept'],
    upstreamHeaders: { Referer: '', 'User-Agent': 'nightowl-test' },
    timeoutMs: 5000,
    maxConcurrent: 4,
    maxPlaylistBytes: 1048576
  },
  scores: { enabled: false }
};

const proxySrv = createServer(rules, { warn() {}, error() {} });
const proxyPort = await listen(proxySrv);
const PROXY = `http://127.0.0.1:${proxyPort}`;
console.log(`代理已启动：${PROXY}`);
console.log('');

const P = (target, extra = '') => `${PROXY}/api/proxy?url=${encodeURIComponent(target)}${extra}`;

/* ================================================================== */
console.log('一、安全边界');

{
  const r = await fetch(`${PROXY}/api/health`);
  const j = await r.json();
  ok('GET /api/health 返回 200 且 ok=true', r.status === 200 && j.ok === true);
  ok('健康检查回报真实监听端口（非配置端口 0）', j.listening === `127.0.0.1:${proxyPort}`, `${j.listening} vs 127.0.0.1:${proxyPort}`);
  ok('健康检查回报监听地址', String(j.listening).startsWith('127.0.0.1'), j.listening);
}

/** 用原生 http 发请求：方便精确设置 Origin（fetch 不保证放行该头）。 */
const rawGet = (url, origin) =>
  new Promise(resolve => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: { origin } },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', e => resolve({ status: 0, body: String(e) }));
    req.end();
  });

{
  const r = await rawGet(P(`${ORIGIN}/master.m3u8`), 'https://evil.example.com');
  ok('实际 GET 带外部 Origin → 403（不只校验 OPTIONS）', r.status === 403 && r.body.includes('来源不在允许列表'), String(r.status));
}

{
  const r = await rawGet(P(`${ORIGIN}/master.m3u8`), 'http://127.0.0.1:5173');
  ok('实际 GET 带本机回环 Origin → 放行（200）', r.status === 200 && r.body.includes('/api/proxy?url='), String(r.status));
}

{
  const r = await fetch(`${PROXY}/api/proxy`);
  const j = await r.json();
  ok('缺 url 参数 → 400', r.status === 400 && j.kind === 'bad-request', `${r.status} ${j.kind}`);
}

{
  const r = await fetch(P('https://evil.example.com/stream.m3u8'));
  const j = await r.json();
  ok('非白名单域名 → 403（不做开放代理）', r.status === 403 && j.kind === 'blocked', `${r.status} ${j.kind}`);
}

{
  const r = await fetch(P('file:///etc/passwd'));
  ok('非 http(s) 协议 → 400', r.status === 400, String(r.status));
}

/* ================================================================== */
console.log('');
console.log('二、M3U8 重写（经真实代理链路）');

{
  const r = await fetch(P(`${ORIGIN}/master.m3u8`));
  const body = await r.text();
  const cc = r.headers.get('cache-control') || '';
  ok('主清单 → 200', r.status === 200);
  ok('主清单：Content-Type 透传', (r.headers.get('content-type') || '').includes('mpegurl'));
  ok('主清单：索引不缓存（否则永远播旧切片）', cc.includes('no-store'), cc);
  ok('主清单：变体 URI 被改写为代理路径',
    body.includes('/api/proxy?url=') && body.includes(encodeURIComponent(`${ORIGIN}/hls/1080/index.m3u8?token=abc%2Bdef`)),
    body.split('\n')[4]);
  ok('主清单：根相对变体 URI 正确解析',
    body.includes(encodeURIComponent(`${ORIGIN}/hls/720/index.m3u8`)));
  ok('主清单：音轨 URI 被改写',
    body.includes(encodeURIComponent(`${ORIGIN}/audio/orig.m3u8`)));
}

{
  const r = await fetch(P(`${ORIGIN}/hls/1080/index.m3u8`));
  const body = await r.text();
  ok('媒体清单：分片行全部改写',
    body.includes(encodeURIComponent(`${ORIGIN}/hls/1080/seg1.ts`)) &&
    body.includes(encodeURIComponent(`${ORIGIN}/hls/1080/seg2.ts`)));
  ok('媒体清单：AES 密钥 URI 被改写（漏则解密失败黑屏）',
    body.includes(encodeURIComponent(`${ORIGIN}/hls/1080/key/k1.key`)));
}

/* ================================================================== */
console.log('');
console.log('三、分片转发与 Range');

{
  const r = await fetch(P(`${ORIGIN}/seg1.ts`));
  const buf = Buffer.from(await r.arrayBuffer());
  const cc = r.headers.get('cache-control') || '';
  ok('分片 → 200', r.status === 200);
  ok('分片：字节完全一致（流式转发无损）', buf.length === SEG_BODY.length && buf.equals(SEG_BODY),
    `${buf.length} vs ${SEG_BODY.length}`);
  ok('分片：Content-Type 透传为 video/mp2t', (r.headers.get('content-type') || '').includes('video/mp2t'));
  ok('分片：长缓存', cc.includes('max-age'), cc);
  ok('分片：Accept-Ranges 透传', (r.headers.get('accept-ranges') || '').includes('bytes'));
}

{
  const r = await fetch(P(`${ORIGIN}/seg1.ts`), { headers: { Range: 'bytes=100-199' } });
  const buf = Buffer.from(await r.arrayBuffer());
  ok('Range 请求 → 206 Partial Content', r.status === 206, String(r.status));
  ok('Range：Content-Range 透传', (r.headers.get('content-range') || '').startsWith('bytes 100-199/'),
    r.headers.get('content-range'));
  ok('Range：返回切片长度正确（拖动与分片必需）', buf.length === 100 && buf.equals(SEG_BODY.subarray(100, 200)),
    `${buf.length}`);
}

/* ================================================================== */
console.log('');
console.log('四、失败语义');

{
  const r = await fetch(P(`${ORIGIN}/missing.m3u8`));
  const j = await r.json();
  ok('上游 404 → 明确标记 upstream-absent（≠ 网络失败）',
    r.status === 404 && j.kind === 'upstream-absent', `${r.status} ${j.kind}`);
}

{
  const r = await fetch(P(`${ORIGIN}/boom`));
  const j = await r.json();
  ok('上游 500 → 归为 network（可重试，不闩锁）', j.kind === 'network', j.kind);
}

{
  // 网络失败：指向白名单内但没人监听的端口
  const rules2 = { ...rules, proxy: { ...rules.proxy, allowedHosts: ['127.0.0.1'], timeoutMs: 1500 } };
  const srv2 = createServer(rules2, { warn() {}, error() {} });
  const port2 = await listen(srv2);
  const r = await fetch(`http://127.0.0.1:${port2}/api/proxy?url=${encodeURIComponent('http://127.0.0.1:1/dead.ts')}`);
  const j = await r.json();
  ok('连不上上游 → 504 且 kind=network', r.status === 504 && j.kind === 'network', `${r.status} ${j.kind}`);

  // 再次请求同一地址应照常重试（不闩锁）
  const r2 = await fetch(`http://127.0.0.1:${port2}/api/proxy?url=${encodeURIComponent('http://127.0.0.1:1/dead.ts')}`);
  ok('网络失败不闩锁：重复请求仍会重试', r2.status === 504, String(r2.status));
  srv2.close();
}

/* ================================================================== */
console.log('');
console.log('五、并发闸门');

{
  const results = await Promise.all(
    Array.from({ length: 12 }, () => fetch(P(`${ORIGIN}/seg1.ts`)).then(r => r.status))
  );
  ok('并发 12 个请求全部成功（未超上限被拒）', results.every(s => s === 200), JSON.stringify(results));
}

/* ================================================================== */
console.log('');
console.log('六、DNS 重绑定拦截与 304 条件请求透传');

{
  ok('isPublicIp 拒绝私网/回环/元数据/IPv4-mapped IP 并放行公网 IP',
    !isPublicIp('127.0.0.1') && !isPublicIp('10.0.0.1') && !isPublicIp('169.254.169.254')
    && !isPublicIp('172.16.0.1') && !isPublicIp('192.168.1.1') && !isPublicIp('::1')
    && !isPublicIp('::ffff:127.0.0.1') && !isPublicIp('fc00::1') && isPublicIp('1.1.1.1'));

  let blockedByDns = false;
  try {
    await assertPublicDestination('rebind.example.com', { proxy: {} }, async () => [{ address: '127.0.0.1', family: 4 }]);
  } catch (err) {
    blockedByDns = err?.status === 403 && err?.kind === 'blocked';
  }
  ok('★ 公网域名 DNS 解析到 127.0.0.1 时被代理拦截（403）', blockedByDns);

  const dnsProxy = createProxy(
    { proxy: { allowedHosts: [], allowedHostSuffixes: ['example.com'] } },
    { warn() {}, error() {} },
    new Set(),
    { lookup: async () => [{ address: '169.254.169.254', family: 4 }] }
  );
  const dnsSrv = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      await dnsProxy.handle(u.searchParams, req, res);
    } catch (err) {
      res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ kind: err.kind, error: err.message }));
    }
  });
  const dnsPort = await listen(dnsSrv);
  const rDns = await fetch(`http://127.0.0.1:${dnsPort}/api/proxy?url=${encodeURIComponent('http://cdn.example.com/live.m3u8')}`);
  ok('★ proxy.handle 在发起上游连接前拦下解析到 169.254.169.254 的域名', rDns.status === 403, String(rDns.status));
  dnsSrv.close();

  const r304 = await fetch(P(`${ORIGIN}/not-modified`), { headers: { 'If-None-Match': '"v1-test"' } });
  ok('★ 上游返回 304 Not Modified 原样透传（不再误判 502）', r304.status === 304 && r304.headers.get('etag') === '"v1-test"', String(r304.status));
}

/* ================================================================== */
console.log('');
console.log('七、端点来源防护与 plan.ics 缺省参数');

{
  const rLiveGet = await fetch(`${PROXY}/api/live-sources?h=ARS&a=MCI`);
  ok('★ /api/live-sources 拒绝 GET（防止无 Origin 跨站图片/链接触发）', rLiveGet.status === 405, String(rLiveGet.status));

  const rLiveCross = await fetch(`${PROXY}/api/live-sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    body: JSON.stringify({ h: 'ARS', a: 'MCI' })
  });
  ok('/api/live-sources 拦截 Sec-Fetch-Site: cross-site（403）', rLiveCross.status === 403, String(rLiveCross.status));

  const { mondayOfWall, nightOf } = await import('../src/core/engine.js');
  const mon = mondayOfWall(nightOf(Date.now()));
  // 当前夜猫周日夜凌晨 03:00（下周一凌晨，属于本周 night，成本 3.5h：budget=0 选不上，默认 4.0 能入选）
  const weekSunLate = new Date(Date.parse(`${mon}T00:00:00Z`) + 7 * 86400_000).toISOString().slice(0, 10) + 'T03:00';
  const srvIcs = createServer(rules, { warn() {}, error() {} }, {
    loadFixtures: async () => [
      { id: 'PL-99-ARS-MCI', l: 'PL', r: 99, t: weekSunLate, st: 'sched', h: 'ARS', a: 'MCI', tbd: false }
    ]
  });
  const icsPort = await listen(srvIcs);
  const icsCross = await fetch(`http://127.0.0.1:${icsPort}/api/calendar/plan.ics`, {
    headers: { 'Sec-Fetch-Site': 'cross-site' }
  });
  ok('/api/calendar/plan.ics 拦截 Sec-Fetch-Site: cross-site（403）', icsCross.status === 403, String(icsCross.status));

  const icsOk = await fetch(`http://127.0.0.1:${icsPort}/api/calendar/plan.ics?teams=ARS&leagues=PL`);
  const icsBody = await icsOk.text();
  ok('★ /api/calendar/plan.ics 省略 budget/remind 时沿用默认 4.0 与 30m（不变成 0）',
    icsOk.status === 200 && icsBody.includes('BEGIN:VEVENT') && icsBody.includes('TRIGGER:-PT30M'),
    `${icsOk.status} len=${icsBody.length}`);
  srvIcs.close();
}

/* ================================================================== */
proxySrv.close();
origin.close();

console.log('');
console.log('─'.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  console.log('失败明细：');
  failures.forEach(f => console.log(`  · ${f}`));
}
process.exit(fail ? 1 : 0);
