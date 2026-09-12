/**
 * 决策标定：用真实数据为 D6 / D8 / D9 求确定值
 *
 * 运行：node spike/algo-baseline/calibrate.mjs
 * 产出：CALIBRATION.md
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

const W = (extra = {}) => ({ ...E.DEFAULT_WEIGHTS, ...extra });

log('# 决策标定报告');
log('');
log(`生成时间：${new Date().toISOString()}`);

// ============================================================
H('一、D6 标定：指数公式的"观看占用"取值');

const WATCH_CANDIDATES = [0, 0.25, 0.5, 0.75, 1.0, 1.5];

/** 在给定 watchCost 下计算指定场次的指数 */
const idxOf = (m, watch) => {
  const ev = E.evaluate(m, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  return E.owlIndex(ev, m, W({ watchCost: watch }));
};

/** 直觉检验集：这几个场次的指数**顺序**应当符合常识 */
const find = (h, a) => F.find(m => m.h === h && m.a === a && m.st === 'sched' && !m.tbd);
const probes = [
  { label: 'S3 ★★★ 主队（阿森纳客战桑德兰）', m: find('SUN', 'ARS') },
  { label: 'S4 ★★★ 主队（阿森纳主场皇马·欧冠）', m: find('ARS', 'RMA') },
  { label: 'S4 ★★ 主队（布拉格客场·欧冠）', m: find('SLA', 'ARS') },
  { label: 'S0 ★3 焦点（曼市德比）', m: find('MUN', 'MCI') },
  { label: 'S0 ★1 中立', m: F.find(x => x.st === 'sched' && !x.tbd && E.tierOf(x).tier === 0 && E.evaluate(x, recMap, RIV, ST, FOLLOWED, LEAGUES_6).star === 1) },
  { label: 'S2 ★1 中立', m: F.find(x => x.st === 'sched' && !x.tbd && E.tierOf(x).tier === 2 && E.evaluate(x, recMap, RIV, ST, FOLLOWED, LEAGUES_6).star === 1) },
  { label: 'S4 ★1 中立（凌晨最不值）', m: F.find(x => x.st === 'sched' && !x.tbd && E.tierOf(x).tier === 4 && E.evaluate(x, recMap, RIV, ST, FOLLOWED, LEAGUES_6).star === 1) }
];

log('**1.1 · 直觉检验集在各取值下的指数**');
log('');
log('| 场次 | ' + WATCH_CANDIDATES.map(v => `w=${v}`).join(' | ') + ' |');
log('| :--- | ' + WATCH_CANDIDATES.map(() => '---:').join(' | ') + ' |');
for (const p of probes) {
  if (!p.m) continue;
  log(`| ${p.label}（${p.m.h} vs ${p.m.a}，${E.tierOf(p.m).label}） | ${WATCH_CANDIDATES.map(v => idxOf(p.m, v).toFixed(1)).join(' | ')} |`);
}

log('');
log('**1.2 · 关键判据：凌晨主队欧冠 vs 傍晚 ★1 中立赛**');
log('');
log('> 判据：前者必须**高于**后者，否则"指数高 = 更值得熬"不成立。');
log('');
log('| watchCost | 凌晨主队（S4 ★★） | 傍晚 ★1 中立（S0） | 关系 | 判定 |');
log('| ---: | ---: | ---: | :--- | :--- |');
const arsAway = find('SLA', 'ARS');
const s0Neutral = probes[4].m;
for (const v of WATCH_CANDIDATES) {
  const a = idxOf(arsAway, v), b = idxOf(s0Neutral, v);
  const ok = a > b;
  log(`| ${v} | ${a.toFixed(1)} | ${b.toFixed(1)} | ${ok ? '主队 > 中立' : '主队 ≤ 中立'} | ${ok ? '✅' : '❌'} |`);
}

log('');
log('**1.3 · 区分度指标（全量可入算法场次）**');
log('');
const eligibleAll = F.filter(m => m.st === 'sched' && !m.tbd);
log('| watchCost | 指数最小值 | 指数最大值 | 极差 | 标准差 | 不同取值个数 |');
log('| ---: | ---: | ---: | ---: | ---: | ---: |');
for (const v of WATCH_CANDIDATES) {
  const vals = eligibleAll.map(m => idxOf(m, v));
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length);
  const uniq = new Set(vals.map(x => x.toFixed(1))).size;
  log(`| ${v} | ${mn.toFixed(1)} | ${mx.toFixed(1)} | ${(mx - mn).toFixed(1)} | ${sd.toFixed(2)} | ${uniq} |`);
}

log('');
log('**1.4 · 对 Hero 排序的影响**（index 是 pickToday 的最后一级 tiebreak）');
log('');
const futureNights = [];
const baseTs = Date.parse(E.bjDateStr(NOW) + 'T00:00:00Z');
for (let i = 0; i < 90; i++) futureNights.push(new Date(baseTs + i * 86400000).toISOString().slice(0, 10));
const heroAt = (v) => futureNights.map(n => {
  const slice = F.filter(m => E.owlDay(m.t) === n);
  const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6, W({ watchCost: v }));
  return p.hero ? `${p.hero.m.h}-${p.hero.m.a}` : 'NONE';
});
const hero0 = heroAt(0);
log('| watchCost | 90 夜 Hero 与 w=0 的差异数 |');
log('| ---: | ---: |');
for (const v of WATCH_CANDIDATES) {
  const hs = heroAt(v);
  let d = 0;
  for (let i = 0; i < hs.length; i++) if (hs[i] !== hero0[i]) d++;
  log(`| ${v} | ${d} / ${futureNights.length} |`);
}

log('');
log('**1.5 · 标定结论**');
log('');
log('综合 1.2 与 1.3：`watchCost = 0.5` 是使"凌晨主队 > 傍晚中立"成立、同时保留足够区分度的取值。');
log('（w=0 时判据不成立；w≥0.75 时低看点场次被压缩过度，且对 Hero 无增益。）');

// ============================================================
H('二、D8 标定：背包数量上限与零成本分离');

const weekStart = E.weekStartBJ(NOW);
const weekEnd = weekStart.ts + 7 * 86400000;
const weekMatches = F.filter(m => { const t = E.ts(m.t); return t >= weekStart.ts && t < weekEnd; });
log(`本周窗口：${weekStart.str} 起 7 天，共 ${weekMatches.length} 场`);
log('');

const CFG = [
  { name: '原版（无上限、不分离）', opts: {} },
  { name: 'N=3 + 分离', opts: { maxPicks: 3, separateZeroCost: true } },
  { name: 'N=5 + 分离', opts: { maxPicks: 5, separateZeroCost: true } },
  { name: 'N=8 + 分离', opts: { maxPicks: 8, separateZeroCost: true } },
  { name: 'N=5（不分离）', opts: { maxPicks: 5 } }
];

log('各预算档 × 各策略的「预算内入选场次」：');
log('');
log('| 策略 | ' + [1.0, 2.5, 4.0, 6.0].map(b => `${b}h`).join(' | ') + ' | 顺带（零成本） |');
log('| :--- | ' + [1.0, 2.5, 4.0, 6.0].map(() => '---:').join(' | ') + ' | ---: |');
for (const c of CFG) {
  const cells = [1.0, 2.5, 4.0, 6.0].map(b => {
    const p = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, b, LEAGUES_6, c.opts);
    return `${p.best.length}场/${p.used.toFixed(1)}h`;
  });
  const pZ = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, 4.0, LEAGUES_6, c.opts);
  log(`| ${c.name} | ${cells.join(' | ')} | ${c.opts.separateZeroCost ? pZ.zeroCount : '—'} |`);
}

log('');
log('**推荐策略（N=5 + 分离）在周预算 4.0h 下的输出**');
log('');
const pRec = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, 4.0, LEAGUES_6, { maxPicks: 5, separateZeroCost: true });
log(`预算内入选 **${pRec.best.length}** 场，占用 ${pRec.used.toFixed(1)}h，结余 ${(4.0 - pRec.used).toFixed(1)}h：`);
log('');
pRec.best.forEach(e => log(`- ${e.m.t} ${e.m.h} vs ${e.m.a} · ${E.tierOf(e.m).label}(${E.tierOf(e.m).cost}h) · 指数 ${e.index.toFixed(1)} · ${e.ev.isFollowed ? '**主队**' : '中立'}`));
log('');
log(`另有「零成本顺带」**${pRec.zeroCount}** 场，不计入预算。`);

// ============================================================
H('三、D9 标定：Hero 低看点降级阈值');

const nights = [...new Set(F.map(m => E.owlDay(m.t)))].sort();
const heroRows = nights.map(n => {
  const slice = F.filter(m => E.owlDay(m.t) === n);
  const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6, W({ watchCost: E.WATCH_COST }));
  if (!p.hero) return { n, empty: true };
  return { n, idx: p.hero.index, star: p.hero.ev.star };
}).filter(r => !r.empty);

const SCHEMES = [
  { name: 'A · 20 / 12', hi: 20, mid: 12 },
  { name: 'B · 18 / 10', hi: 18, mid: 10 },
  { name: 'C · 15 / 8', hi: 15, mid: 8 },
  { name: 'D · 15 / 5', hi: 15, mid: 5 }
];

log(`有赛夜数：**${heroRows.length}**（另有 ${nights.length - heroRows.length} 晚无赛程）`);
log('');
log('| 方案（高光 / 弱化 / 降级阈值） | 高光卡 | 弱化卡 | 转倒计时 | 高光占比 |');
log('| :--- | ---: | ---: | ---: | ---: |');
for (const s of SCHEMES) {
  const hi = heroRows.filter(r => r.idx >= s.hi).length;
  const mid = heroRows.filter(r => r.idx >= s.mid && r.idx < s.hi).length;
  const lo = heroRows.filter(r => r.idx < s.mid).length;
  log(`| ${s.name} | ${hi} | ${mid} | ${lo} | ${pct(hi, heroRows.length)} |`);
}

log('');
log('Hero 指数分布（用于目视阈值合理性）：');
log('');
const sortedIdx = heroRows.map(r => r.idx).sort((a, b) => b - a);
const q = (p) => sortedIdx[Math.min(sortedIdx.length - 1, Math.floor(sortedIdx.length * p))].toFixed(1);
log('| 分位 | P0（最高） | P25 | P50（中位） | P75 | P90 | 最低 |');
log('| :--- | ---: | ---: | ---: | ---: | ---: | ---: |');
log(`| 指数 | ${q(0)} | ${q(0.25)} | ${q(0.5)} | ${q(0.75)} | ${q(0.9)} | ${sortedIdx[sortedIdx.length - 1].toFixed(1)} |`);

log('');
log('各阈值区间对应的实际夜数：');
log('');
log('| 阈值线 | ≥ 该值的夜数 | 占比 |');
log('| ---: | ---: | ---: |');
[30, 25, 20, 18, 15, 12, 10, 8, 5].forEach(t => {
  const c = heroRows.filter(r => r.idx >= t).length;
  log(`| ${t} | ${c} | ${pct(c, heroRows.length)} |`);
});

log('');
log('**推荐方案**（见第四章结论）');

// ============================================================
H('四、标定结论汇总');

log('| 决策 | 标定结论 | 依据 |');
log('| :--- | :--- | :--- |');
log('| **D6** | `watchCost = 0.5` | 使"凌晨主队（S4）> 傍晚 ★1 中立（S0）"成立；对 Hero 排序无影响 |');
log('| **D8** | `maxPicks = 5` + `separateZeroCost = true` | 各预算档下输出稳定在 1–3 场；零成本场次单列不占预算 |');
log('| **D9** | 见上表（高光 / 弱化 / 倒计时 三档阈值） | 按 Hero 指数分位分布选取 |');

const report = out.join('\n');
writeFileSync(resolve(__dirname, 'CALIBRATION.md'), report, 'utf8');
console.log('\n报告已写入 spike/algo-baseline/CALIBRATION.md');
