/**
 * 播放链路端到端测试
 *
 * 验证「用户粘贴直链 → 本机会话授权域名 → 本地代理剥防盗链并重写 M3U8」整条链路：
 *   ① 未授权域名 → 403 blocked（安全默认）
 *   ② 非法主机名 → 拒绝
 *   ③ 授权后拉 M3U8 → 200 且 URI 全量重写
 *   ④ 授权后拉分片 → 200 且字节无损
 *   ⑤ 会话授权仅内存，重启即失效（用新实例验证）
 *
 * 运行：node tools/test-playback.mjs
 */

import http from 'node:http';
import { createServer } from '../server/index.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? `  ${detail}` : ''}`); }
}

/* ================================================================== */
/* 上游源站（模拟带防盗链的直播 CDN）                                  */
/* ================================================================== */

const SEG = Buffer.alloc(4096);
for (let i = 0; i < SEG.length; i++) SEG[i] = (i * 7) % 256;

const MEDIA = [
  '#EXTM3U',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-KEY:METHOD=AES-128,URI="key/k1.key"',
  '#EXTINF:4.000,',
  'seg1.ts?sign=a%2Bb',
  '#EXT-X-ENDLIST'
].join('\n');

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
  'hls/720/index.m3u8'
].join('\n');

let sawReferer = false;

const origin = http.createServer((req, res) => {
  if (req.headers.referer) sawReferer = true; // 代理应剥掉 Referer
  const p = new URL(req.url, 'http://127.0.0.1').pathname;

  if (p === '/live/master.m3u8') {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(MASTER);
    return;
  }
  if (p === '/live/hls/720/index.m3u8') {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(MEDIA);
    return;
  }
  if (p === '/live/hls/720/seg1.ts') {
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const s = Number(m?.[1] || 0);
      const e = m?.[2] ? Number(m[2]) : SEG.length - 1;
      const chunk = SEG.subarray(s, e + 1);
      res.writeHead(206, {
        'Content-Type': 'video/mp2t',
        'Content-Range': `bytes ${s}-${e}/${SEG.length}`,
        'Content-Length': chunk.length
      });
      res.end(chunk);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': SEG.length });
    res.end(SEG);
    return;
  }
  res.writeHead(404);
  res.end('nope');
});

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const originPort = await listen(origin);
const ORIGIN = `http://127.0.0.1:${originPort}`;

/* ================================================================== */
/* 代理实例（自定义规则：白名单为空）                                  */
/* ================================================================== */

const testRules = {
  listen: { host: '127.0.0.1', port: 0 },
  proxy: {
    allowedHosts: [],
    allowedHostSuffixes: [],
    forwardHeaders: ['Range', 'Accept'],
    upstreamHeaders: { Referer: '', 'User-Agent': 'nightowl-test' },
    timeoutMs: 5000,
    maxConcurrent: 8,
    maxPlaylistBytes: 1048576
  },
  scores: { enabled: false }
};

const srv = createServer(testRules, { warn() {}, error() {} });
const proxyPort = await listen(srv);
const P = `http://127.0.0.1:${proxyPort}`;
const proxied = u => `${P}/api/proxy?url=${encodeURIComponent(u)}`;

console.log('播放链路端到端测试');
console.log(`  上游源站 ${ORIGIN}`);
console.log(`  本地代理 ${P}`);
console.log('');

/* ================================================================== */
console.log('一、安全默认（未授权一律拒绝）');

{
  const r = await fetch(proxied(`${ORIGIN}/live/master.m3u8`));
  const j = await r.json();
  ok('未授权域名 → 403 blocked', r.status === 403 && j.kind === 'blocked', `${r.status} ${j.kind}`);
}

{
  const r = await fetch(`${P}/api/proxy/allow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: 'http://evil.com/path' })
  });
  const j = await r.json();
  ok('非法主机名 → 拒绝授权', j.ok === false, JSON.stringify(j.results));
}

/* ================================================================== */
console.log('');
console.log('二、会话级授权（用户显式声明）');

{
  const r = await fetch(`${P}/api/proxy/allow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: '127.0.0.1' })
  });
  const j = await r.json();
  ok('授权本地源站成功', r.status === 200 && j.ok === true, JSON.stringify(j));
}

/* ================================================================== */
console.log('');
console.log('三、授权后的播放链路');

{
  const r = await fetch(proxied(`${ORIGIN}/live/master.m3u8`));
  const body = await r.text();
  ok('拉取主清单 → 200', r.status === 200, String(r.status));
  ok('主清单被重写（变体 URI 指向代理）', body.includes('/api/proxy?url='));
  ok('主清单索引不缓存', (r.headers.get('cache-control') || '').includes('no-store'));
}

{
  const r = await fetch(proxied(`${ORIGIN}/live/hls/720/index.m3u8`));
  const body = await r.text();
  ok('拉取媒体清单 → 200', r.status === 200);
  ok('媒体清单：分片 URI 被重写', body.includes(encodeURIComponent(`${ORIGIN}/live/hls/720/seg1.ts?sign=a%2Bb`)));
  ok('媒体清单：AES 密钥 URI 被重写', body.includes(encodeURIComponent(`${ORIGIN}/live/hls/720/key/k1.key`)));
}

{
  const r = await fetch(proxied(`${ORIGIN}/live/hls/720/seg1.ts?sign=a%2Bb`));
  const buf = Buffer.from(await r.arrayBuffer());
  ok('拉取分片 → 200', r.status === 200);
  ok('分片字节无损', buf.length === SEG.length && buf.equals(SEG), `${buf.length} vs ${SEG.length}`);
  ok('分片长缓存', (r.headers.get('cache-control') || '').includes('max-age'));
}

{
  const r = await fetch(proxied(`${ORIGIN}/live/hls/720/seg1.ts?sign=a%2Bb`), { headers: { Range: 'bytes=100-199' } });
  ok('Range 拖动 → 206', r.status === 206, String(r.status));
}

/* ================================================================== */
console.log('');
console.log('四、会话授权不落盘（新实例应重新要求授权）');

{
  const srv2 = createServer(testRules, { warn() {}, error() {} });
  const port2 = await listen(srv2);
  const r = await fetch(`http://127.0.0.1:${port2}/api/proxy?url=${encodeURIComponent(`${ORIGIN}/live/master.m3u8`)}`);
  ok('新实例 → 仍为 403（授权未持久化）', r.status === 403, String(r.status));
  srv2.close();
}

/* ================================================================== */
srv.close();
origin.close();

console.log('');
console.log('─'.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  console.log('失败明细：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
