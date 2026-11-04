#!/usr/bin/env node
/**
 * 本地隐私门禁（工作区，不含 git 历史）
 *
 * 背景：`23e47a3` 的 server/scraper.js 曾内联第三方直播直链，参数含
 * SecurityKey / encrypt / timestamp / userid。`56f0c0d` 已把直链外置，
 * 但同类内容不能再进仓库。
 *
 * 覆盖三件事：
 *   1. 工作区文本文件里出现「带签名的直播 URL」→ 失败
 *   2. `server/tv-channels.local.json` 被 git 跟踪 → 失败（必须在 .gitignore 里）
 *   3. 打包 files 规则会带上 `.local.json` / `cache/` → 失败
 *
 * 为什么不用 gitleaks：它是 Go 二进制，本地没有。`.gitleaks.toml` 留给 CI 扫历史，
 * 这个脚本负责「提交前就能跑、零依赖」。
 *
 * 用法：node tools/check-secrets.mjs
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'release', 'out', '.git', '.workbuddy',
  'server/cache', '.shots', 'build', 'spike'
]);
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml',
  '.html', '.css', '.txt', '.toml', '.example'
]);
const MAX_BYTES = 2 * 1024 * 1024;

/** 带会话签名的直播 URL：SecurityKey / encrypt 参数带非空值 */
const SIGNED_URL = /https?:\/\/[^\s"'`<>]{10,}?[?&](?:SecurityKey|securityKey|encrypt|Encrypt)=[A-Za-z0-9%._-]{8,}/g;
/** URL 内嵌个人标识 */
const USERID_URL = /https?:\/\/[^\s"'`<>]{10,}?[?&](?:userid|userId|deviceid|deviceId|uid)=[A-Za-z0-9%._-]{6,}/g;

const findings = [];
const errors = [];

/** 允许的例外：显式列出的文件（模板 / 文档中的特征词说明） */
const ALLOW_FILES = new Set([
  'server/tv-channels.example.json',
  '.gitleaks.toml',
  'tools/check-secrets.mjs'
]);

function rel(p) {
  return relative(ROOT, p).split('\\').join('/');
}

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    const r = rel(full);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_DIRS.has(r)) continue;
      await walk(full);
      continue;
    }
    if (!e.isFile()) continue;
    if (ALLOW_FILES.has(r)) continue;
    // 本地频道文件本身合法（已在 .gitignore），但内容不扫 —— 它就是签名直链的合法容器
    if (r === 'server/tv-channels.local.json') continue;

    const ext = extname(e.name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    let size = 0;
    try {
      size = (await stat(full)).size;
    } catch {
      continue;
    }
    if (size > MAX_BYTES) continue;

    let text;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    // 逐行定位，避免长文件报错时无法定位
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 40) continue;
      SIGNED_URL.lastIndex = 0;
      if (SIGNED_URL.test(line)) {
        findings.push({ file: r, line: i + 1, kind: '带签名的直播直链（SecurityKey/encrypt）' });
        continue;
      }
      USERID_URL.lastIndex = 0;
      if (USERID_URL.test(line)) {
        findings.push({ file: r, line: i + 1, kind: 'URL 内嵌个人标识（userid/deviceid）' });
      }
    }
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function checkTracked() {
  let tracked = '';
  try {
    tracked = git(['ls-files', '--', 'server/tv-channels.local.json', 'server/*.local.json', 'server/cache']);
  } catch (err) {
    errors.push(`无法执行 git ls-files：${err.message}`);
    return;
  }
  const list = tracked.split('\n').map(s => s.trim()).filter(Boolean);
  for (const f of list) {
    findings.push({ file: f, line: 0, kind: '被 git 跟踪（应在 .gitignore 中且不入库）' });
  }
}

async function checkPackRules() {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  } catch (err) {
    errors.push(`读取 package.json 失败：${err.message}`);
    return;
  }
  const files = pkg.build?.files || [];
  const hasLocalExclusion = files.some(f => String(f).includes('.local.json'));
  const hasCacheExclusion = files.some(f => String(f).includes('server/cache'));
  if (!hasLocalExclusion) {
    findings.push({ file: 'package.json', line: 0, kind: 'build.files 未排除 server/*.local.json' });
  }
  if (!hasCacheExclusion) {
    findings.push({ file: 'package.json', line: 0, kind: 'build.files 未排除 server/cache' });
  }
}

console.log('本地隐私门禁（工作区）\n');

await walk(ROOT);
checkTracked();
await checkPackRules();

if (errors.length) {
  console.log('⚠️  检查过程有异常：');
  errors.forEach(e => console.log(`   ${e}`));
  console.log('');
}

if (findings.length === 0) {
  console.log('  ✅ 工作区未发现签名直链 / 个人标识');
  console.log('  ✅ server/*.local.json 与 server/cache 未被 git 跟踪');
  console.log('  ✅ 打包规则已排除本地敏感文件');
  console.log('\n注意：本脚本只扫工作区。git 历史（23e47a3 等）需 gitleaks 或 filter-repo 处理。');
  process.exit(0);
}

console.log(`  ❌ 发现 ${findings.length} 处问题（值未打印）：\n`);
for (const f of findings) {
  console.log(`   ${f.file}${f.line ? ':' + f.line : ''} — ${f.kind}`);
}
console.log('\n处理方式：直播直链放 server/tv-channels.local.json（已 gitignore），源码只留占位。');
process.exit(1);
