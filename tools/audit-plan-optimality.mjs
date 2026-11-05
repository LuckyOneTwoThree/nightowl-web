/**
 * 审计：planWeek 的「关注球队预填充」是否破坏全局最优
 *
 * 背景（外部评审 2026-11-05 提出，本脚本用于复算）：
 * planWeek 先把关注球队场次贪心塞入，再用背包填中立场次 —— 不是全局最优。
 *
 * 用法：node tools/audit-plan-optimality.mjs [--weeks=12] [--top=14]
 *
 * 暴力上界说明：只对指数前 top 个候选做子集枚举（2^top）。
 * 若 planWeek 的价值低于某个**可行**子集，即证明确实次优（不必穷尽全池）。
 */
import * as E from '../src/core/engine.js';
import { getFixtures, REC_MAP, rivalries, storylines } from '../src/data/index.js';

const arg = (k, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const WEEKS = arg('weeks', 12);
const TOP = arg('top', 14);
const followed = ['ARS'];
const leagues = ['PL'];
const budgets = [2, 2.5, 3, 3.5, 4, 4.5, 5];

const fixtures = getFixtures();
const val = e => Math.round(e.index * 10);
const sumVal = list => list.reduce((s, e) => s + val(e), 0);
const start = E.weekStartBJ(Date.now());
const now = Date.now();

let checked = 0;
const bad = [];

for (let wk = 0; wk < WEEKS; wk++) {
  const from = start.ts + wk * 7 * 86400000;
  const to = from + 7 * 86400000;
  const week = fixtures.filter(m => {
    const t = E.ts(m.t);
    return t >= from && t < to;
  });
  const eligible = week.filter(
    m => m.st === 'sched' && !m.tbd && E.ts(m.t) + E.MATCH_DURATION_MS > now
  );
  if (!eligible.length) continue;

  const pool = eligible
    .map(m => {
      const ev = E.evaluate(m, REC_MAP, rivalries, storylines, followed, leagues);
      return { m, ev, index: E.owlIndex(ev, m, E.DEFAULT_WEIGHTS), cost: E.tierOf(m).cost };
    })
    .sort((a, b) => b.index - a.index)
    .slice(0, TOP);

  for (const budget of budgets) {
    checked++;
    const plan = E.planWeek(week, REC_MAP, rivalries, storylines, followed, budget, leagues);
    const pv = sumVal(plan.best);
    const cap = Math.round(budget * 2);
    let bv = -1;
    let bset = [];
    for (let mask = 0; mask < (1 << pool.length); mask++) {
      let w = 0;
      let v = 0;
      const set = [];
      let bad2 = false;
      for (let i = 0; i < pool.length; i++) {
        if (!(mask & (1 << i))) continue;
        const e = pool[i];
        w += Math.round(e.cost * 2);
        if (w > cap) { bad2 = true; break; }
        if (set.some(x => E.exclusiveMatches(x.m, e.m))) { bad2 = true; break; }
        v += val(e);
        set.push(e);
      }
      if (bad2) continue;
      if (v > bv) { bv = v; bset = set; }
    }
    if (bv > pv) {
      bad.push({
        week: wk,
        budget,
        plan: plan.best.map(e => `${e.m.id}(${e.index.toFixed(1)})`).join(' + '),
        planVal: pv,
        bruteVal: bv,
        brute: bset.map(e => `${e.m.id}(${e.index.toFixed(1)})`).join(' + ')
      });
    }
  }
}

console.log(`扫描 ${checked} 个「周 × 预算」组合（前 ${TOP} 候选暴力），次优 ${bad.length} 个`);
bad.forEach(s =>
  console.log(`  week${s.week} 预算 ${s.budget}h：计划 ${s.plan} = ${s.planVal} ｜ 可行更优 ${s.brute} = ${s.bruteVal}`)
);
