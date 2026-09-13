/**
 * 媒体类型判定测试（纯离线）
 *
 * 为什么必须有这个文件：
 *   这条链路此前完全没有测试覆盖 —— isHlsUrl 埋在 React 组件里，Node 侧够不着；
 *   而 test-playback.mjs 用的假源是 /live/master.m3u8（不带 query），
 *   恰好避开了唯一会出问题的那种形态。
 *   结果：112 项测试全绿，但真实直播源 100% 黑屏。
 *
 * 运行：node tools/test-media.mjs
 */

import { isHlsUrl, unwrapProxyUrl, inferMediaType } from '../src/core/media.js';

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

/** 复现前端拼接代理地址的方式（PlayerStage.jsx 的 proxyUrl） */
const toProxy = direct => `/api/proxy?url=${encodeURIComponent(direct)}`;

console.log('媒体类型判定测试');
console.log('');

/* ================================================================== */
console.log('一、直接地址');
ok('无 query 的 .m3u8 判为 HLS', isHlsUrl('http://cdn.example.com/live/master.m3u8') === true);
ok('带 query 的 .m3u8 判为 HLS', isHlsUrl('http://cdn.example.com/live/master.m3u8?token=abc') === true);
ok('.m3u8 后带 # 判为 HLS', isHlsUrl('http://cdn.example.com/live/master.m3u8#seg') === true);
ok('大写 .M3U8 判为 HLS', isHlsUrl('http://cdn.example.com/live/MASTER.M3U8') === true);
ok('.mp4 不判为 HLS', isHlsUrl('http://cdn.example.com/vod/a.mp4') === false);
ok('相对路径 .m3u8 判为 HLS', isHlsUrl('/live/index.m3u8') === true);

/* ================================================================== */
console.log('');
console.log('二、经本地代理的地址（本轮的缺陷正出在这里）');

// 真实直播源的形态：一定是 .m3u8 + 签名 query
const realDirect =
  'http://hlsztemgsplive.miguvideo.com:8080/wd_r2/cctv/cctv5hdnew/600/index.m3u8' +
  '?msisdn=FAKE&timestamp=20260912220304&SecurityKey=20260912220304&encrypt=FAKE';

const proxied = toProxy(realDirect);
ok('代理地址确实把 ? 编码成了 %3F（前提校验）', proxied.includes('%3F') && !proxied.includes('.m3u8?'));
ok('★ 带 query 的 m3u8 经代理后仍判为 HLS', isHlsUrl(proxied) === true,
  `实际：isHlsUrl("${proxied.slice(0, 80)}…") = ${isHlsUrl(proxied)}`);
ok('带 query 的 mp4 经代理后判为 mp4', isHlsUrl(toProxy('http://cdn.example.com/vod/a.mp4?token=1')) === false);
ok('无 query 的 m3u8 经代理后判为 HLS', isHlsUrl(toProxy('http://cdn.example.com/a.m3u8')) === true);

/* ================================================================== */
console.log('');
console.log('三、显式 kind 优先于 URL 嗅探');
ok('kind=m3u8 但 URL 无扩展名 → m3u8', inferMediaType('/api/proxy?url=x', 'm3u8') === 'm3u8');
ok('kind=mp4 但 URL 像 m3u8 → 仍按 mp4', inferMediaType('/x.m3u8', 'mp4') === 'mp4');
ok('kind 缺失时回退到 URL 嗅探（m3u8）', inferMediaType(toProxy(realDirect), null) === 'm3u8');
ok('kind=embed 时不误判成 mp4 以外的类型', inferMediaType('/a.m3u8', 'embed') === 'm3u8');
ok('完全无法判断时安全默认为 mp4', inferMediaType('/api/proxy?url=unknown', null) === 'mp4');

/* ================================================================== */
console.log('');
console.log('四、unwrapProxyUrl 与边界');
ok('能从代理地址取出直链', unwrapProxyUrl(proxied) === realDirect);
ok('非代理地址原样返回', unwrapProxyUrl('http://a.com/x.m3u8') === 'http://a.com/x.m3u8');
ok('编码损坏时不抛错', typeof unwrapProxyUrl('/api/proxy?url=%E0%A4%A') === 'string');
ok('空值返回空串', unwrapProxyUrl('') === '');
ok('null 安全', isHlsUrl(null) === false);
ok('undefined 安全', isHlsUrl(undefined) === false);
ok('非字符串（数字）安全', isHlsUrl(12345) === false);

/* ================================================================== */
console.log('');
console.log('五、旧实现对照（证明本测试确实能打住该缺陷）');
// 旧实现：/\.m3u8(\?|$)/i —— 直接对整串嗅探
const legacyIsHlsUrl = url => /\.m3u8(\?|$)/i.test(String(url || ''));
const legacyVerdict = legacyIsHlsUrl(proxied);
ok('旧实现确实会把该代理地址判错（前提校验）', legacyVerdict === false,
  `旧实现判定 = ${legacyVerdict}（若为 true 说明用例没覆盖到缺陷形态）`);
ok('新实现与旧实现在代理场景下结论相反 → 该断言能拦住回归', legacyVerdict !== isHlsUrl(proxied));

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
