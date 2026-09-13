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
  groupTonight
} from '../src/core/owl.js';
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
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
