/**
 * 数据层迁移脚本（T2-4）
 *
 * 从旧小程序项目读取 6 项数据资产，转换为本项目的 JSON 数据层。
 *
 * 关键处理：
 *   1. 统一格式：旧项目是 `module.exports = [...]`（CJS），本项目的 `src/data/*.json`
 *      —— 项目内只保留一种格式，避免解析歧义（技术检查清单 Step 1）
 *   2. **剥离烘焙档位字段 `s`**：该项目本应由构建脚本维护、运行期读取，时间更新后不会跟随。
 *      本产品全部档位走 `tierOf(m) → sleepTier(m.t)` 运行时计算（PRD §7.6 / FR-D-02）。
 *      在数据层直接删除该字段，可从结构上杜绝"读旧档位"的可能。
 *   3. 队徽取 `miniprogram/images/crests/`（111 张）。
 *      ⚠️ 顶层 `images/crests/` 另有 96 张为旧版残留，**不可取**。
 *
 * 运行：node tools/migrate-data.mjs
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, '参考项目/nightowl-terrace/miniprogram');
const OUT_DATA = resolve(ROOT, 'src/data');
const OUT_CRESTS = resolve(ROOT, 'public/crests');

const FILES = [
  { from: 'data/fixtures.full.js', to: 'fixtures.json', key: 'fixtures' },
  { from: 'data/teams.js', to: 'teams.json', key: 'teams' },
  { from: 'data/rivalries.js', to: 'rivalries.json', key: 'rivalries' },
  { from: 'data/storylines.js', to: 'storylines.json', key: 'storylines' },
  { from: 'data/recommendations.seed.js', to: 'recommendations.json', key: 'recommendations' },
  { from: 'data/quips.js', to: 'quips.json', key: 'quips' }
];

if (!existsSync(SRC)) {
  console.error(`✖ 找不到参考项目：${SRC}`);
  console.error('  请先获取参考项目副本（该目录已在 .gitignore 中排除）。');
  process.exit(1);
}

mkdirSync(OUT_DATA, { recursive: true });

/** 剥离 CJS 包装，返回解析后的值 */
function parseCjs(absPath) {
  const raw = readFileSync(absPath, 'utf8');
  const body = raw
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')
    .replace(/^\s*module\.exports\s*=\s*/, '')
    .replace(/;\s*$/, '');
  return JSON.parse(body);
}

console.log('迁移数据层 →', OUT_DATA);
console.log('');

const stats = {};

for (const f of FILES) {
  const abs = resolve(SRC, f.from);
  const data = parseCjs(abs);
  let out = data;
  let note = '';

  // fixtures：剥离烘焙档位字段 s
  if (f.key === 'fixtures') {
    const before = Object.keys(data[0]).join(',');
    let stripped = 0;
    out = data.map(m => {
      if ('s' in m) stripped++;
      return {
        id: m.id,
        l: m.l,
        r: m.r,
        t: m.t,
        tbd: m.tbd,
        st: m.st,
        h: m.h,
        a: m.a,
        sc: m.sc ?? null
        // s  —— 已废弃，运行时由 tierOf(m) 计算
        // tv —— 实测非空 0 条，本产品无结构化转播字段，不迁移
      };
    });
    note = `（剥离 s ×${stripped}，丢弃全空 tv 字段）`;
  }

  writeFileSync(resolve(OUT_DATA, f.to), JSON.stringify(out), 'utf8');
  stats[f.key] = Array.isArray(out) ? out.length : 1;
  console.log(`  ✅ ${f.to.padEnd(22)} ${String(Array.isArray(out) ? out.length : 1).padStart(5)} 条 ${note}`);
}

// ---- 队徽 ----
console.log('');
mkdirSync(OUT_CRESTS, { recursive: true });
const crestDir = resolve(SRC, 'images/crests');
const crests = readdirSync(crestDir).filter(f => f.toLowerCase().endsWith('.png'));
for (const f of crests) {
  copyFileSync(join(crestDir, f), join(OUT_CRESTS, f));
}
console.log(`  ✅ 队徽 → public/crests/  ${crests.length} 张`);

if (crests.length !== 111) {
  console.warn(`  ⚠️ 预期 111 张，实得 ${crests.length} 张，请核对是否取错了目录`);
}

// ---- 自检 ----
console.log('');
console.log('自检：');

const fixtures = JSON.parse(readFileSync(resolve(OUT_DATA, 'fixtures.json'), 'utf8'));
const teams = JSON.parse(readFileSync(resolve(OUT_DATA, 'teams.json'), 'utf8'));
const recs = JSON.parse(readFileSync(resolve(OUT_DATA, 'recommendations.json'), 'utf8'));
const crestSet = new Set(crests.map(f => f.replace(/\.png$/i, '')));

const checks = [
  ['fixtures 总数 = 1897', fixtures.length === 1897],
  ['无烘焙字段 s', !('s' in fixtures[0])],
  ['st 取值域 ⊆ {sched, done, pp}', fixtures.every(m => ['sched', 'done', 'pp'].includes(m.st))],
  ['teams = 111', teams.length === 111],
  ['队徽 = 111', crests.length === 111],
  ['联赛含 SCG', new Set(fixtures.map(m => m.l)).has('SCG')],
  ['球队 id 全部有队徽', teams.every(t => crestSet.has(t.id))],
  ['推荐层 id 均能在 fixtures 命中', recs.every(r => fixtures.some(m => m.id === r.m))]
];

let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? '✅' : '❌'} ${label}`);
  if (!pass) ok = false;
}

console.log('');
console.log(ok ? '迁移完成，全部自检通过。' : '迁移完成，但存在未通过的自检项，请核对。');
process.exit(ok ? 0 : 1);
