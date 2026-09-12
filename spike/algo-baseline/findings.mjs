/**
 * 基线深挖：验证过程中暴露的两个新问题
 *
 * 问题 A：D6「主队加成 +25」的真实影响面，与原方案/审查意见的描述不符
 * 问题 B：0-1 背包在真实数据上**退化**——零成本场次可无限装载
 *
 * 运行：node spike/algo-baseline/findings.mjs
 */

import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as E from '../../src/core/engine.js';
import { loadRefData } from './load-ref.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const F = loadRefData('fixtures.full.js');
const RIV = loadRefData('rivalries.js');
const ST = loadRefData('storylines.js');
const REC = loadRefData('recommendations.seed.js');
const recMap = {};
REC.forEach(r => { recMap[r.m] = r; });

const NOW = Date.now();
const FOLLOWED = ['ARS'];
const LEAGUES_6 = ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL'];

const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const H = (s) => { log(''); log(`## ${s}`); log(''); };
const pct = (x, n) => (n ? (x / n * 100).toFixed(1) + '%' : '0%');

log('# 算法基线深挖报告');
log('');
log(`生成时间：${new Date().toISOString()}`);

// ============================================================
H('问题 A：主队加成 +25 的真实影响面');

// A1: 主队加成是否影响 Hero 排序？
log('**A1 · 是否影响「今晚之选」排序**');
log('');
const futureNights = [];
const bj = E.bjDateStr(NOW);
const baseTs = Date.parse(bj + 'T00:00:00Z');
for (let i = 0; i < 90; i++) futureNights.push(new Date(baseTs + i * 86400000).toISOString().slice(0, 10));

const weightSet = [0, 5, 10, 15, 25, 40];
log('| 主队加成 | 90 夜窗口 Hero 与 +25 的差异数 |');
log('| ---: | ---: |');
const heroOf = (w) => futureNights.map(n => {
  const slice = F.filter(m => E.owlDay(m.t) === n);
  const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6, { ...E.DEFAULT_WEIGHTS, followedBonus: w });
  return p.hero ? `${p.hero.m.h}-${p.hero.m.a}` : 'NONE';
});
const heroBase = heroOf(25);
for (const w of weightSet) {
  const hs = heroOf(w);
  let diff = 0;
  for (let i = 0; i < hs.length; i++) if (hs[i] !== heroBase[i]) diff++;
  log(`| +${w} | ${diff} / ${futureNights.length} |`);
}
log('');
log('> 原因：`pickToday` 排序的**第 1 优先级是 `isFollowed` 布尔硬比较**，权重只改变指数数值，不参与排序。');
log('> 所以「+25 会不会选错 Hero」这个问题本身不成立——原方案与审查意见对这条风险**定性错误**。');

// A2: 主队加成影响什么？
log('');
log('**A2 · 那么 +25 实际影响什么**');
log('');
const s0 = F.find(m => m.st === 'sched' && !m.tbd && !m.tbd);
const evArs = E.evaluate(
  F.find(m => (m.h === 'ARS' || m.a === 'ARS') && m.st === 'sched' && !m.tbd),
  recMap, RIV, ST, FOLLOWED, LEAGUES_6
);
const arsMatch = F.find(m => (m.h === 'ARS' || m.a === 'ARS') && m.st === 'sched' && !m.tbd);
log(`以 ${arsMatch.h} vs ${arsMatch.a}（${arsMatch.t}，${E.tierOf(arsMatch).label}）为例：`);
log('');
log('| 主队加成 | 权重 W | 夜猫指数（展示值） | 背包价值（指数×10 取整） |');
log('| ---: | ---: | ---: | ---: |');
for (const w of weightSet) {
  const w2 = { ...E.DEFAULT_WEIGHTS, followedBonus: w };
  const idx = E.owlIndex(evArs, arsMatch, w2);
  log(`| +${w} | ${evArs.star * 10 + E.storyBonus(evArs, w2) + w + E.leagueBonus(evArs, w2)} | ${idx.toFixed(1)} | ${Math.round(idx * 10)} |`);
}
log('');
log('> 影响面是① **展示给用户的指数数值**（越高越"值得熬"）② **背包的价值函数**。');
log('> 结论：D6-A 应改为「**指数数值是否可信**」，而非「Hero 会不会选错」。');

// A3: 证实原方案描述的等价现象
log('');
log('**A3 · 验证「凌晨主队战 ≈ 傍晚 ★1 中立赛」是否真实存在**');
log('');
const cands = [];
for (const m of F) {
  if (m.st !== 'sched' || m.tbd) continue;
  if (!FOLLOWED.includes(m.h) && !FOLLOWED.includes(m.a)) continue;
  const tier = E.tierOf(m);
  if (tier.tier < 3) continue;
  const ev = E.evaluate(m, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  cands.push({ m, idx: E.owlIndex(ev, m), tier, star: ev.star });
}
log(`数据中「主队出战且档位 ≥ S3」的未来场次：**${cands.length}** 场`);
if (cands.length) {
  log('');
  log('| 场次 | 时间 | 档位 | 星级 | 夜猫指数 |');
  log('| :--- | :--- | :--- | ---: | ---: |');
  cands.slice(0, 10).forEach(c => log(`| ${c.m.h} vs ${c.m.a} | ${c.m.t} | ${c.tier.label} | ${'★'.repeat(c.star)} | ${c.idx.toFixed(1)} |`));
}
const s0Neutral = F.filter(m => {
  if (m.st !== 'sched' || m.tbd) return false;
  if (E.tierOf(m).tier !== 0) return false;
  const ev = E.evaluate(m, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  return ev.star === 1 && !ev.isFollowed;
});
log('');
log(`对照：「S0 档 ★1 中立赛」共 **${s0Neutral.length}** 场，其指数恒为 **10.0**（W=10，成本 0 → 10÷1.0）。`);
log('');
log('> 因此原方案 §3.6 的等价性描述**在数学上成立**，但需要修正结论：');
log('> 它不影响 Hero 排序，而是让**指数这一展示指标失去区分度**——S0 的 ★1 场次指数固定 10.0，');
log('> 而凌晨主队战也只有 10.0 上下，「指数高 = 值得熬」的直觉映射被破坏。');

// ============================================================
H('问题 B：0-1 背包在真实数据上退化');

const weekStart = E.weekStartBJ(NOW);
const weekEnd = weekStart.ts + 7 * 86400000;
const weekMatches = F.filter(m => { const t = E.ts(m.t); return t >= weekStart.ts && t < weekEnd; });

log(`本周窗口：${weekStart.str} 起 7 天，共 ${weekMatches.length} 场`);
log('');

const eligible = weekMatches.filter(m => m.st === 'sched' && !m.tbd);
const zeroCost = eligible.filter(m => E.tierOf(m).cost === 0);
log(`其中可入包场次 ${eligible.length} 场，**零成本（S0）场次 ${zeroCost.length} 场（${pct(zeroCost.length, eligible.length)}）**`);
log('');

log('**B1 · 背包为何退化**');
log('');
log('背包的重量 = `sleepTier(m).cost × 2`。S0 场次成本 0 → **重量 0**。');
log('重量为 0 的物品在 0-1 背包中**不消耗容量**，因此有多少装多少；');
log('而每个 S0 场次价值 = 指数 10.0 × 10 = 100 分 → 算法会**全部装入**。');

log('');
log('**B2 · 实测各预算下的入选场次数**');
log('');
log('| 周预算 | 入选场次 | 实际占用 | 其中 S0 场次 | 最大单场占预算 |');
log('| ---: | ---: | ---: | ---: | ---: |');
for (const b of [1.0, 2.5, 4.0, 6.0, 8.0]) {
  const p = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, b, LEAGUES_6);
  const z = p.best.filter(e => E.tierOf(e.m).cost === 0).length;
  const maxR = p.best.length ? Math.max(...p.best.map(e => E.tierOf(e.m).cost)) / b : 0;
  log(`| ${b.toFixed(1)}h | **${p.best.length}** | ${p.used.toFixed(1)}h | ${z} | ${(maxR * 100).toFixed(0)}% |`);
}
log('');
log('> 而 Stitch 设计稿写的是「**算法精选组合（已自动入选 3 场）**」。');
log('> 真实算法给出的是一张 20 场的清单——**这不是"规划"，是"全选"**。');

log('');
log('**B3 · 三个修复方案的效果对比**（周预算 4.0h）');
log('');

// 方案 1：数量上限 N
const capN = (matches, budget, n) => {
  const p = E.planWeek(matches, recMap, RIV, ST, FOLLOWED, budget, LEAGUES_6);
  const sorted = [...p.best].sort((a, b) => b.index - a.index);
  return { best: sorted.slice(0, n), used: sorted.slice(0, n).reduce((s, e) => s + E.tierOf(e.m).cost, 0) };
};
// 方案 2：S0 场次不进背包，单列为「零成本顺带」
const detachS0 = (matches, budget) => {
  const nonZero = matches.filter(m => E.tierOf(m).cost > 0);
  const p = E.planWeek(nonZero, recMap, RIV, ST, FOLLOWED, budget, LEAGUES_6);
  const zero = matches.filter(m => E.tierOf(m).cost === 0 && m.st === 'sched' && !m.tbd);
  return { best: p.best, used: p.used, zeroCount: zero.length };
};
// 方案 3：数量上限 + S0 分离
const both = (matches, budget, n) => {
  const d = detachS0(matches, budget);
  const sorted = [...d.best].sort((a, b) => b.index - a.index);
  return { best: sorted.slice(0, n), used: sorted.slice(0, n).reduce((s, e) => s + E.tierOf(e.m).cost, 0), zeroCount: d.zeroCount };
};

const p0 = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, 4.0, LEAGUES_6);
const p1 = capN(weekMatches, 4.0, 5);
const p2 = detachS0(weekMatches, 4.0);
const p3 = both(weekMatches, 4.0, 5);

log('| 方案 | 入选场次 | 占用 | 结余 | 是否解决退化 |');
log('| :--- | ---: | ---: | ---: | :--- |');
log(`| 原版（现状） | ${p0.best.length} | ${p0.used.toFixed(1)}h | ${(4.0 - p0.used).toFixed(1)}h | ❌ |`);
log(`| ① 数量上限 N=5 | ${p1.best.length} | ${p1.used.toFixed(1)}h | ${(4.0 - p1.used).toFixed(1)}h | ✅ 但 S0 仍挤占名额 |`);
log(`| ② S0 分离（单列「零成本顺带 ${p2.zeroCount} 场」） | ${p2.best.length} | ${p2.used.toFixed(1)}h | ${(4.0 - p2.used).toFixed(1)}h | ✅ |`);
log(`| ③ 数量上限 N=5 + S0 分离 | ${p3.best.length} | ${p3.used.toFixed(1)}h | ${(4.0 - p3.used).toFixed(1)}h | ✅ 推荐 |`);
log('');
log('方案 ③ 的入选明细：');
log('');
p3.best.forEach(e => log(`- ${e.m.t} ${e.m.h} vs ${e.m.a} · ${E.tierOf(e.m).label}(${E.tierOf(e.m).cost}h) · 指数 ${e.index.toFixed(1)} · ${e.ev.isFollowed ? '**主队**' : '中立'}`));
log(`- 另：零成本顺带场次 ${p3.zeroCount} 场（不在预算内计数）`);

// ============================================================
H('问题 C：Hero 质量的「周末 / 平日」断层');

const seasonNights = [];
const nightSet = new Set(F.map(m => E.owlDay(m.t)));
const sortedNights = [...nightSet].sort();

const rows = sortedNights.map(n => {
  const slice = F.filter(m => E.owlDay(m.t) === n);
  const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  if (!p.hero) return { n, empty: true, dow: new Date(n + 'T00:00:00Z').getUTCDay() };
  return { n, h: p.hero, dow: new Date(n + 'T00:00:00Z').getUTCDay() };
});

const wkEnd = rows.filter(r => !r.empty && (r.dow === 5 || r.dow === 6 || r.dow === 0));
const wkDay = rows.filter(r => !r.empty && r.dow >= 1 && r.dow <= 4);
const emptyNights = rows.filter(r => r.empty);

const starHist = (arr) => {
  const d = { 1: 0, 2: 0, 3: 0 };
  arr.forEach(r => { d[r.h.ev.star] = (d[r.h.ev.star] || 0) + 1; });
  return d;
};
const idxAvg = (arr) => arr.length ? (arr.reduce((s, r) => s + r.h.index, 0) / arr.length).toFixed(1) : '—';

const hw = starHist(wkEnd), hd = starHist(wkDay);
log(`全赛季有赛的夜猫日：**${rows.length - emptyNights.length}** 晚（另有 ${emptyNights.length} 晚无赛程）`);
log('');
log('| 分组 | 夜数 | Hero 平均指数 | ★1 | ★2 | ★3 | ★3 占比 |');
log('| :--- | ---: | ---: | ---: | ---: | ---: | ---: |');
log(`| 周末（周五–周日） | ${wkEnd.length} | ${idxAvg(wkEnd)} | ${hw[1]} | ${hw[2]} | ${hw[3]} | ${pct(hw[3], wkEnd.length)} |`);
log(`| 平日（周一–周四） | ${wkDay.length} | ${idxAvg(wkDay)} | ${hd[1]} | ${hd[2]} | ${hd[3]} | ${pct(hd[3], wkDay.length)} |`);
log('');
log('> 平日 Hero 大量落在 ★1（L3 兜底看点），指数普遍在 3–10 区间；');
log('> 而 Stitch 设计稿的 Hero 卡表现的是「★★★ · 指数 28.5 · 争冠天王山对决」——');
log('> **那只是周末形态**。平日 Hero 是"矮子里拔将军"，产品必须承认这个事实，');
log('> 或者平日走「无球日/低看点降级」逻辑（展示下一场焦点战倒计时），而不是硬撑一张 Hero 卡。');

// 平日 Hero 样例
log('');
log('平日 Hero 样例（连续 10 个平日）：');
log('');
log('| 夜猫日 | Hero | 星级 | 指数 |');
log('| :--- | :--- | ---: | ---: |');
wkDay.slice(0, 10).forEach(r => log(`| ${r.n} | ${r.h.m.h} vs ${r.h.m.a} | ${'★'.repeat(r.h.ev.star)} | ${r.h.index.toFixed(1)} |`));

// ============================================================
H('深挖结论');

log('| # | 发现 | 与本项目现有文档的关系 |');
log('| --- | :--- | :--- |');
log('| A | 主队加成不参与 Hero 排序（排序第 1 位是 isFollowed 布尔比较） | ⚠️ **原方案 §3.6 与审查意见的定性有误**，风险应重述为"指数数值区分度" |');
log('| B | **背包在真实数据上退化**：S0 场次重量为 0 → 无限装载 → 预算 4.0h 给出 20 场 | 🔴 **两份文档均未发现**，比"主队硬保"严重得多 |');
log('| C | Hero 质量存在周末/平日断层，平日大量为 ★1 | ⚠️ 设计稿只呈现了周末形态，产品需补低看点降级策略 |');

const report = out.join('\n');
writeFileSync(resolve(__dirname, 'FINDINGS.md'), report, 'utf8');
console.log('\n报告已写入 spike/algo-baseline/FINDINGS.md');
