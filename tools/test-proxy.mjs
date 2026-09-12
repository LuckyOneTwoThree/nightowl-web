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
  ok('健康检查回报监听地址', String(j.listening).startsWith('127.0.0.1'), j.listening);
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
