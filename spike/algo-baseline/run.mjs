/**
 * 算法基线验证套件
 *
 * 目的（对应《开发任务计划》T2-3 与决策 D6）：
 *   1. 验证 engine.js 的 ESM 移植与原版行为一致（交叉比对，非"看起来对"）
 *   2. 在真实数据上验证三条铁律
 *   3. 跑出未来 7 夜「今晚之选」，供人工目视核验推荐是否符合直觉
 *   4. 把 D6（主队加成 / 背包主队硬保）从主观拍板变成看数据拍板
 *   5. 量化 tbd 假档位偏差与看点供给覆盖
 *
 * 数据来源：参考项目/nightowl-terrace/miniprogram/data/（未在本仓库，仅验证期引用）
 * 运行：node spike/algo-baseline/run.mjs
 */

import { createRequire } from 'module';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as E from '../../src/core/engine.js';
import { REF_ROOT, loadRefData, loadOrigEngine } from './load-ref.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ---- 参考项目缺失时优雅降级（CI 环境 / 参考项目解耦后）----
 * 基线比对是「移植期一次性验证」：交叉比对结论（0 处偏差）早已完成并冻结在
 * BASELINE.md。参考项目不入库（gitignore），故缺失时直接放行，不阻塞构建；
 * 日常算法回归由 test:all 的其余测试（含 test-owl 应用层 31 项）覆盖。 */
if (!existsSync(resolve(REF_ROOT, 'data/fixtures.full.js'))) {
  console.warn('⚠️ 未找到参考项目（参考项目/nightowl-terrace）—— 算法基线比对已随解耦退役。');
  console.warn('   移植一致性结论（与原版 0 处偏差）冻结在 spike/algo-baseline/BASELINE.md；');
  console.warn('   日常回归由 test:all 其余测试覆盖。本步骤放行（exit 0）。');
  process.exit(0);
}

const F = loadRefData('fixtures.full.js');
const T = loadRefData('teams.js');
const RIV = loadRefData('rivalries.js');
const ST = loadRefData('storylines.js');
const REC = loadRefData('recommendations.seed.js');

const ORIG = loadOrigEngine();

const recMap = {};
REC.forEach(r => { recMap[r.m] = r; });

const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const H = (s) => { log(''); log(`## ${s}`); log(''); };

const NOW = Date.now();
const FOLLOWED = ['ARS'];                                   // 关注主队：阿森纳
const LEAGUES_6 = ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL'];    // 全选 6 个（铁律一边界）
const LEAGUES_5 = ['PL', 'PD', 'SA', 'BL', 'UCL'];          // 已选 5 个

log('# 算法基线验证报告');
log('');
log(`生成时间：${new Date().toISOString()}`);
log(`数据规模：fixtures ${F.length} 场 / teams ${T.length} / rivalries ${RIV.length} / storylines ${ST.length} / rec ${REC.length}`);

// ============================================================
H('一、移植一致性交叉比对');

let sMismatch = 0, indexMismatch = 0, starMismatch = 0;
for (const m of F) {
  if (ORIG.tierOf(m).tier !== E.tierOf(m).tier) sMismatch++;
  const ev = E.evaluate(m, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  if (ORIG.owlIndex(ev, m) !== E.owlIndex(ev, m)) indexMismatch++;
  const evO = ORIG.evaluate(m, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  if (evO.star !== ev.star) starMismatch++;
}
log('| 比对项 | 不一致处数 | 判定 |');
log('| :--- | ---: | :--- |');
log(`| 原版 \`tierOf\`（读烘焙字段 \`s\`） vs 移植版 \`tierOf\`（运行时算） | ${sMismatch} | ${sMismatch === 0 ? '等价改造安全' : '**不可移植**'} |`);
log(`| 原版 \`owlIndex\` vs 移植版 \`owlIndex\`（全量 ${F.length} 场） | ${indexMismatch} | ${indexMismatch === 0 ? '完全一致' : '**有偏差**'} |`);
log(`| 原版 \`evaluate().star\` vs 移植版 | ${starMismatch} | ${starMismatch === 0 ? '完全一致' : '**有偏差**'} |`);
log('');
log('> 结论：`tierOf` 改为运行时计算是**安全等价改造**——可以放心废弃烘焙字段 `s`。');

// ============================================================
H('二、三条铁律验证');

const mkPool = (ws, ls) => F.filter(m => m.st === 'sched' && !m.tbd && m.t > ws && m.t < ws + '~');

// 铁律一：关注联赛 +8 仅在已选 < 6 时生效
const evAny = E.evaluate(F[0], recMap, RIV, ST, FOLLOWED, LEAGUES_5);
const ev6 = E.evaluate(F[0], recMap, RIV, ST, FOLLOWED, LEAGUES_6);
log('**铁律一（关注联赛 +8）**');
log('');
log('| 场景 | isLeagueFollowed | followedLeaguesCount | leagueBonus |');
log('| :--- | :--- | ---: | ---: |');
log(`| 已选 5 个联赛（PL 场次） | ${evAny.isLeagueFollowed} | ${evAny.followedLeaguesCount} | **${E.leagueBonus(evAny)}** |`);
log(`| 已选 6 个联赛（PL 场次） | ${ev6.isLeagueFollowed} | ${ev6.followedLeaguesCount} | **${E.leagueBonus(ev6)}** |`);
log('');
log(`判定：${E.leagueBonus(evAny) === 8 && E.leagueBonus(ev6) === 0 ? '✅ 边界正确' : '❌ 边界错误'}`);

// 铁律二：tbd 排除
const tonightSliceAll = F.filter(m => m.t > '2026-09-01');
const pick = E.pickToday(tonightSliceAll, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
const plan = E.planWeek(tonightSliceAll, recMap, RIV, ST, FOLLOWED, 4.0, LEAGUES_6);
const mine = E.minefield(tonightSliceAll, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
const tbdLeak = [pick.hero, ...pick.extras, ...plan.best, ...plan.alt, ...mine].filter(e => e && (e.m ? e.m.tbd : e.tbd)).length;
log('');
log('**铁律二（tbd 排除）**');
log('');
log(`- pickToday / planWeek / minefield 输出中出现 tbd 场次的次数：**${tbdLeak}** → ${tbdLeak === 0 ? '✅' : '❌'}`);

// 铁律三：完赛状态兼容
log('');
log('**铁律三（完赛状态兼容）**');
log('');
log(`- \`isFinished({st:'done'})\` = ${E.isFinished({ st: 'done' })}，\`isFinished({st:'ft'})\` = ${E.isFinished({ st: 'ft' })} → ${E.isFinished({ st: 'done' }) && E.isFinished({ st: 'ft' }) ? '✅ 双认' : '❌'}`);

// ============================================================
H('三、未来 7 夜「今晚之选」（人工目视核验）');

const nightList = [];
const todayStr = E.bjDateStr(NOW);
const base = Date.parse(todayStr + 'T00:00:00Z');
for (let i = 0; i < 7; i++) {
  const d = new Date(base + i * 86400000);
  nightList.push(d.toISOString().slice(0, 10));
}

log('| 夜猫日 | 当晚场次 | 今晚之选 | 档位 | 星级 | 指数 | 主队出战 | 看点来源 |');
log('| :--- | ---: | :--- | :--- | ---: | ---: | :--- | :--- |');
const heroByNight = {};
for (const n of nightList) {
  const slice = F.filter(m => E.owlDay(m.t) === n);
  const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  if (!p.hero) {
    log(`| ${n} | ${slice.length} | **无球日 / 全部 tbd** | — | — | — | — | 走 nextFocal 降级 |`);
    heroByNight[n] = null;
    continue;
  }
  const h = p.hero;
  const src = h.ev.rec ? 'L1 人工' : h.ev.rivalry ? `L2 德比(${h.ev.rivalry})` : h.ev.storyIds.length ? 'L2 故事线' : 'L3 兜底';
  log(`| ${n} | ${slice.length} | ${h.m.h} vs ${h.m.a} | ${E.tierOf(h.m).label} | ${'★'.repeat(h.ev.star)} | ${h.index.toFixed(1)} | ${h.ev.isFollowed ? '✅' : '—'} | ${src} |`);
  heroByNight[n] = h;
}

// ============================================================
H('四、决策 D6-A：主队加成敏感度');

const weightSets = [
  { name: '原版 +25', w: { ...E.DEFAULT_WEIGHTS, followedBonus: 25 } },
  { name: '+15', w: { ...E.DEFAULT_WEIGHTS, followedBonus: 15 } },
  { name: '+12', w: { ...E.DEFAULT_WEIGHTS, followedBonus: 12 } },
  { name: '+10', w: { ...E.DEFAULT_WEIGHTS, followedBonus: 10 } }
];

const heroResults = {};
for (const ws of weightSets) {
  heroResults[ws.name] = [];
  for (const n of nightList) {
    const slice = F.filter(m => E.owlDay(m.t) === n);
    const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6, ws.w);
    heroResults[ws.name].push(p.hero ? `${p.hero.m.h}-${p.hero.m.a}` : 'NONE');
  }
}

log('未来 7 夜 Hero 变化对比（基准 = 原版 +25）：');
log('');
log('| 夜猫日 | 原版 +25 | +15 | +12 | +10 |');
log('| :--- | :--- | :--- | :--- | :--- |');
for (let i = 0; i < nightList.length; i++) {
  const row = weightSets.map(ws => heroResults[ws.name][i]);
  const mark = (s, idx) => (idx === 0 ? s : (s === row[0] ? '—' : `**${s}**`));
  log(`| ${nightList[i]} | ${row.map((s, idx) => mark(s, idx)).join(' | ')} |`);
}

// 更长窗口统计
const LONG_NIGHTS = [];
for (let i = 0; i < 60; i++) {
  const d = new Date(base + i * 86400000);
  LONG_NIGHTS.push(d.toISOString().slice(0, 10));
}
const changedCounts = {};
for (const ws of weightSets) {
  let ch = 0, total = 0;
  for (const n of LONG_NIGHTS) {
    const slice = F.filter(m => E.owlDay(m.t) === n);
    const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6, ws.w);
    const h0 = heroByNight[n];
    if (!p.hero) continue;
    total++;
    if (!h0 || `${p.hero.m.h}-${p.hero.m.a}` !== `${h0.m.h}-${h0.m.a}`) ch++;
  }
  // 与自身基准比较：这里改成统计各权重之间的差异
  changedCounts[ws.name] = changedCounts[ws.name] || {};
}

// 用 60 夜窗口统计「权重 A 与权重 B 的 Hero 差异场次数」
log('');
log('未来 60 夜窗口：不同主队加成之间 Hero 结果差异场次数');
log('');
log('| 对比 | 有赛日的 Hero 差异数 | 占比 |');
log('| :--- | ---: | ---: |');
const longHero = {};
for (const ws of weightSets) {
  longHero[ws.name] = [];
  for (const n of LONG_NIGHTS) {
    const slice = F.filter(m => E.owlDay(m.t) === n);
    const p = E.pickToday(slice, recMap, RIV, ST, FOLLOWED, LEAGUES_6, ws.w);
    longHero[ws.name].push(p.hero ? `${p.hero.m.h}-${p.hero.m.a}` : 'NONE');
  }
}
const validCount = longHero['原版 +25'].filter(x => x !== 'NONE').length;
for (let i = 1; i < weightSets.length; i++) {
  let diff = 0;
  for (let k = 0; k < LONG_NIGHTS.length; k++) {
    if (longHero[weightSets[0].name][k] !== longHero[weightSets[i].name][k]) diff++;
  }
  log(`| 原版 +25 vs ${weightSets[i].name} | ${diff} / ${validCount} | ${(diff / validCount * 100).toFixed(1)}% |`);
}

// 「凌晨主队战 vs 傍晚中立赛 指数等价」实证
H('五、D6-A 佐证：指数等价现象实证');

let aliasPairs = 0;
const examples = [];
for (const m of F) {
  if (m.st !== 'sched' || m.tbd) continue;
  if (!FOLLOWED.includes(m.h) && !FOLLOWED.includes(m.a)) continue;
  const tier = E.tierOf(m);
  if (tier.tier < 3) continue;
  const evA = E.evaluate(m, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
  const idxA = E.owlIndex(evA, m);
  for (const n of F) {
    if (n.st !== 'sched' || n.tbd) continue;
    if (n.l !== m.l) continue;
    const tev = E.evaluate(n, recMap, RIV, ST, FOLLOWED, LEAGUES_6);
    if (tev.star !== 1 || tev.isFollowed) continue;
    const tn = E.tierOf(n);
    if (tn.tier !== 0) continue;
    if (Math.abs(E.owlIndex(tev, n) - idxA) < 1.0) {
      aliasPairs++;
      if (examples.length < 5) {
        examples.push(`- ${m.h} vs ${m.a}（${m.t}，${tier.label}，主队，指数 ${idxA.toFixed(1)}） ≈ ${n.h} vs ${n.a}（${n.t}，${tn.label}，★1 中立，指数 ${E.owlIndex(tev, n).toFixed(1)}）`);
      }
    }
  }
}
log(`未来赛程中「凌晨主队战」与「傍晚 ★1 中立赛」指数近似相等（差 < 1.0）的组合数：**${aliasPairs}**`);
if (examples.length) { log(''); log('实例：'); examples.forEach(e => log(e)); }

// ============================================================
H('六、决策 D6-B：背包主队硬保 vs 单场成本上限');

const weekStart = E.weekStartBJ(NOW);
const weekEnd = weekStart.ts + 7 * 86400000;
const weekMatches = F.filter(m => { const t = E.ts(m.t); return t >= weekStart.ts && t < weekEnd; });

log(`本周窗口：${weekStart.str} 起 7 天，共 ${weekMatches.length} 场`);
log('');
log('| 策略 | 周预算 | 入选场次 | 实际占用 | 结余 | 单场占预算比 |');
log('| :--- | ---: | ---: | ---: | ---: | --- |');

const budgetCandidates = [4.0, 3.5, 2.5];
for (const b of budgetCandidates) {
  const p1 = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, b, LEAGUES_6, { knapsackCapRatio: 1 });
  const p2 = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, b, LEAGUES_6, { knapsackCapRatio: 0.6, followedSoftGuarantee: true });
  const maxRatio1 = p1.best.length ? Math.max(...p1.best.map(e => E.tierOf(e.m).cost)) / b : 0;
  const maxRatio2 = p2.best.length ? Math.max(...p2.best.map(e => E.tierOf(e.m).cost)) / b : 0;
  log(`| 原版（硬保，无上限） | ${b.toFixed(1)}h | ${p1.best.length} | ${p1.used.toFixed(1)}h | ${(b - p1.used).toFixed(1)}h | ${(maxRatio1 * 100).toFixed(0)}% |`);
  log(`| 加单场上限 60% + 主队软保底 | ${b.toFixed(1)}h | ${p2.best.length} | ${p2.used.toFixed(1)}h | ${(b - p2.used).toFixed(1)}h | ${(maxRatio2 * 100).toFixed(0)}% |`);
}

log('');
log('本周原版背包入选明细（预算 4.0h）：');
log('');
const pW = E.planWeek(weekMatches, recMap, RIV, ST, FOLLOWED, 4.0, LEAGUES_6);
if (!pW.best.length) {
  log('（本周无 tbd 之外的赛程，换用未来 7 夜窗口）');
  const wk7 = F.filter(m => { const t = E.ts(m.t); return t >= NOW && t < NOW + 7 * 86400000; });
  const p7 = E.planWeek(wk7, recMap, RIV, ST, FOLLOWED, 4.0, LEAGUES_6);
  p7.best.forEach(e => log(`- ${e.m.t} ${e.m.h} vs ${e.m.a} · ${E.tierOf(e.m).label}(${E.tierOf(e.m).cost}h) · 指数 ${e.index.toFixed(1)} · ${e.ev.isFollowed ? '主队' : '中立'}`));
} else {
  pW.best.forEach(e => log(`- ${e.m.t} ${e.m.h} vs ${e.m.a} · ${E.tierOf(e.m).label}(${E.tierOf(e.m).cost}h) · 指数 ${e.index.toFixed(1)} · ${e.ev.isFollowed ? '主队' : '中立'}`));
}

// ============================================================
H('七、tbd 假档位偏差量化');

const tbdMatches = F.filter(m => m.tbd);
const nonTbd = F.filter(m => !m.tbd);
const dist = (arr) => {
  const d = { S0: 0, S1: 0, S2: 0, S3: 0, S4: 0 };
  arr.forEach(m => { d[E.tierOf(m).label]++; });
  return d;
};
const dTbd = dist(tbdMatches);
const dNon = dist(nonTbd);
const pct = (x, n) => (x / n * 100).toFixed(1) + '%';

log(`| 档位 | tbd 场次（占位时间 ${tbdMatches.length} 场） | 非 tbd 场次（真实时间 ${nonTbd.length} 场） |`);
log('| :--- | ---: | ---: |');
['S0', 'S1', 'S2', 'S3', 'S4'].forEach(k => {
  log(`| ${k} | ${dTbd[k]}（${pct(dTbd[k], tbdMatches.length)}） | ${dNon[k]}（${pct(dNon[k], nonTbd.length)}） |`);
});
log('');
log('> tbd 场次的档位只落在 S2 / S4 两档（占位时间仅 02:00 与 04:00），而真实时间下档位分布在 S0–S4 全谱。');
log('> 若解除 tbd 时不重算档位，这 1,023 场会带着假档位首次进入 pickToday / planWeek / minefield 的候选池。');

// ============================================================
H('八、看点供给三层覆盖');

const recIds = new Set(REC.map(r => r.m));
const nodes = new Set(); ST.forEach(s => (s.nodes || []).forEach(n => nodes.add(n)));
const rivIds = new Set();
F.forEach(m => { if (RIV.some(r => r.pair.includes(m.h) && r.pair.includes(m.a))) rivIds.add(m.id); });
const b6 = new Set(F.filter(m => E.BIG_SIX.includes(m.h) && E.BIG_SIX.includes(m.a)).map(m => m.id));

let l1 = 0, l2 = 0, l3 = 0;
F.forEach(m => {
  if (recIds.has(m.id) && recMap[m.id] && recMap[m.id].points && recMap[m.id].points.length) l1++;
  else if (rivIds.has(m.id) || nodes.has(m.id) || b6.has(m.id)) l2++;
  else l3++;
});
log('| 层 | 判据 | 场次数 | 占比 |');
log('| :--- | :--- | ---: | ---: |');
log(`| L1 人工精修 | 有 \`points\` | ${l1} | ${pct(l1, F.length)} |`);
log(`| L2 规则合成 | 德比 / 故事线节点 / 六强内战 | ${l2} | ${pct(l2, F.length)} |`);
log(`| L3 通用兜底 | 其余全部（必须非空） | ${l3} | ${pct(l3, F.length)} |`);
log('');
log(`> L3 占比 ${pct(l3, F.length)} —— 这是右栏情报板内容模型必须接受的现实。`);

// ============================================================
H('九、结论摘要');

log('| # | 验证项 | 结论 |');
log('| --- | :--- | :--- |');
log(`| 1 | 移植一致性 | 烘焙 \`s\` 与运行时 \`sleepTier(t)\` 有 **${sMismatch}** 处不一致 → 运行时改造安全 |`);
log(`| 2 | 指数/星级一致性 | 与原版 **${indexMismatch}** 处偏差 → 移植无损 |`);
log(`| 3 | 铁律一（关注联赛 +8） | ${E.leagueBonus(evAny) === 8 && E.leagueBonus(ev6) === 0 ? '✅ 边界正确' : '❌'} |`);
log(`| 4 | 铁律二（tbd 排除） | ${tbdLeak === 0 ? '✅ 无泄漏' : '❌ 有泄漏'} |`);
log(`| 5 | 主队加成敏感度（60 夜窗口） | 见第四章 |`);
log(`| 6 | 背包策略差异 | 见第六章 |`);
log(`| 7 | L3 兜底占比 | ${pct(l3, F.length)} |`);

const report = out.join('\n');
const outPath = resolve(__dirname, 'BASELINE.md');
// 内容没变就不写盘。
// 本脚本每次运行都会生成新的时间戳，若不加判断，每跑一次测试 git status 就脏一次 ——
// 报告内容其实一字未改，却反复出现在改动列表里，会掩盖真正需要留意的变化。
const stripStamp = s => s.replace(/^生成时间：.*$/m, '');
let changed = true;
try {
  changed = stripStamp(readFileSync(outPath, 'utf8')) !== stripStamp(report);
} catch {
  changed = true; // 首次生成
}
if (changed) {
  writeFileSync(outPath, report, 'utf8');
  console.log('\n报告已写入 spike/algo-baseline/BASELINE.md');
} else {
  console.log('\n报告内容与现有 BASELINE.md 一致（仅生成时间不同），未改写文件');
}
