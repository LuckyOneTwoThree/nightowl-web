/**
 * 保鲜同步 CLI
 *
 * 用法：
 *   node tools/sync-scores.mjs                          # 预演（不写盘）
 *   node tools/sync-scores.mjs --apply                  # 写回 src/data/fixtures.json
 *   node tools/sync-scores.mjs --months=202609,202610
 *   node tools/sync-scores.mjs --sources=openfootball   # 只用副源（验证降级路径）
 *
 * 纪律：
 *   · 数据更新走脚本，不手工编辑数据文件
 *   · 写盘前校验 `st` 取值域与 `done` 必须有比分（FR-D-01）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { syncScores, applyPatches, validateFixtures } from '../server/scores.js';
import { SOURCES } from '../server/sources/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const APPLY = process.argv.includes('--apply');
const monthsArg = process.argv.find(a => a.startsWith('--months='));
const sourcesArg = process.argv.find(a => a.startsWith('--sources='));
const months = monthsArg ? monthsArg.split('=')[1].split(',') : null;
const sources = sourcesArg ? sourcesArg.split('=')[1].split(',') : null;

const fixturesPath = resolve(ROOT, 'src/data/fixtures.json');
const rules = JSON.parse(readFileSync(resolve(ROOT, 'server/rules.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));

console.log(`本地赛程 ${fixtures.length} 场 · ${APPLY ? '写盘模式' : '预演模式（不写盘）'}`);
console.log(`启用数据源：${(sources || Object.keys(SOURCES)).join(', ')}`);
console.log('开始拉取…');
console.log('');

const t0 = Date.now();
const result = await syncScores({ fixtures, rules, months, sources });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`用时 ${secs}s`);
console.log('');
console.log('数据源健康度（本轮）：');
for (const [sid, s] of Object.entries(result.bySource)) {
  const rate = s.requests ? ((s.ok / s.requests) * 100).toFixed(0) : '—';
  const flag = s.failed === 0 ? '✅' : s.ok === 0 ? '❌' : '⚠️ ';
  console.log(`  ${flag} ${sid.padEnd(13)} 请求 ${String(s.ok).padStart(3)}/${String(s.requests).padStart(3)}（${rate}%）· 事件 ${s.events}`);
}

console.log('');
console.log('合并与折算：');
console.log(`  统一事件          ${result.merged.length}`);
console.log(`  完赛场次          ${result.stats.done}`);
console.log(`  完赛比分写入      ${result.stats.done - result.stats.scoreFromSecondary > 0 ? result.stats.done : result.stats.done}（其中来自副源 ${result.stats.scoreFromSecondary}）`);
console.log(`  开球时间回填      ${result.stats.timeUpdated}`);
console.log(`  解除 tbd          ${result.stats.tbdCleared}`);
console.log(`  标记改期(pp)      ${result.stats.pp}`);
console.log(`  跳过进行中(不落库) ${result.stats.skippedLive}`);
console.log(`  本地无对应场次    ${result.stats.noCounterpart}`);
console.log(`  补丁总数          ${result.patches.size}`);

if (result.conflicts.length) {
  console.log('');
  console.log(`⚠️  多源比分冲突 ${result.conflicts.length} 条（需人工确认，不静默取值）：`);
  result.conflicts.slice(0, 8).forEach(c => {
    console.log(`  ${c.key}  ${c.sources.map(s => `${s.source}=${s.score}`).join('  vs  ')}`);
  });
}

if (result.unmatched.length) {
  console.log('');
  console.log(`本地无对应场次 ${result.unmatched.length} 条（不参与保鲜）：`);
  const byReason = result.unmatched.reduce((o, u) => {
    o[u.reason] = (o[u.reason] || 0) + 1;
    return o;
  }, {});
  Object.entries(byReason).forEach(([r, n]) => console.log(`  ${r}：${n}`));
  console.log('  明细（前 10 条）：');
  result.unmatched.slice(0, 10).forEach(u =>
    console.log(`    ${u.league}  ${u.h} vs ${u.a}  @${u.at}  [${(u.sources || []).join('+')}]`)
  );
}

if (result.errors.length) {
  console.log('');
  console.log(`拉取失败 ${result.errors.length} 次：`);
  result.errors.slice(0, 6).forEach(e => console.log(`  · ${e.source} ${e.league} ${e.unit}: ${e.message.slice(0, 90)}`));
}

/* ---------------- 写盘 ---------------- */
if (APPLY) {
  const { fixtures: next, changed } = applyPatches(fixtures, result.patches);

  const issues = validateFixtures(next);
  if (issues.length) {
    console.error('');
    console.error('✖ 校验未通过，已中止写盘：');
    issues.forEach(i => console.error(`    ${i}`));
    process.exit(1);
  }

  writeFileSync(fixturesPath, JSON.stringify(next), 'utf8');

  const done = next.filter(m => m.st === 'done').length;
  const stillTbd = next.filter(m => m.tbd).length;
  console.log('');
  console.log(`✅ 已写回 ${changed} 场的补丁 → src/data/fixtures.json`);
  console.log(`   当前快照：done ${done} 场 · 仍 tbd ${stillTbd} 场 · 总计 ${next.length}`);
} else {
  console.log('');
  console.log('（预演结束，未写盘。加 --apply 落盘）');
  if (result.patches.size) {
    console.log('');
    console.log('补丁示例（前 8 条）：');
    [...result.patches.entries()].slice(0, 8).forEach(([id, p]) => console.log(`  ${id}  ${JSON.stringify(p)}`));
  }
}
