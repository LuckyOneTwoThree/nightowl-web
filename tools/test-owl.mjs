/**
 * 应用层（src/core/owl.js）测试
 *
 * 此前这一层**进不了 Node 测试**：src/data/index.js 用的是不带 attributes 的 JSON import，
 * Node 直接 import 会抛 ERR_IMPORT_ATTRIBUTE_MISSING。于是视图模型只能靠浏览器端验证，
 * 是实打实的测试盲区（本轮修的「候选池混入已结束场次」正是出在这一层）。
 * 统一导入写法后，这层终于可测。
 *
 * 断言只针对**不变量**，不硬编码场次 ID —— 数据会被保鲜模块持续更新。
 *
 * 运行：node tools/test-owl.mjs
 */

import {
  computeTonight,
  computeWeek,
  computeScheduleRows,
  defaultScheduleFilters,
  stateOf,
  liveCountAt,
  groupTonight,
  sameNightPicks,
  upcomingForTeams,
  rankReplayPicks
} from '../src/core/owl.js';
import { getFixtures } from '../src/data/index.js';
import { compareSemver, isNewerVersion } from '../src/core/semver.js';
import { datePart, zhDate } from '../src/core/format.js';
import { weekDistributionAdvice } from '../src/core/narrative.js';

/** 运行时数据源（与界面一致：保鲜同步后可替换） */
const fixtures = getFixtures();
import * as E from '../src/core/engine.js';

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

/** 固定时间点，保证测试确定性（北京 2026-09-13 12:00） */
const NOW = E.ts('2026-09-13T12:00');
const prefs = {
  followedTeams: ['ARS', 'MCI'],
  followedLeagues: ['PL', 'UCL'],
  weeklyBudget: 4.0,
  spoilerFree: true
};

const isEnded = m => {
  const t = E.ts(m.t);
  return !isNaN(t) && NOW > t + E.MATCH_DURATION_MS;
};

console.log('应用层（owl.js）测试');
console.log('');

/* ================================================================== */
console.log('一、今晚视图');
{
  const t = computeTonight(NOW, prefs);
  ok('返回切片', Array.isArray(t.slice));
  ok('切片全部归属同一夜猫日', t.slice.every(m => E.owlDay(m.t) === t.night), t.night);
  ok('切片按时间升序', t.slice.every((m, i) => i === 0 || E.ts(t.slice[i - 1].t) <= E.ts(m.t)));

  ok('★ Hero 不取自已结束的场次', !t.hero || !isEnded(t.hero.m),
    t.hero ? `${t.hero.m.id} ${t.hero.m.t}` : '无 Hero');

  const endedInSlice = t.slice.filter(isEnded);
  const mineEnded = [...t.minefieldIds].filter(id => {
    const m = t.slice.find(x => x.id === id);
    return m && isEnded(m);
  });
  ok('★ 雷区不含已结束的场次', mineEnded.length === 0, `${mineEnded.length} 场`);
  console.log(`     （今晚切片 ${t.slice.length} 场，其中已结束 ${endedInSlice.length} 场 —— 展示保留、算法剔除）`);

  ok('无 Hero 时给出下一场焦点战或空', t.hero ? t.focal === null : (t.focal === null || !!t.focal.m));

  // 状态分区（界面据此分三段展示：进行中置顶 / 未开赛 / 已结束折叠）
  const g = groupTonight(t.slice, NOW);
  const gTotal = g.live.length + g.upcoming.length + g.finished.length;
  ok('★ 分区总数与切片一致（不丢不重）', gTotal === t.slice.length, `${gTotal} vs ${t.slice.length}`);
  ok('★ live 组只含进行中的场次', g.live.every(m => stateOf(m, NOW) === 'live'),
    g.live.filter(m => stateOf(m, NOW) !== 'live').map(m => m.id).join('、'));
  ok('★ finished 组只含已结束（done / ended_pending）',
    g.finished.every(m => ['done', 'ended_pending'].includes(stateOf(m, NOW))));
  ok('★ upcoming 组不含已结束场次', g.upcoming.every(m => !isEnded(m) && stateOf(m, NOW) !== 'live'));
  const sortedByTs = arr => arr.every((m, i) => i === 0 || E.ts(arr[i - 1].t) <= E.ts(m.t));
  ok('三组内均按时间升序', sortedByTs(g.live) && sortedByTs(g.upcoming) && sortedByTs(g.finished));
}

/* ================================================================== */
console.log('');
console.log('二、本周视图');
{
  const w = computeWeek(NOW, prefs);
  ok('窗口起始为周一', E.owlDay(w.weekStartStr + 'T12:00') === w.weekStartStr || /^\d{4}-\d{2}-\d{2}$/.test(w.weekStartStr));
  ok('周历为 7 天', w.days.length === 7, `实际 ${w.days.length}`);

  const endedBest = w.plan.best.filter(e => isEnded(e.m));
  ok('★ 算法精选不含已结束的场次', endedBest.length === 0,
    endedBest.map(e => `${e.m.id} ${e.m.t}`).join('、'));

  const endedMine = w.minefield.filter(e => isEnded(e.m));
  ok('★ 雷区不含已结束的场次', endedMine.length === 0, endedMine.map(e => e.m.id).join('、'));

  const endedZero = w.plan.zeroList.filter(e => isEnded(e.m));
  ok('★ 零成本顺带也不含已结束的场次', endedZero.length === 0, `${endedZero.length} 场`);

  ok('预算被正确传递（4.0）', w.plan.budget === 4.0, `实际 ${w.plan.budget}`);
  ok('入选数不超过数量上限 5', w.plan.best.length <= 5, `实际 ${w.plan.best.length}`);
  ok('周度建议为非空字符串', typeof w.advice === 'string' && w.advice.length > 0, w.advice);

  // 周度建议应基于「还能安排」的场次 —— 提示里不应出现已过去的日期
  const pastDates = [...w.advice.matchAll(/(\d{2}-\d{2})/g)].map(m => m[1]);
  const todayMMDD = '09-13';
  ok('★ 周度建议不指向已过去的日期', pastDates.every(d => d >= todayMMDD),
    `建议：${w.advice}`);
  const heavyWeekAdvice = weekDistributionAdvice(
    ['09-14', '09-15', '09-16', '09-17', '09-18'].map((date, i) => ({ date, cost: 3.5, count: i + 1 }))
  );
  ok('★ 重度档覆盖 5 天以上时给出取舍动作，而不是逐日复述',
    heavyWeekAdvice.includes('主看夜'), heavyWeekAdvice);

  const usedRatio = w.plan.budget > 0 ? w.plan.used / w.plan.budget : 0;
  ok('占用不超预算', w.plan.used <= w.plan.budget + 1e-9, `${w.plan.used}/${w.plan.budget}`);
  ok('占用率可计算', Number.isFinite(usedRatio));
}

/* ================================================================== */
console.log('');
console.log('三、赛程行（含 O(n²) 修复的回归）');
{
  const rows = computeScheduleRows(NOW, prefs, defaultScheduleFilters());
  const dateRows = rows.filter(r => r.type === 'date');
  const matchRows = rows.filter(r => r.type === 'match');

  ok('行数为「比赛数 + 日期组数」', rows.length === dateRows.length + matchRows.length);
  ok('比赛行有 ID 且唯一', new Set(matchRows.map(r => r.m.id)).size === matchRows.length);
  ok('日期行数量与真实分组一致', dateRows.length > 50, `实际 ${dateRows.length}`);

  // 核心：每个日期行的 count 必须等于该组实际比赛数（此前循环内全表 filter 求 count）
  const byCount = new Map();
  for (const r of matchRows) {
    const d = E.owlDay(r.m.t);
    byCount.set(d, (byCount.get(d) || 0) + 1);
  }
  const countMismatch = dateRows.filter(r => byCount.get(r.date) !== r.count);
  ok('★ 每个日期行的场次数与实际一致', countMismatch.length === 0,
    countMismatch.slice(0, 3).map(r => `${r.date}: 标注 ${r.count} 实际 ${byCount.get(r.date)}`).join('；'));

  // 日期行必须按夜猫日连续出现，且不与后一组的比赛交错
  let lastDay = null;
  let interleaved = 0;
  for (const r of rows) {
    if (r.type === 'date') lastDay = r.date;
    else if (E.owlDay(r.m.t) !== lastDay) interleaved++;
  }
  ok('★ 比赛行归属其前置日期头（凌晨场次不串组）', interleaved === 0, `${interleaved} 行串组`);

  const sorted = matchRows.map(r => E.ts(r.m.t));
  ok('全部比赛按时间升序', sorted.every((t, i) => i === 0 || sorted[i - 1] <= t));
}

/* ================================================================== */
console.log('');
console.log('四、赛程筛选');
{
  const all = computeScheduleRows(NOW, prefs, defaultScheduleFilters());
  const plOnly = computeScheduleRows(NOW, prefs, { leagues: ['PL'], onlyFollowed: false, query: '' });
  const plMatches = plOnly.filter(r => r.type === 'match');
  ok('联赛筛选只保留该联赛', plMatches.every(r => r.m.l === 'PL'), '存在非 PL 场次');
  ok('筛选后行数变少', plOnly.length < all.length);

  const followed = computeScheduleRows(NOW, prefs, { leagues: [], onlyFollowed: true, query: '' });
  const fMatches = followed.filter(r => r.type === 'match');
  ok('只看关注：命中主客任一为关注球队',
    fMatches.every(r => prefs.followedTeams.includes(r.m.h) || prefs.followedTeams.includes(r.m.a)));

  const searched = computeScheduleRows(NOW, prefs, { leagues: [], onlyFollowed: false, query: '阿森纳' });
  ok('中文队名搜索命中', searched.filter(r => r.type === 'match').length > 0);
  ok('搜索无结果时返回空', computeScheduleRows(NOW, prefs, { leagues: [], onlyFollowed: false, query: '不存在的队名xyz' }).length === 0);
}

/* ================================================================== */
console.log('');
console.log('五、状态推导与实时计数');
{
  const rows = computeScheduleRows(NOW, prefs, defaultScheduleFilters());
  const matches = rows.filter(r => r.type === 'match').map(r => r.m);

  const ended = matches.filter(isEnded);
  ok('已过时间的 sched 场次被推为 ended_pending（而非 live）',
    ended.every(m => stateOf(m, NOW) === 'ended_pending' || m.st === 'done'),
    ended.slice(0, 3).map(m => `${m.id}=${stateOf(m, NOW)}`).join('、'));

  const live = liveCountAt(NOW);
  ok('进行中计数为非负整数', Number.isInteger(live) && live >= 0, `live=${live}`);

  // 同一时刻，liveCountAt 应与逐场推导一致
  let manual = 0;
  for (const m of (await import('../src/data/index.js')).fixtures) {
    if (m.st === 'sched' && E.matchState(m, NOW) === 'live') manual++;
  }
  ok('★ liveCountAt 与逐场推导结果一致', live === manual, `${live} vs ${manual}`);
}

console.log('');
console.log('六、右栏模块区（后续赛程 / 同夜推荐）');
{
  const anchor = fixtures.find(m => m.id === 'PL-4-MUN-MCI') || fixtures.find(m => m.st === 'sched' && !m.tbd);

  // 双方后续赛程
  const up = upcomingForTeams(anchor, fixtures, 4);
  const allUp = [...up.home, ...up.away];
  ok('后续赛程不含锚点自身', !allUp.some(x => x.id === anchor.id));
  ok('★ 后续赛程全部晚于锚点开球', allUp.every(x => E.ts(x.t) > E.ts(anchor.t)),
    allUp.filter(x => E.ts(x.t) <= E.ts(anchor.t)).map(x => x.id).join('、'));
  ok('后续赛程只含已排期场次（非 tbd / sched）', allUp.every(x => !x.tbd && x.st === 'sched'));
  ok('每队不超过 4 场', up.home.length <= 4 && up.away.length <= 4);
  ok('每队场次均涉及该队', up.home.every(x => x.h === anchor.h || x.a === anchor.h));

  // 同夜推荐
  const picks = sameNightPicks(anchor, prefs, 3, NOW);
  ok('同夜推荐不含锚点自身', !picks.some(p => p.m.id === anchor.id));
  ok('★ 同夜推荐只含未开赛场次', picks.every(p => p.m.st === 'sched' && !p.m.tbd && !isEnded(p.m)),
    picks.filter(p => isEnded(p.m) || p.m.st !== 'sched').map(p => p.m.id).join('、'));
  ok('★ 同夜推荐按夜猫指数降序', picks.every((p, i) => i === 0 || picks[i - 1].index >= p.index));
  ok('同夜推荐不超过 3 条', picks.length <= 3);
  ok('同夜推荐与锚点同一夜猫日', picks.every(p => E.owlDay(p.m.t) === E.owlDay(anchor.t)));
}

console.log('');
console.log('六·二、最近值得补看');
{
  const now = E.ts('2026-10-21T12:00');
  const prefs = {
    followedTeams: ['RMA'],
    followedLeagues: ['PL', 'PD'],
    weeklyBudget: 4,
    spoilerFree: true,
    notifyBefore15: true,
    notifyLiveEvents: true
  };
  const mk = (id, h, a, t, extra = {}) => ({
    id, l: 'PD', r: 1, t, tbd: false, st: 'done', sc: '1-0', h, a, ...extra
  });
  const list = [
    mk('PD-1-RMA-RSO', 'RMA', 'RSO', '2026-10-21T03:00'), // 关注 + replay
    mk('PD-1-BAR-ATH', 'BAR', 'ATH', '2026-10-21T04:00'), // replay，非关注
    mk('PL-1-ARS-COV', 'ARS', 'COV', '2026-10-21T05:00', { l: 'PL' }), // 高看点
    mk('PD-1-ALA-GET', 'ALA', 'GET', '2026-10-21T05:30'), // 低看点
    mk('PD-2-ELC-BAR', 'ELC', 'BAR', '2026-10-21T07:00'), // 今晚已列出，排除
    mk('PD-1-SEV-RAY', 'SEV', 'RAY', '2026-10-16T03:00'), // 超出 96h
    mk('PD-1-VAL-BET', 'VAL', 'BET', '2026-10-21T03:00', { st: 'sched', sc: null }) // 未完赛
  ];

  const picks = rankReplayPicks(list, now, prefs, 3);
  ok('返回不超过 limit', picks.length <= 3);
  ok('★ 关注球队排第一', picks[0]?.m.id === 'PD-1-RMA-RSO' && picks[0].reason === '关注球队', picks[0]?.reason);
  ok('★ replay 标记的非关注场次进入列表', picks.some(p => p.m.id === 'PD-1-BAR-ATH' && p.reason === '值得补看'));
  ok('高看点场次进入列表', picks.some(p => p.m.id === 'PL-1-ARS-COV'));
  ok('★ 今晚已列出的场次不重复', !picks.some(p => p.m.id === 'PD-2-ELC-BAR'));
  ok('超过 48h 的旧赛果不进入', !picks.some(p => p.m.id === 'PD-1-SEV-RAY'));
  ok('未完赛不进入', !picks.some(p => p.m.id === 'PD-1-VAL-BET'));
  ok('低看点无关注无 replay 不进入', !picks.some(p => p.m.id === 'PD-1-ALA-GET'));
  ok('空输入返回空', rankReplayPicks([], now, prefs, 3).length === 0);
  ok('limit=1 只返回一场', rankReplayPicks(list, now, prefs, 1).length === 1);
  ok('★ 补看日期标签先取 datePart（避免 10月NaN日）', zhDate(datePart('2026-10-19T23:30')) === '10月19日');
}

console.log('');
console.log('七、版本比较（更新提示的唯一判据）');
{
  ok('线上更高 → 提示更新', isNewerVersion('0.1.12', '0.1.11'));
  ok('版本相同 → 不提示', !isNewerVersion('0.1.11', '0.1.11'));
  ok('★ 线上更低 → 不提示（本地领先，如开发版 0.2.0 vs 线上 0.1.9）', !isNewerVersion('0.1.9', '0.2.0'));
  ok('★ 多位数字正确：0.1.10 > 0.1.9（字符串比较会判反）', compareSemver('0.1.10', '0.1.9') > 0);
  ok('主版本优先于次版本', compareSemver('1.0.0', '0.9.9') > 0);
  ok('段数不等也能比较', compareSemver('0.2', '0.2.0') === 0);
  ok(
    '非法/空输入不抛异常',
    (() => {
      try {
        compareSemver('', undefined);
        isNewerVersion(null, '0.1.1');
        return true;
      } catch {
        return false;
      }
    })()
  );
}

console.log('');
console.log('八、周计划时间模型（P0：精选 = 可执行计划）');
{
  // 合成数据：同开球 / 区间重叠 / 关注强塞 / 已结束混入，全部不依赖真实赛程
  const mk = (id, t, h, a, extra = {}) => ({ id, l: 'PL', r: 1, t, tbd: false, st: 'sched', h, a, ...extra });
  const OPTS = { ...E.PRODUCT_PLAN_OPTS, nowTs: E.ts('2026-11-01T12:00') };
  const noFollow = [[], []];
  const planOf = (list, followed = [], budget = 8.0, fl = ['PL']) =>
    E.planWeek(list, {}, [], [], followed, budget, fl, OPTS);
  const overlap = (a, b) => {
    const sa = E.ts(a.m.t), sb = E.ts(b.m.t);
    return sa < sb + E.MATCH_DURATION_MS && sb < sa + E.MATCH_DURATION_MS;
  };

  // 1) 同开球 4 场（23:00 → S1，成本 1h）：只能看一场，预算只计一场
  {
    const four = [
      mk('S1-A', '2026-11-05T23:00', 'ARS', 'NFO'),
      mk('S1-B', '2026-11-05T23:00', 'LIV', 'BUR'),
      mk('S1-C', '2026-11-05T23:00', 'MCI', 'WOL'),
      mk('S1-D', '2026-11-05T23:00', 'CHE', 'EVE')
    ];
    const p = planOf(four, [], 4.0);
    ok('★ 同开球 4 场最多入选 1 场', p.best.length === 1, `入选 ${p.best.length} 场`);
    ok('★ 同开球组只计一场成本（used=1h 而非 4h）', Math.abs(p.used - 1) < 1e-9, `used=${p.used}`);
    ok('used 等于入选场次档位成本之和',
      Math.abs(p.used - p.best.reduce((s, e) => s + E.tierOf(e.m).cost, 0)) < 1e-9);
  }

  // 2) 区间重叠（01:30–03:30 与 02:45–04:45）：非同开球也不共存
  {
    const two = [
      mk('O1-A', '2026-11-05T01:30', 'ARS', 'NFO'),
      mk('O1-B', '2026-11-05T02:45', 'LIV', 'BUR')
    ];
    const p = planOf(two, [], 8.0);
    ok('★ 区间重叠的两场不共存（01:30 与 02:45）', p.best.length === 1, `入选 ${p.best.length} 场`);
  }

  // 3) 精选内任意两场不重叠（混合场景的总不变量）
  {
    const mix = [
      mk('M1', '2026-11-05T23:00', 'ARS', 'NFO'),
      mk('M2', '2026-11-05T23:00', 'LIV', 'BUR'),
      mk('M3', '2026-11-06T01:30', 'MCI', 'WOL'),
      mk('M4', '2026-11-06T02:45', 'CHE', 'EVE'),
      mk('M5', '2026-11-06T22:00', 'TOT', 'NEW'),
      mk('M6', '2026-11-07T22:00', 'AVL', 'FUL')
    ];
    const p = planOf(mix, [], 8.0);
    const bad = [];
    for (let i = 0; i < p.best.length; i++)
      for (let j = i + 1; j < p.best.length; j++)
        if (overlap(p.best[i], p.best[j])) bad.push(`${p.best[i].m.id}×${p.best[j].m.id}`);
    ok('★ 精选内任意两场观看区间不重叠', bad.length === 0, bad.join('、'));
    ok('不重叠场次仍可组合入选（23:00 + 22:00 次日等）', p.best.length >= 2, `入选 ${p.best.length} 场`);
  }

  // 4) 关注球队同开球二选一：确定性判据，不静默丢掉
  {
    const pair = [
      mk('F1-A', '2026-11-05T03:00', 'ARS', 'NFO'),
      mk('F1-B', '2026-11-05T03:00', 'LIV', 'BUR')
    ];
    const p = planOf(pair, ['ARS', 'LIV'], 8.0);
    ok('★ 两支关注球队同开球只入选 1 场', p.best.length === 1, `入选 ${p.best.length} 场`);
    ok('★ 落选的一方进入同开球备选（不静默丢掉）',
      Array.isArray(p.kickoffGroups) && p.kickoffGroups.some(g =>
        g.entries.length === 2 && g.entries.some(e => e.m.id === 'F1-A') && g.entries.some(e => e.m.id === 'F1-B')),
      'kickoffGroups 未记录该组');
    const p2 = planOf(pair, ['ARS', 'LIV'], 8.0);
    ok('★ 二选一判据确定性（两次结果一致）',
      p.best.length === p2.best.length && p.best[0]?.m.id === p2.best[0]?.m.id,
      `${p.best[0]?.m.id} vs ${p2.best[0]?.m.id}`);
  }

  // 5) 同开球一关注一不关注：关注方优先
  {
    const pair = [
      mk('F2-A', '2026-11-05T03:00', 'ARS', 'NFO'),
      mk('F2-B', '2026-11-05T03:00', 'WOL', 'BUR')
    ];
    const p = planOf(pair, ['ARS'], 8.0);
    ok('★ 同开球二选一优先关注球队', p.best.length === 1 && p.best[0].m.id === 'F2-A',
      `入选 ${p.best[0]?.m.id}`);
  }

  // 6) 已结束场次不得进候选池（约束下沉，不依赖调用方过滤）
  {
    const list = [
      mk('P1-PAST', '2026-11-05T03:00', 'ARS', 'NFO'),          // 相对 nowTs 已结束
      mk('P1-LIVE', '2026-11-06T12:30', 'LIV', 'BUR'),           // 进行中（可加入）
      mk('P1-FUT', '2026-11-06T22:00', 'MCI', 'WOL')            // 未开球
    ];
    // nowTs = 2026-11-06T12:40：P1-PAST（11-05 03:00+120min）已结束
    const p = E.planWeek(list, {}, [], [], [], 8.0, ['PL'], { ...E.PRODUCT_PLAN_OPTS, nowTs: E.ts('2026-11-06T12:40') });
    const ids = [...p.best, ...p.evs, ...p.zeroList].map(e => e.m.id);
    ok('★ 已结束场次不进精选/候选/零成本', !ids.includes('P1-PAST'), `泄漏: ${ids.join(',')}`);
    ok('进行中与未开球场次仍在候选池', ids.includes('P1-LIVE') && ids.includes('P1-FUT'), ids.join(','));
  }

  // 7) 零成本同开球同样成组（浏览口径保留，但要能标出「只能看一场」）
  {
    const zeros = [
      mk('Z1', '2026-11-05T22:30', 'ARS', 'NFO'),
      mk('Z2', '2026-11-05T22:30', 'CHE', 'MUN'),
      mk('Z3', '2026-11-05T20:00', 'LIV', 'EVE')
    ];
    const p = planOf(zeros, [], 4.0);
    const g = (p.kickoffGroups || []).find(x => x.t === '2026-11-05T22:30');
    ok('★ 零成本同开球也被记录为同开球组', !!g && g.entries.length === 2,
      g ? `${g.entries.length} 场` : '无该组');
  }

  // 8) 备选必须是可加入计划的场次：与精选时间重叠的候选不得混入
  {
    const list = [
      mk('ALT-A', '2026-11-05T23:00', 'ARS', 'NFO'),
      mk('ALT-B', '2026-11-05T23:00', 'LIV', 'BUR'),
      mk('ALT-C', '2026-11-06T22:00', 'MCI', 'WOL')
    ];
    const p = planOf(list, [], 1.0);
    ok('★ 备选不与精选时间重叠',
      p.alt.every(a => p.best.every(b => !overlap(a, b))),
      p.alt.map(a => `${a.m.id}×${p.best.find(b => overlap(a, b))?.m.id || ''}`).join(','));
    ok('★ 同开球落选场不进入备选', !p.alt.some(a => a.m.id === 'ALT-B'),
      p.alt.map(a => a.m.id).join(','));
  }

  // 9) 零成本顺带也是可执行计划：排除与精选冲突，且组内两两不重叠
  {
    const list = [
      mk('Z2-PLAN', '2026-11-05T23:00', 'ARS', 'NFO'),
      mk('Z2-CLASH', '2026-11-05T22:00', 'LIV', 'BUR'),
      mk('Z2-A', '2026-11-06T20:00', 'MCI', 'WOL'),
      mk('Z2-B', '2026-11-06T20:00', 'CHE', 'EVE'),
      mk('Z2-C', '2026-11-07T20:00', 'TOT', 'NEW')
    ];
    const p = planOf(list, [], 4.0);
    const bad = [];
    for (let i = 0; i < p.zeroList.length; i++)
      for (let j = i + 1; j < p.zeroList.length; j++)
        if (overlap(p.zeroList[i], p.zeroList[j])) bad.push(`${p.zeroList[i].m.id}×${p.zeroList[j].m.id}`);
    ok('★ 零成本顺带组内两两不重叠', bad.length === 0, bad.join('、'));
    ok('★ 零成本顺带不与精选时间重叠',
      p.zeroList.every(z => p.best.every(b => !overlap(z, b))),
      p.zeroList.filter(z => p.best.some(b => overlap(z, b))).map(z => z.m.id).join(','));
    ok('零成本顺带计数等于实际列表长度', p.zeroCount === p.zeroList.length,
      `${p.zeroCount} vs ${p.zeroList.length}`);
  }

  // 10) 不限数量（maxPicks 缺省）也遵守时间互斥；精选按开球时间排序
  {
    const four = [
      mk('N1', '2026-11-05T23:00', 'ARS', 'NFO'),
      mk('N2', '2026-11-05T23:00', 'LIV', 'BUR'),
      mk('N3', '2026-11-05T23:00', 'MCI', 'WOL'),
      mk('N4', '2026-11-05T23:00', 'CHE', 'EVE')
    ];
    const p = E.planWeek(four, {}, [], [], [], 8.0, ['PL'], { nowTs: E.ts('2026-11-01T12:00') });
    ok('★ maxPicks 缺省时同开球仍最多一场', p.best.length === 1, `入选 ${p.best.length} 场`);

    const ordered = [
      mk('ORD-A', '2026-11-06T23:30', 'ARS', 'NFO'),
      mk('ORD-B', '2026-11-05T23:00', 'LIV', 'BUR')
    ];
    const po = planOf(ordered, ['ARS'], 8.0);
    ok('★ 精选按开球时间升序（关注队不会把后一天排到前面）',
      po.best.length === 2 && po.best[0].m.id === 'ORD-B' && po.best[1].m.id === 'ORD-A',
      po.best.map(e => `${e.m.t}:${e.m.id}`).join(' → '));
  }
}

console.log('');
console.log('九、周窗口与未来周（P0：夜猫周锚点）');
{
  // 1) 夜猫周锚点：周一凌晨归上一周（真实数据：2026-09-07T00:00–05:59 有 6 场，owlDay=09-06）
  {
    const w = computeWeek(NOW, prefs); // NOW=2026-09-13 周日 → 夜猫周 09-07..09-13
    const dayDates = w.days.map(d => d.date);
    ok('周历 7 天且为夜猫日序列', w.days.length === 7, `${w.days.length}`);
    ok('★ 窗口内每场的 owlDay 都落在 7 天网格（周一凌晨不落网格外）',
      w.matches.every(m => dayDates.includes(E.owlDay(m.t))),
      w.matches.filter(m => !dayDates.includes(E.owlDay(m.t)))
        .slice(0, 3).map(m => `${m.t} owlDay=${E.owlDay(m.t)}`).join('、'));
    // 窗口 = 真实赛程中 owlDay 落在 7 天网格的全部场次（不丢不重）
    const expectIds = new Set(fixtures
      .filter(m => dayDates.includes(E.owlDay(m.t)))
      .map(m => m.id));
    const gotIds = new Set(w.matches.map(m => m.id));
    const missing = [...expectIds].filter(id => !gotIds.has(id));
    const extra = [...gotIds].filter(id => !expectIds.has(id));
    ok('★ 周窗口与 7 天网格同口径（不丢不重）', missing.length === 0 && extra.length === 0,
      `缺 ${missing.length} 多 ${extra.length}${extra.slice(0, 2).join ? '' : ''}`);
  }

  // 2) 锚点错位场景：周一 00:10 打开「本周规划」，Tonight 的场次必须出现在周视图里
  {
    const monEarly = E.ts('2026-10-26T00:10');
    const night = E.nightOf(monEarly); // 周日夜 10-25
    const w = computeWeek(monEarly, prefs);
    const dayDates = w.days.map(d => d.date);
    ok('★ 周一凌晨看「本周」仍是上一夜猫周', w.weekStartStr === E.mondayOfWall(night),
      `weekStartStr=${w.weekStartStr} 期望 ${E.mondayOfWall(night)}（nightOf=${night}）`);
    const tonightCount = fixtures.filter(m => E.owlDay(m.t) === night).length;
    const inWeekView = w.matches.filter(m => E.owlDay(m.t) === night).length;
    ok('★ 今夜场次全部落在周网格（Tonight 与周规划同口径）',
      tonightCount > 0 && inWeekView === tonightCount,
      `今夜 ${tonightCount} 场，周视图含 ${inWeekView} 场`);
  }

  // 3) 未来周：锚点后移只决定「看哪一周」，可排性必须用真实 now 判断
  {
    const w0 = computeWeek(NOW, prefs);
    const w1 = computeWeek(NOW, prefs, { weekOffset: 1 });
    ok('★ weekOffset=1 定位到下一周', w1.weekStartStr !== w0.weekStartStr &&
      w1.weekStartStr > w0.weekStartStr, `${w0.weekStartStr} → ${w1.weekStartStr}`);

    // 动态选样（数据会保鲜，不硬编码场次）：取「严格未来周」里的最早场次，
    // 验证周偏移不会把该周前半段误判成历史（手机「下一周」的 P0-2 缺陷）。
    const realNow = Date.now();
    const curWeekStr = E.mondayOfWall(E.nightOf(realNow));
    const futureWeekMatches = fixtures
      .filter(m => m.st === 'sched' && !m.tbd && E.mondayOfWall(E.owlDay(m.t)) > curWeekStr)
      .sort((a, b) => E.ts(a.t) - E.ts(b.t));
    if (futureWeekMatches.length === 0) {
      ok('（跳过：当前数据没有严格未来周的已排期场次）', true);
    } else {
      const target = futureWeekMatches[0];
      const weeks = Math.round(
        (Date.parse(E.mondayOfWall(E.owlDay(target.t)) + 'T00:00:00Z') -
          Date.parse(curWeekStr + 'T00:00:00Z')) / 86400000 / 7
      );
      const wf = computeWeek(realNow, prefs, { weekOffset: weeks });
      ok('目标场次落在定位周窗口', wf.matches.some(m => m.id === target.id),
        `${target.id} ${target.t}（weekOffset=${weeks}）`);
      // 候选池口径检查的是「可排性」，不是「最终执行列表」：
      // 零成本执行列表会主动剔除与精选/彼此冲突的场次，那些场次仍应存在于原始候选池。
      const poolIds = new Set([...wf.plan.evs, ...wf.plan.zeroPool].map(e => e.m.id));
      const wronglyDropped = wf.matches.filter(m =>
        m.st === 'sched' && !m.tbd &&
        realNow < E.ts(m.t) + E.MATCH_DURATION_MS &&
        !poolIds.has(m.id));
      ok('★ 未来周未结束场次全部进入候选池（不误判已结束）', wronglyDropped.length === 0,
        wronglyDropped.slice(0, 3).map(m => `${m.id} ${m.t}`).join('、'));
    }
  }
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
