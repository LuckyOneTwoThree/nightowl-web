/**
 * 热路径实测：用真实数据集量化各派生计算的实际开销
 *
 * 用法：node tools/bench-hotpaths.mjs
 * 纯离线，不依赖网络。测的是「用户实际会触发多少次全表扫描」。
 */

import { getFixtures, setFixtures } from '../src/data/index.js';
import fixtures from '../src/data/fixtures.json' with { type: 'json' };
import { computeMatchStats, computeTeamForm, computeSeasonStats, computeHeadToHead } from '../src/core/stats.js';
import { computeTonight, computeWeek, computeScheduleRows, defaultScheduleFilters, liveCountAt, sameNightPicks, dayCounts } from '../src/core/owl.js';
import { evalOne } from '../src/core/owl.js';
import { ts } from '../src/core/engine.js';

setFixtures(fixtures);
const ALL = getFixtures();
const N = ALL.length;

function bench(label, fn, iterations = 1) {
  // 预热一次（JIT / 缓存），避免首次解析开销污染结论
  fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, ms: ms / iterations, iterations };
}

const prefs = { followedTeams: ['ARS', 'MCI'], followedLeagues: ['PL', 'UCL'], weeklyBudget: 4.0 };

console.log('═'.repeat(64));
console.log(`数据集：${N} 场`);
console.log('═'.repeat(64));

/* ---------- 1. stats.js：选中一场比赛要扫几次全表 ---------- */
// 挑一场真实存在的比赛（有主客队、已完赛带比分更贴近情报页场景）
const sample = ALL.find(m => m.st === 'done' && m.sc) || ALL[0];
console.log(`\n[1] computeMatchStats（选中比赛 = ${sample.h} vs ${sample.a}）`);
const r1 = bench('computeMatchStats 一次', () => computeMatchStats(sample));
console.log(`    ${r1.ms.toFixed(2)} ms / 次`);
console.log(`    内部全表扫描次数：form×2 + season×2 + h2h×1 = 5 次 filter(1897)`);

// 拆开测单项，确认每个子函数本身是不是全表扫
const r1a = bench('  computeTeamForm(单队)', () => computeTeamForm(sample.h, sample, ALL));
const r1b = bench('  computeSeasonStats(单队)', () => computeSeasonStats(sample.h, sample.l, ALL));
const r1c = bench('  computeHeadToHead', () => computeHeadToHead(sample.h, sample.a, ALL, sample));
console.log(`    ${r1a.ms.toFixed(2)} / ${r1b.ms.toFixed(2)} / ${r1c.ms.toFixed(2)} ms`);

/* ---------- 2. computeScheduleRows：搜索框每键入一次 ---------- */
console.log(`\n[2] computeScheduleRows（搜索框每次键入触发）`);
const filters = defaultScheduleFilters();
const r2 = bench('空查询', () => computeScheduleRows(Date.now(), prefs, filters), 20);
const f2 = { ...filters, query: 'ars' };
const r2q = bench('带查询 ars', () => computeScheduleRows(Date.now(), prefs, f2), 20);
console.log(`    空查询 ${r2.ms.toFixed(2)} ms / 次（×20 取平均）`);
console.log(`    带查询 ${r2q.ms.toFixed(2)} ms / 次`);
const r2d = bench('dayCounts（日期条圆点）', () => dayCounts(), 20);
console.log(`    dayCounts ${r2d.ms.toFixed(2)} ms / 次`);

/* ---------- 3. liveCountAt：每 30 秒 ---------- */
console.log(`\n[3] liveCountAt（App 每 30 秒触发一次）`);
const r3 = bench('liveCountAt', () => liveCountAt(Date.now()), 50);
console.log(`    ${r3.ms.toFixed(2)} ms / 次（×50 取平均）`);
console.log(`    内部：全表 filter + 每场 matchState()`);

/* ---------- 4. sameNightPicks ---------- */
console.log(`\n[4] sameNightPicks（右栏同夜推荐，切场时触发）`);
const r4 = bench('sameNightPicks', () => sameNightPicks(sample, prefs, 3, Date.now()), 20);
console.log(`    ${r4.ms.toFixed(2)} ms / 次（×20 取平均）`);
console.log(`    内部：过滤同夜 → 逐场 evalOne → 排序`);

/* ---------- 5. computeTonight / computeWeek ---------- */
console.log(`\n[5] 视图模型整体（App 每 30 秒重算）`);
const r5 = bench('computeTonight', () => computeTonight(Date.now(), prefs), 20);
console.log(`    computeTonight ${r5.ms.toFixed(2)} ms / 次`);
const r5w = bench('computeWeek', () => computeWeek(Date.now(), prefs), 10);
console.log(`    computeWeek   ${r5w.ms.toFixed(2)} ms / 次`);

/* ---------- 6. evalOne 单次成本（虚拟滚动每可见行） ---------- */
console.log(`\n[6] evalOne（虚拟滚动只算可见行，量化单行成本）`);
const r6 = bench('evalOne', () => evalOne(sample, prefs), 2000);
console.log(`    ${r6.ms.toFixed(4)} ms / 次（×2000 取平均）`);
console.log(`    全季 1897 行全算 = ${(r6.ms * N).toFixed(1)} ms（若误用 children 模式）`);

console.log('\n' + '═'.repeat(64));
console.log('结论见 docs/OPTIMIZATION-PLAN.md');
