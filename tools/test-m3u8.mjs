/**
 * M3U8 重写离线测试
 *
 * 纯离线（不联网），覆盖全部 8 类 URI 载体 + 相对路径 + 边界情况。
 * 目的：把「缺一条就会能起播但一拖进度条就崩」这类隐蔽问题挡在开发期。
 *
 * 运行：node tools/test-m3u8.mjs
 */

import { rewritePlaylist, resolveUrl, isPlaylistResponse, cacheControlFor } from '../server/m3u8.js';

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

/** 从一行里取出被包进代理的目标地址（已解码） */
function targetOf(line) {
  const m = /url=([^"'\s]+)/.exec(line);
  return m ? decodeURIComponent(m[1]) : null;
}

console.log('M3U8 重写测试');
console.log('');

/* ================================================================== */
console.log('一、主清单（master playlist）');

const MASTER_BASE = 'https://cdn.example.com/hls/master.m3u8?token=abc123';
const master = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="英文原声",URI="audio/en/index.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="中文",URI="https://subs.example.com/zh.m3u8"',
  '',
  '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="keys/session.key"',
  '',
  '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="audio"',
  '1080p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
  '/hls/720p/index.m3u8',
  '',
  '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=80000,URI="iframe/1080.m3u8"'
].join('\n');

const mRes = rewritePlaylist(master, MASTER_BASE);
const mLines = mRes.text.split('\n');

// ② 变体 URI（STREAM-INF 下一行）
const v1 = targetOf(mLines[9]);
ok('② 变体 URI（相对路径）已重写', v1 === 'https://cdn.example.com/hls/1080p/index.m3u8', `实际: ${v1}`);
const v2 = targetOf(mLines[11]);
ok('② 变体 URI（根相对路径）已重写', v2 === 'https://cdn.example.com/hls/720p/index.m3u8', `实际: ${v2}`);

// ⑤ MEDIA 音轨
const media1 = targetOf(mLines[3]);
ok('⑤ #EXT-X-MEDIA 音轨 URI 已重写', media1 === 'https://cdn.example.com/hls/audio/en/index.m3u8', `实际: ${media1}`);
const media2 = targetOf(mLines[4]);
ok('⑤ #EXT-X-MEDIA 绝对地址保持正确', media2 === 'https://subs.example.com/zh.m3u8', `实际: ${media2}`);

// ④ SESSION-KEY
const sesKey = targetOf(mLines[6]);
ok('④ #EXT-X-SESSION-KEY URI 已重写', sesKey === 'https://cdn.example.com/hls/keys/session.key', `实际: ${sesKey}`);

// ⑥ I-FRAME
const iframe = targetOf(mLines[13]);
ok('⑥ #EXT-X-I-FRAME-STREAM-INF URI 已重写', iframe === 'https://cdn.example.com/hls/iframe/1080.m3u8', `实际: ${iframe}`);

ok('主清单：结构行 #EXTM3U 未被改动', mLines[0] === '#EXTM3U');
ok('主清单：空行保留', mLines[2] === '');
ok('主清单：命中类型计数正确', mRes.kinds.variant === 2 && mRes.kinds.attrUri === 4,
  `variant=${mRes.kinds.variant} attrUri=${mRes.kinds.attrUri}`);

/* ================================================================== */
console.log('');
console.log('二、媒体清单（media playlist）');

const MEDIA_BASE = 'https://cdn.example.com/hls/1080p/index.m3u8?auth=xyz&t=999';
const media = [
  '#EXTM3U',
  '#EXT-X-VERSION:9',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-MEDIA-SEQUENCE:1200',
  '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/k1.key",IV=0x1a2b',
  '#EXT-X-MAP:URI="../init/1080.mp4"',
  '#EXTINF:4.000,',
  'seg1200.ts',
  '#EXTINF:4.000,',
  '/segments/seg1201.ts?token=deadbeef',
  '#EXT-X-PART:DURATION=1.0,URI="part1202.0.ts",INDEPENDENT=YES',
  '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part1202.1.ts"',
  '#EXT-X-RENDITION-REPORT:URI="../../720p/index.m3u8",LAST-MSN=1201'
].join('\n');

const dRes = rewritePlaylist(media, MEDIA_BASE);
const dLines = dRes.text.split('\n');

// ① 普通分片
const seg1 = targetOf(dLines[7]);
ok('① 普通分片行（相对）已重写', seg1 === 'https://cdn.example.com/hls/1080p/seg1200.ts', `实际: ${seg1}`);
const seg2 = targetOf(dLines[9]);
ok('① 普通分片行（根相对 + query 保留）已重写',
  seg2 === 'https://cdn.example.com/segments/seg1201.ts?token=deadbeef', `实际: ${seg2}`);

// ③ KEY
const key = targetOf(dLines[4]);
ok('③ #EXT-X-KEY URI 已重写（绝对地址 + IV 属性保留）',
  key === 'https://keys.example.com/k1.key' && dLines[4].includes('IV=0x1a2b'), `实际: ${key}`);

// ④ MAP
const map = targetOf(dLines[5]);
ok('④ #EXT-X-MAP URI 已重写（../ 上级路径正确解析）',
  map === 'https://cdn.example.com/hls/init/1080.mp4', `实际: ${map}`);

// ⑦ PART
const part = targetOf(dLines[10]);
ok('⑦ #EXT-X-PART URI 已重写', part === 'https://cdn.example.com/hls/1080p/part1202.0.ts', `实际: ${part}`);

// 额外：PRELOAD-HINT / RENDITION-REPORT
const pre = targetOf(dLines[11]);
ok('⑨ #EXT-X-PRELOAD-HINT URI 已重写', pre === 'https://cdn.example.com/hls/1080p/part1202.1.ts', `实际: ${pre}`);
const rep = targetOf(dLines[12]);
ok('⑩ #EXT-X-RENDITION-REPORT URI 已重写（../../ 从 /hls/1080p/ 退到根）',
  rep === 'https://cdn.example.com/720p/index.m3u8', `实际: ${rep}`);

ok('媒体清单：命中类型计数正确', dRes.kinds.segment === 2 && dRes.kinds.attrUri === 5,
  `segment=${dRes.kinds.segment} attrUri=${dRes.kinds.attrUri}`);

/* ================================================================== */
console.log('');
console.log('三、边界与安全性');

const noUri = '#EXT-X-KEY:METHOD=NONE';
const r1 = rewritePlaylist(noUri, MEDIA_BASE);
ok('无 URI 的标签不产生改写', r1.text === noUri && r1.rewritten === 0);

const crlf = '#EXTM3U\r\n#EXTINF:4,\r\nseg1.ts\r\n';
const r2 = rewritePlaylist(crlf, MEDIA_BASE);
ok('CRLF 换行符被保留', r2.text.includes('\r\n') && !r2.text.includes('\n\n'));

const withHash = '#EXT-X-ENDLIST\n';
ok('收尾标签 #EXT-X-ENDLIST 原样保留', rewritePlaylist(withHash, MEDIA_BASE).text === '#EXT-X-ENDLIST\n');

// 目标地址中的 query/token 必须完整进代理参数（签名 URL 会过期，丢参数就 403）
const signed = '#EXTINF:4,\nseg1.ts?sign=a%2Bb&ts=123\n';
const signedOut = rewritePlaylist(signed, MEDIA_BASE).text;
ok('签名 query 完整保留（含 %2B 编码）',
  decodeURIComponent(/url=([^\n]+)/.exec(signedOut)[1]) === 'https://cdn.example.com/hls/1080p/seg1.ts?sign=a%2Bb&ts=123');

// 幂等性：二次重写不得再次包裹（上游若已引用本地代理路径，重复包裹会导致播放器拿到错误地址）
const once = rewritePlaylist('#EXTINF:4,\nseg1.ts\n', MEDIA_BASE).text;
const twice = rewritePlaylist(once, MEDIA_BASE).text;
ok('二次重写结果与一次一致（幂等）', twice === once);

const preWrapped = `#EXTINF:4,\n/api/proxy?url=${encodeURIComponent('https://cdn.example.com/hls/1080p/seg9.ts')}\n`;
const pwOut = rewritePlaylist(preWrapped, MEDIA_BASE).text;
ok('已是代理地址的 URI 不被二次包裹',
  (pwOut.match(/\/api\/proxy\?url=/g) || []).length === 1,
  `出现 ${(pwOut.match(/\/api\/proxy\?url=/g) || []).length} 次`);

/* ================================================================== */
console.log('');
console.log('四、响应判定与缓存策略');

ok('Content-Type: application/vnd.apple.mpegurl → 识别为 playlist',
  isPlaylistResponse('application/vnd.apple.mpegurl', 'https://x/y'));
ok('.m3u8 后缀 → 识别为 playlist', isPlaylistResponse('', 'https://x/a/b.m3u8?t=1'));
ok('.ts 分片 → 不识别为 playlist', !isPlaylistResponse('video/mp2t', 'https://x/s.ts'));
ok('m3u8 索引不缓存（否则永远播旧切片）',
  cacheControlFor('https://x/a.m3u8', 'application/vnd.apple.mpegurl').includes('no-store'));
ok('.ts 分片长缓存', cacheControlFor('https://x/s.ts', 'video/mp2t').includes('max-age'));

/* ================================================================== */
console.log('');
console.log('五、resolveUrl 基础行为');
ok('绝对地址原样返回', resolveUrl('https://a/b/c.m3u8', 'https://d/e.ts') === 'https://d/e.ts');
ok('根相对按 origin 解析', resolveUrl('https://a/b/c.m3u8', '/x/y.ts') === 'https://a/x/y.ts');
ok('同级相对按目录解析', resolveUrl('https://a/b/c.m3u8', 'z.ts') === 'https://a/b/z.ts');

/* ================================================================== */
console.log('');
console.log('─'.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  console.log('失败明细：');
  failures.forEach(f => console.log(`  · ${f}`));
}
process.exit(fail ? 1 : 0);
