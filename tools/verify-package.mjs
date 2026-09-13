/**
 * 打包产物自检（跨平台：本地 Mac 与 CI 共用同一份逻辑）
 *
 * 用法：node tools/verify-package.mjs [产物 resources/app 目录]
 *       不传参数时自动探测 release/ 下的 win-unpacked / win-arm64-unpacked。
 *
 * 背景：这套检查最初写成 CI 里的 pwsh —— 开发环境是 Mac 就永远执行不到，
 * 于是「自检自己写错」这种问题在本地根本发现不了（真实发生过：
 * 断言清单里误写了打包输入 build/，CI 上才失败）。
 * 移植成 node 脚本后，本地 electron-builder --dir 打包即可验证同一份逻辑。
 *
 * 检查两道：
 *   ① 相对 import 扫描 —— 逐一解析产物内 server/electron 模块的相对 import，
 *      断言目标文件存在。曾抓到「scores.js → ../src/core/engine.js 未打包」。
 *   ② 关键运行时文件断言（src/core、src/data、dist）。
 *      注意 build/icon.ico 是打包输入（生成 exe 图标），不在产物内，
 *      断言的是仓库根存在该文件。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let appDir = process.argv[2];
if (!appDir) {
  const candidates = [
    'release/win-unpacked/resources/app',
    'release/win-arm64-unpacked/resources/app'
  ];
  appDir = candidates.map(c => resolve(ROOT, c)).find(existsSync);
}
if (!appDir || !existsSync(appDir)) {
  console.error('✗ 未找到打包产物目录。先执行：npx electron-builder --win --dir --publish never');
  process.exit(1);
}
appDir = resolve(appDir);
console.log(`产物: ${appDir.replace(ROOT, '.')}`);

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
};

/* ---------- ① 相对 import 扫描 ---------- */
console.log('');
console.log('一、相对 import 可解析性（server + electron 全模块）');

const scanTargets = [];
const pushJs = dir => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) pushJs(p);
    else if (f.name.endsWith('.js')) scanTargets.push(p);
  }
};
pushJs(join(appDir, 'server'));
if (existsSync(join(appDir, 'electron'))) {
  for (const f of readdirSync(join(appDir, 'electron'))) {
    if (f.endsWith('.cjs') || f.endsWith('.mjs')) scanTargets.push(join(appDir, 'electron', f));
  }
}
ok(`扫描模块数 ${scanTargets.length}`, scanTargets.length >= 8, '过少说明 server/electron 未完整打包');

const missing = [];
for (const file of scanTargets) {
  const text = readFileSync(file, 'utf8');
  // from '...' 与 import('...') 两种形态，单引号（本项目统一风格）
  const refs = [
    ...text.matchAll(/from\s+'(\.[^']+)'/g),
    ...text.matchAll(/import\(\s*'(\.[^']+)'\s*\)/g)
  ].map(m => m[1]);
  for (const rel of refs) {
    const target = resolve(dirname(file), rel);
    if (!existsSync(target)) {
      missing.push(`${file.replace(appDir, '.')} → ${rel}`);
    }
  }
}
ok('★ 所有相对 import 目标存在（0 缺失）', missing.length === 0,
  missing.slice(0, 6).join('；') + (missing.length > 6 ? ` … 共 ${missing.length}` : ''));

/* ---------- ② 关键运行时文件 ---------- */
console.log('');
console.log('二、关键运行时文件');
for (const f of [
  'src/core/engine.js',      // scores.js（保鲜）运行时依赖算法引擎 —— 曾整个目录漏打包
  'src/core/media.js',
  'src/data/fixtures.json',
  'src/data/teams.json',
  'server/rules.json',
  'server/scraper-alias.json',
  'server/espn-alias.json',
  'dist/index.html'
]) {
  ok(f, existsSync(join(appDir, f)));
}
// dist chunk 是带 hash 的（index-XXXX.js），按前缀扫描
const assets = join(appDir, 'dist', 'assets');
const hasChunks =
  existsSync(assets) &&
  readdirSync(assets).some(f => f.startsWith('index-') && (f.endsWith('.js') || f.endsWith('.css')));
ok('dist chunk（index-*.js / *.css）', hasChunks);

/* ---------- ③ 打包输入（在仓库根，不在产物内） ---------- */
console.log('');
console.log('三、打包输入（仓库根）');
ok('build/icon.ico（exe 图标源）', existsSync(join(ROOT, 'build', 'icon.ico')));

/* ---------- 结果 ---------- */
console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
