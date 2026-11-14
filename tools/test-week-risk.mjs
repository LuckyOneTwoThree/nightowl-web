/**
 * 一周风险带测试（离线）
 *
 * 重点不是「函数能跑」，而是三条口径：
 *   1. 夜坐标以 18:00 起算、凌晨场次归前一夜（与 owlDay 同源）
 *   2. `tbd` 场次不产生色块、不参与「最晚结束」
 *   3. 睡眠底线 = 起床 − 最低睡眠，未启用作息时必须标 assumed
 *
 * 运行：node tools/test-week-risk.mjs
 */

import {
  BAND_DOMAIN,
  clockOfNightMinute,
  nightMinuteOf,
  sleepFloorOf,
  weekRiskBands
} from '../src/core/week-risk.js';
import { computeWeek } from '../src/core/owl.js';
import { ts } from '../src/core/engine.js';

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
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const PROFILE = { enabled: true, wakeTime: '07:30', minSleep: 7 };

console.log('一周风险带测试');
console.log('');

/* ================================================================== */
console.log('一、夜坐标与睡眠底线');
{
  ok('坐标 0 就是 18:00', clockOfNightMinute(0) === '18:00', clockOfNightMinute(0));
  ok('坐标 450 = 01:30', clockOfNightMinute(450) === '01:30', clockOfNightMinute(450));
  ok('坐标 840 = 08:00', clockOfNightMinute(840) === '08:00', clockOfNightMinute(840));
  ok('负坐标回绕到前一日', clockOfNightMinute(-150) === '15:30', clockOfNightMinute(-150));

  ok(
    '凌晨 01:30 属于前一日的夜',
    nightMinuteOf('2026-11-03T01:30', '2026-11-02') === 450,
    String(nightMinuteOf('2026-11-03T01:30', '2026-11-02'))
  );
  ok(
    '当日 20:00 是坐标 120',
    nightMinuteOf('2026-11-02T20:00', '2026-11-02') === 120,
    String(nightMinuteOf('2026-11-02T20:00', '2026-11-02'))
  );
  ok('非法时间返回 null', nightMinuteOf('oops', '2026-11-02') === null);

  const floor = sleepFloorOf(PROFILE);
  ok('07:30 起床 + 7h → 底线 00:30', floor?.clock === '00:30', floor?.clock);
  ok('底线坐标 390', floor?.nightMin === 390, String(floor?.nightMin));
  ok('已启用作息时假定标记为 false', floor?.assumed === false);

  const assumed = sleepFloorOf({ enabled: false, wakeTime: '07:30', minSleep: 7 });
  ok('未启用作息时仍给默认底线但标记 assumed', assumed?.assumed === true && assumed?.clock === '00:30');

  ok('缺失字段回落到默认 07:30 / 7h', sleepFloorOf({})?.clock === '00:30');
  ok('非法起床时间 → null（不编造底线）', sleepFloorOf({ enabled: true, wakeTime: '99:99' }) === null);

  // 05:00 起床要睡 12h，等于 17:00 就得上床 —— 落在 18:00 之前，坐标要绕过一日
  const early = sleepFloorOf({ enabled: true, wakeTime: '05:00', minSleep: 12 });
  ok('17:00 的底线坐标是 1380（次日视角）', early?.nightMin === 1380, String(early?.nightMin));
  ok('17:00 的底线钟点是 17:00', early?.clock === '17:00', early?.clock);
}

/* ================================================================== */
console.log('');
console.log('二、合成一周');
{
  const DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const days = DATES.map(date => ({ date, cost: 0, matches: [] }));
  const mk = (id, t, extra = {}) => ({ id, t, h: 'AAA', a: 'BBB', l: 'PL', st: 'sched', ...extra });

  const matches = [
    // 周一：20:00 收在 22:00，01:30 那场收到 03:30 → 越过 00:30 底线 3 小时
    mk('mo-1', '2026-11-02T20:00'),
    mk('mo-2', '2026-11-03T01:30'),
    // 两场开球待定 → 不属于任何一晚，只在周级计数
    mk('tu-1', '2026-11-03T04:00', { tbd: true }),
    mk('tu-2', '2026-11-04T02:00', { tbd: true }),
    // 周三：22:00 收在 00:00，正好压在底线之前
    mk('we-1', '2026-11-04T22:00'),
    // 周五：19:35 → 21:35
    mk('fr-1', '2026-11-06T19:35'),
    // 周六：03:45 → 05:45，本周最晚
    mk('sa-1', '2026-11-08T03:45'),
    // 已完赛的场次不该出现在风险带里
    mk('done-1', '2026-11-05T21:00', { st: 'done' })
  ];

  const week = { days, matches };
  const risk = weekRiskBands(week, PROFILE, ts('2026-11-01T12:00'));

  ok('7 晚都有带', risk.bands.length === 7, String(risk.bands.length));
  ok('weekday 从周一起算', risk.bands[0].weekday === 0 && risk.bands[6].weekday === 6);

  const [mon, tue, wed, thu, fri, sat, sun] = risk.bands;
  ok('周一 2 场', mon.count === 2, String(mon.count));
  ok('周一最晚收在 03:30', mon.latestEndClock === '03:30', mon.latestEndClock);
  ok('周一越过底线', mon.belowFloor === true);
  ok('周一的超出量是 180 分钟', mon.overMinutes === 180, String(mon.overMinutes));

  ok('待定场次不产生色块', risk.bands.every(b => b.segments.every(s => s.id !== 'tu-1' && s.id !== 'tu-2')));
  ok('待定场次不归属任何一晚', tue.count === 0 && tue.empty === true, JSON.stringify({ c: tue.count, e: tue.empty }));
  ok('周级报出 2 场待定', risk.tbdCount === 2, String(risk.tbdCount));

  ok('周三收在 00:00 不算越线', wed.belowFloor === false && wed.latestEndClock === '00:00', wed.latestEndClock);
  ok('周四空夜', thu.empty === true && thu.count === 0);
  ok('已完赛场次不进风险带', thu.count === 0 && fri.count === 1, `${thu.count}/${fri.count}`);
  ok('周五 19:35 收在 21:35', fri.latestEndClock === '21:35', fri.latestEndClock);
  ok('周六是本周最晚', sat.latestEndClock === '05:45' && sat.overMinutes === 315, `${sat.latestEndClock}/${sat.overMinutes}`);
  ok('周日空夜', sun.empty === true);

  ok('越线夜数为 2', risk.riskNights === 2, String(risk.riskNights));
  ok(
    '最晚的一晚是周六',
    risk.worst?.date === '2026-11-07' && risk.worst?.weekday === 5 && risk.worst?.latestEndClock === '05:45',
    JSON.stringify(risk.worst)
  );

  // 最早的已定场次是 20:00（坐标 120）→ 左边界留到 19:00
  ok('左边界比最早开球早一小时', risk.domain.startMin === 60, String(risk.domain.startMin));
  // 最晚一场收在 05:45（坐标 705）→ 右边界取到 07:00（坐标 780）
  ok('右边界比最晚结束晚一小时', risk.domain.endMin === 780, String(risk.domain.endMin));
  ok(
    '刻度每 4 小时一个且从边界开始',
    risk.domain.ticks.map(t => t.label).join(',') === '19:00,23:00,03:00,07:00',
    risk.domain.ticks.map(t => t.label).join(',')
  );

  // 03:00 时，11-03 那一夜正在进行，11-02 已过去；风险带只负责“还能影响睡眠”的夜，
  // 因此这里单独验证 current 标记，不把当前标记和可行动过滤混在一起。
  {
    const currentRisk = weekRiskBands(week, PROFILE, ts('2026-11-04T03:00'));
    ok('当前夜是周二', currentRisk.bands[1].current === true && currentRisk.bands[0].current === false);
    ok('未来的夜不是当前夜', currentRisk.bands[5].current === false);
  }
  ok('周一开始前没有当前夜标记', mon.current === false && tue.current === false);
}

/* ================================================================== */
console.log('');
console.log('二·二、可行动口径（已结束/直播/tbd）');
{
  const DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const days = DATES.map(date => ({ date, cost: 0, matches: [] }));
  const mk = (id, t, extra = {}) => ({ id, t, h: 'AAA', a: 'BBB', l: 'PL', st: 'sched', ...extra });
  const week = {
    days,
    matches: [
      mk('ended-fake', '2026-11-02T20:00'), // 11-03 02:00 时已结束，但 st 仍是 sched
      mk('live-now', '2026-11-03T01:00'),   // 11-03 02:00 时仍在 120 分钟内
      mk('tbd-now', '2026-11-03T02:00', { tbd: true }),
      mk('future-now', '2026-11-03T22:00')
    ]
  };
  const risk = weekRiskBands(week, PROFILE, ts('2026-11-03T02:00'));
  const [mon, tue] = risk.bands;

  ok('已结束的假 sched 不进风险带', mon.segments.every(s => s.id !== 'ended-fake'),
    mon.segments.map(s => s.id).join(','));
  ok('正在进行的场次仍进风险带', mon.segments.some(s => s.id === 'live-now'),
    mon.segments.map(s => s.id).join(','));
  ok('tbd 不进任何一晚', risk.bands.every(b => b.segments.every(s => s.id !== 'tbd-now')));
  ok('tbd 仍只在周级计数', risk.tbdCount === 1, String(risk.tbdCount));
  ok('周一只有正在直播的 1 场', mon.count === 1 && mon.latestEndClock === '03:00',
    `${mon.count}/${mon.latestEndClock}`);
  ok('未来场次仍计入对应夜晚', tue.segments.some(s => s.id === 'future-now'), tue.segments.map(s => s.id).join(','));
  ok('已结束 + tbd 不会抬高 riskNights', risk.riskNights === 1, String(risk.riskNights));
}

/* ================================================================== */
console.log('');
console.log('三、域的撑开（不裁剪）');
{
  const days = [{ date: '2026-11-02' }, { date: '2026-11-03' }];
  const early = [{ id: 'e1', t: '2026-11-02T15:30', h: 'A', a: 'B', l: 'PL', st: 'sched' }];
  const r1 = weekRiskBands({ days, matches: early }, PROFILE);
  ok('下午场把域向左撑开', r1.domain.startMin === -180, String(r1.domain.startMin));
  ok('下午场的坐标是 -150', r1.bands[0].segments[0].startMin === -150, String(r1.bands[0].segments[0].startMin));

  const late = [{ id: 'l1', t: '2026-11-03T05:30', h: 'A', a: 'B', l: 'PL', st: 'sched' }];
  const r2 = weekRiskBands({ days, matches: late }, PROFILE);
  ok('05:30 开球收在 07:30，仍在默认域内', r2.domain.endMin === 840, String(r2.domain.endMin));
  ok('该场收在 07:30', r2.bands[0].latestEndClock === '07:30', r2.bands[0].latestEndClock);

  // 底线晚于 08:00 时（睡得少、起得晚），域要向右让出位置，不能把线画在框外
  const evening = [{ id: 'e2', t: '2026-11-02T20:00', h: 'A', a: 'B', l: 'PL', st: 'sched' }];
  const lateFloor = weekRiskBands({ days, matches: evening }, { enabled: true, wakeTime: '09:00', minSleep: 1 });
  ok('晚底线把域向右撑开', lateFloor.domain.endMin === 900, String(lateFloor.domain.endMin));
  ok('底线 08:00 落在域内', lateFloor.floor.nightMin === 840, String(lateFloor.floor.nightMin));

  const r3 = weekRiskBands({ days }, PROFILE);
  ok(
    '没有比赛时回落到标准夜（18:00–08:00）',
    r3.domain.startMin === BAND_DOMAIN.startMin && r3.domain.endMin === BAND_DOMAIN.endMin,
    `${r3.domain.startMin}..${r3.domain.endMin}`
  );
  ok('没有比赛时没有 worst', r3.worst === null);
  ok('没有比赛时不崩', r3.bands.every(b => b.empty === true));

  ok('空输入不抛错', weekRiskBands(undefined, undefined, NaN).bands.length === 0);
}

/* ================================================================== */
console.log('');
console.log('四、真实快照不变量');
{
  const prefs = { followedTeams: ['ARS'], followedLeagues: ['PL'], weeklyBudget: 4 };
  const now = ts('2026-11-02T12:00');
  const week = computeWeek(now, prefs);
  const risk = weekRiskBands(week, { ...PROFILE }, now);

  ok('返回 7 晚', risk.bands.length === 7);
  ok('★ computeWeek 显式返回可行动日网格', Array.isArray(week.actionableDays) && week.actionableDays.length === 7,
    String(week.actionableDays?.length));

  // 风险带与周计划/周建议必须使用同一个「可行动」集合：
  // 已结束但状态仍为 sched 的场次不得画进风险带，也不得抬高 riskNights。
  let countMismatch = null;
  let endMismatch = null;
  let segOutside = null;
  for (let i = 0; i < 7; i++) {
    const band = risk.bands[i];
    const day = week.actionableDays?.[i];
    if (!day) {
      countMismatch = `missing actionableDays[${i}]`;
      continue;
    }
    if (band.count !== day.count) countMismatch = `${day.date}: ${band.count} vs ${day.count}`;
    for (const seg of band.segments) {
      if (seg.endMin - seg.startMin !== 120) endMismatch = `${seg.id}: ${seg.endMin - seg.startMin}`;
      // 一场比赛最多跨一夜（更长的跨夜属于数据错误，这里只保证不会被丢掉）
      if (seg.startMin < -12 * 60 || seg.endMin > 20 * 60) segOutside = `${seg.id}: ${seg.startMin}..${seg.endMin}`;
    }
  }
  ok('每夜场次数与 computeWeek 可行动网格一致', countMismatch === null, countMismatch);
  ok('可行动网格不含已结束的假 sched',
    week.actionableDays.every(day => day.matches.every(m =>
      m.st === 'sched' && !m.tbd && now < ts(m.t) + 120 * 60000)),
    '存在已结束/待定场次');
  ok('每段时长都是 120 分钟', endMismatch === null, endMismatch);
  ok('没有场次被画到一夜之外', segOutside === null, segOutside);

  let latestOk = true;
  for (const band of risk.bands) {
    if (!band.segments.length) continue;
    const maxEnd = Math.max(...band.segments.map(s => s.endMin));
    if (band.latestEndMin !== maxEnd) latestOk = false;
  }
  ok('最晚结束等于段尾最大值', latestOk);

  ok(
    '底线落在域内',
    risk.floor.nightMin > risk.domain.startMin && risk.floor.nightMin < risk.domain.endMin,
    `${risk.floor.nightMin} / ${risk.domain.startMin}..${risk.domain.endMin}`
  );
  ok('域至少 8 小时', risk.domain.endMin - risk.domain.startMin >= 480);
  ok(
    '段起点全部落在各自夜坐标内',
    risk.bands.every(b => b.segments.every(s => s.startMin >= risk.domain.startMin && s.startMin <= risk.domain.endMin))
  );
}

console.log('');
console.log('五、双轨作息底线');
{
  const DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const days = DATES.map(date => ({ date, cost: 0, matches: [] }));
  const mk = (id, t) => ({ id, t, h: 'AAA', a: 'BBB', l: 'PL', st: 'sched' });
  const matches = [
    // 周三夜 23:00 → 01:00 结束；按工作日 07:30（底线 00:30）越线 30 分钟
    mk('wed-1', '2026-11-04T23:00'),
    // 周五夜 23:30 → 01:30 结束；按周末 09:00（底线 02:00）未越线
    mk('fri-1', '2026-11-06T23:30'),
    // 周日夜 23:00 → 01:00 结束；按工作日 07:30（底线 00:30）越线 30 分钟
    mk('sun-1', '2026-11-08T23:00')
  ];
  const dual = { enabled: true, wakeTime: '07:30', weekendEnabled: true, weekendWakeTime: '09:00', minSleep: 7 };
  const risk = weekRiskBands({ days, matches }, dual, ts('2026-11-01T12:00'));

  ok('工作日底线 00:30，周末底线 02:00',
    risk.floor?.clock === '00:30' && risk.weekendFloor?.clock === '02:00',
    JSON.stringify({ f: risk.floor?.clock, wf: risk.weekendFloor?.clock }));
  ok('周三夜使用 00:30 底线且越线 30m',
    risk.bands[2].floor?.clock === '00:30' && risk.bands[2].belowFloor === true && risk.bands[2].overMinutes === 30);
  ok('周五夜使用周末 02:00 底线且不越线',
    risk.bands[4].floor?.clock === '02:00' && risk.bands[4].floor?.isWeekend === true && risk.bands[4].belowFloor === false,
    JSON.stringify(risk.bands[4].floor));
  ok('周日夜次日周一，仍按 00:30 底线判定为越线',
    risk.bands[6].floor?.clock === '00:30' && risk.bands[6].belowFloor === true);
  ok('共 2 晚越线（不含周五夜）', risk.riskNights === 2, String(risk.riskNights));
}

console.log('');
console.log('六、禁看夜（blockedNights）不计入越线统计与最晚告警');
{
  const DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const days = DATES.map((date, i) => ({ date, cost: 0, matches: [], blocked: i === 2 }));
  const mk = (id, t) => ({ id, t, h: 'AAA', a: 'BBB', l: 'PL', st: 'sched' });
  const matches = [
    // 周三夜 02:00 → 04:00（原本最晚且越线，但被标记 blocked）
    mk('wed-late', '2026-11-05T02:00'),
    // 周四夜 22:00 → 00:00（未越线）
    mk('thu-early', '2026-11-05T22:00')
  ];
  const prof = { enabled: true, wakeTime: '07:30', weekendEnabled: false, minSleep: 7 };
  const risk = weekRiskBands({ days, matches, overrides: { blockedNights: ['2026-11-04'] } }, prof, ts('2026-11-01T12:00'));

  ok('禁看夜保留自身 segments 但标 blocked=true', risk.bands[2].blocked === true && risk.bands[2].segments.length === 1);
  ok('riskNights 排除禁看夜', risk.riskNights === 0, String(risk.riskNights));
  ok('worst 排除禁看夜（指向周四 00:00）', risk.worst?.date === '2026-11-05' && risk.worst?.latestEndClock === '00:00', JSON.stringify(risk.worst));

  const allBlocked = weekRiskBands(
    { days: DATES.map(date => ({ date, cost: 0, matches: [], blocked: true })), matches },
    prof,
    ts('2026-11-01T12:00')
  );
  ok('全周禁看时 worst=null 且 riskNights=0', allBlocked.worst === null && allBlocked.riskNights === 0);
}

console.log('');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
