/**
 * 赛前动态背景提取（stakes.js）测试（离线）
 *
 * 验证三条产品红线：
 *   1. 样本保护：赛季初（国内 <5 场、欧冠 <3 场）不制造虚高排名标签
 *   2. 防剧透时间截断：已完赛场次只读取开球前已结束的积分榜，不偷看未来赛果
 *   3. 星级—看点同源不变量：任何由 stakes 升星的场次，narrativeOf 必出 L1/L2，绝不落 L3
 *
 * 运行：node tools/test-stakes.mjs
 */

import { computeMatchStakes } from '../src/core/stakes.js';
import * as E from '../src/core/engine.js';
import { narrativeOf, driversOf, LEVEL } from '../src/core/narrative.js';
import { getFixtures, rivalries, storylines, REC_MAP } from '../src/data/index.js';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('赛前动态背景测试');
console.log('');

/* ================================================================== */
console.log('一、合成数据：样本门槛、类别识别与防剧透截断');
{
  const doneMatch = (id, round, t, h, a, sc, l = 'PL') => ({
    id, l, r: round, t, tbd: false, st: 'done', sc, h, a
  });

  // 只打完 2 轮时，样本不足 5 场，不应产生排名类标签
  const earlyFixtures = [
    doneMatch('PL-1-A-C', 1, '2026-08-15T20:00', 'AAA', 'CCC', '3-0'),
    doneMatch('PL-1-B-D', 1, '2026-08-15T22:00', 'BBB', 'DDD', '2-0'),
    doneMatch('PL-2-A-D', 2, '2026-08-22T20:00', 'AAA', 'DDD', '2-0'),
    doneMatch('PL-2-B-C', 2, '2026-08-22T22:00', 'BBB', 'CCC', '1-0')
  ];
  const earlyTarget = { id: 'PL-3-A-B', l: 'PL', r: 3, t: '2026-08-29T22:00', tbd: false, st: 'sched', h: 'AAA', a: 'BBB' };
  ok('★ 国内联赛 <5 场样本时不产生虚高标签',
    computeMatchStakes(earlyTarget, [...earlyFixtures, earlyTarget], { nowTs: E.ts('2026-08-28T12:00') }) === null);

  // 补齐 5 场：AAA 5 战全胜 #1 (15 分)，BBB 4 胜 1 平 #2 (13 分)，其余队穿插负场
  const fullFixtures = [];
  for (let r = 1; r <= 5; r++) {
    const day = String(r * 5).padStart(2, '0');
    fullFixtures.push(doneMatch(`PL-${r}-A-X${r}`, r, `2026-09-${day}T20:00`, 'AAA', `X${r}`, '2-0'));
    fullFixtures.push(doneMatch(`PL-${r}-B-Y${r}`, r, `2026-09-${day}T22:00`, 'BBB', `Y${r}`, r === 5 ? '1-1' : '1-0'));
    fullFixtures.push(doneMatch(`PL-${r}-C-Z${r}`, r, `2026-09-${day}T23:00`, 'CCC', `Z${r}`, '1-0'));
    fullFixtures.push(doneMatch(`PL-${r}-D-W${r}`, r, `2026-09-${day}T23:30`, 'DDD', `W${r}`, '1-2'));
  }
  const clash = { id: 'PL-6-A-B', l: 'PL', r: 6, t: '2026-09-30T22:00', tbd: false, st: 'sched', h: 'AAA', a: 'BBB' };
  const s1 = computeMatchStakes(clash, [...fullFixtures, clash], { nowTs: E.ts('2026-09-29T12:00') });
  ok('★ #1 vs #3 且差 2 分、样本 ≥5 场 → 识别为榜首卡位（title-clash）',
    s1 && s1.kind === 'title-clash' && s1.starFloor === 3 && s1.pointsDelta === 2,
    JSON.stringify(s1));

  const ev1 = E.evaluate(clash, {}, [], [], [], ['PL'], { stakes: s1 });
  const nar1 = narrativeOf(clash, ev1, []);
  const drv1 = driversOf(ev1);
  ok('evaluate 继承 stakes.starFloor = 3', ev1.star === 3, String(ev1.star));
  ok('★ narrativeOf 输出 L2（绝不落 L3 看点有限）',
    nar1.level === LEVEL.L2 && nar1.headline.includes('#1') && nar1.headline.includes('#3') && nar1.headline.includes('差 2 分'),
    JSON.stringify(nar1));
  ok('driversOf 含动态背景原因', drv1.some(d => d.label.includes('榜首')), JSON.stringify(drv1));

  // 时间截断防剧透：查看第 2 轮已完赛历史比赛时，不会把第 3-5 轮赛果混入积分榜
  const histDone = { ...doneMatch('PL-2-A-X2', 2, '2026-09-10T20:00', 'AAA', 'X2', '2-0') };
  const histStakes = computeMatchStakes(histDone, fullFixtures, { nowTs: E.ts('2026-10-15T12:00') });
  ok('★ 查看历史已完赛场次时按开球时点截断（只见 1 轮样本，不偷看后续榜首）',
    histStakes === null,
    JSON.stringify(histStakes));

  // 欧冠前八直通 / 晋级线：样本门槛为 3 场
  const uclFixtures = [];
  const teams = Array.from({ length: 12 }, (_, i) => `U${String(i + 1).padStart(2, '0')}`);
  for (let r = 1; r <= 3; r++) {
    for (let i = 0; i < 6; i++) {
      uclFixtures.push(doneMatch(`UCL-${r}-${teams[i]}-${teams[i + 6]}`, r, `2026-09-${10 + r}T03:00`, teams[i], teams[i + 6], '2-0', 'UCL'));
    }
  }
  const uclClash = { id: 'UCL-4-U01-U02', l: 'UCL', r: 4, t: '2026-10-01T03:00', tbd: false, st: 'sched', h: 'U01', a: 'U02' };
  const sUcl = computeMatchStakes(uclClash, [...uclFixtures, uclClash], { nowTs: E.ts('2026-09-30T12:00') });
  ok('欧冠 3 轮后前 8 直接对话识别为 top-zone-clash',
    sUcl && sUcl.kind === 'top-zone-clash' && sUcl.label === '前八直通卡位',
    JSON.stringify(sUcl));
}

/* ================================================================== */
console.log('');
console.log('二、真实快照扫描（star>=2 必出 L1/L2）');
{
  const fixtures = getFixtures();
  const nowTs = E.ts('2026-11-06T12:00');
  const upcoming = fixtures.filter(m => m.st === 'sched' && !m.tbd && E.ts(m.t) > nowTs);
  const standingsCache = new Map();
  let stakesHits = 0;
  const badL3 = [];
  for (const m of upcoming) {
    const stakes = computeMatchStakes(m, fixtures, { nowTs, standingsCache });
    if (stakes) stakesHits++;
    const ev = E.evaluate(m, REC_MAP, rivalries, storylines, [], ['PL'], { stakes });
    const nar = narrativeOf(m, ev, storylines);
    if (ev.star >= 2 && nar.level === LEVEL.L3) badL3.push(m.id);
  }
  ok('真实快照未来场次中能提炼出一批动态看点', stakesHits > 5, `命中 ${stakesHits} 场`);
  ok('★ 所有携带动态看点升星的场次均不落入 L3 看点有限', badL3.length === 0, badL3.join('、'));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
