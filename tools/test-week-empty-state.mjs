/**
 * 「本周精选为空」的空态语义回归
 *
 * 背景（实测暴露）：WeekView 的空态文案只看 plan.evs，零成本（S0）场次不进背包，
 * 于是出现「本周精选 0/5 + 零成本顺带 1」却写着「本周暂无可安排的未开赛场次」的同屏矛盾。
 * 2027-04 起有 6 个周次命中（best=0, zeroCount=1~2）。
 *
 * 这里直接调用 core 纯函数 weekBestEmptyState，锁定每种空态的判据；
 * 界面只负责把 kind 映射成文案，不再自己写一套 if/else。
 *
 * 运行：node tools/test-week-empty-state.mjs
 */

import { weekBestEmptyState } from '../src/core/week-risk.js';

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
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('一、空态判据');

// 有入选场次 → 不属空态
ok('★ 有精选 → selected', weekBestEmptyState({ best: [{}, {}] }).kind === 'selected');

// 历史周优先：历史周即使有零成本，也按「历史周」讲
ok('★ 历史周 → past',
  weekBestEmptyState({ best: [], zeroCount: 1, past: true }).kind === 'past');

// 只有 tbd（未来周最常见）：必须说「时间待定」，不能说「无比赛」
ok('★ 全 tbd → tbd',
  weekBestEmptyState({ best: [], evs: [], tbdCount: 12, hasScheduled: false }).kind === 'tbd',
  weekBestEmptyState({ best: [], evs: [], tbdCount: 12, hasScheduled: false }).kind);
ok('★ tbd 计数透传给文案', weekBestEmptyState({ best: [], evs: [], tbdCount: 12 }).tbdCount === 12);

// 真实缺陷场景：精选为空、无可排候选、但有零成本场次
ok('★ 精选为空 + 零成本非空 → zero-only（不能说「无可安排」）',
  weekBestEmptyState({ best: [], evs: [], zeroCount: 1, hasScheduled: false }).kind === 'zero-only',
  weekBestEmptyState({ best: [], evs: [], zeroCount: 1, hasScheduled: false }).kind);
ok('★ zero-only 透传零成本场次数',
  weekBestEmptyState({ best: [], evs: [], zeroCount: 2 }).zeroCount === 2);

// 确实没有比赛
ok('★ 无候选、无零成本、无 tbd → no-match',
  weekBestEmptyState({ best: [], evs: [], zeroCount: 0, tbdCount: 0, hasScheduled: false }).kind === 'no-match');

// 有候选但预算选不出 → 应引导加预算
ok('★ 有候选但预算不足 → budget',
  weekBestEmptyState({ best: [], evs: [{}, {}], zeroCount: 0, hasScheduled: true }).kind === 'budget');

// 有可排场次、只是都在零成本池
ok('★ 有可排场次但全为零成本 → zero-only',
  weekBestEmptyState({ best: [], evs: [], zeroCount: 3, hasScheduled: true }).kind === 'zero-only');

console.log('\n二、与真实赛程对账（防回归到「同屏矛盾」）');

// 用真实 fixtures 复算：任何「精选为空」的周，都不能同时被判成 no-match 而又有零成本场次
const { computeWeek } = await import('../src/core/owl.js');
const E = await import('../src/core/engine.js');

const prefs = {
  followedTeams: [],
  followedLeagues: ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL'],
  weeklyBudget: 4
};
const base = E.ts('2026-10-01T12:00');
let scanned = 0;
let contradictions = 0;
let zeroOnlyWeeks = 0;
for (let i = 0; i < 40; i++) {
  const now = base + i * 7 * 86400000;
  const w = computeWeek(now, prefs, { weekOffset: 0 });
  const tbd = w.days.reduce((s, d) => s + d.matches.filter(m => m.tbd).length, 0);
  const hasScheduled = w.plan.evs.length > 0 || w.plan.zeroCount > 0;
  const st = weekBestEmptyState({
    best: w.plan.best,
    zeroCount: w.plan.zeroCount,
    evs: w.plan.evs,
    tbdCount: tbd,
    hasScheduled
  });
  scanned++;
  if (st.kind === 'zero-only') zeroOnlyWeeks++;
  if (st.kind === 'no-match' && w.plan.zeroCount > 0) contradictions++;
}
ok('★ 扫描 40 周：没有「判成 no-match 却存在零成本场次」的矛盾',
  contradictions === 0, `矛盾 ${contradictions} 周`);
ok('真实数据里确实存在 zero-only 周（说明该分支不是死代码）',
  zeroOnlyWeeks > 0, `${zeroOnlyWeeks} 周`);
console.log(`  · 扫描 ${scanned} 周，zero-only ${zeroOnlyWeeks} 周`);

console.log('\n────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
