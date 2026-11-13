/**
 * 睡眠账本纯函数测试（离线）
 *
 * 时区口径：matchTime 是北京墙钟；起床时间也是北京墙钟。
 * 这里只测纯计算，不启动 UI、不联网、不读写盘。
 */
import {
  SLEEP_DEFAULTS,
  SLEEP_STATUS,
  formatSleepHours,
  isSleepProfileReady,
  isWeekendNight,
  normalizeSleepProfile,
  parseClockTime,
  resolveWakeTimeForNight,
  sleepLedger,
  stopLossAt
} from '../src/core/sleep.js';
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

const profile = { enabled: true, wakeTime: '07:30', minSleep: 7 };

console.log('睡眠账本测试');
console.log('');
console.log('一、档案解析与规范化');

ok('默认档案未启用', SLEEP_DEFAULTS.enabled === false);
ok('07:30 → 450 分钟', parseClockTime('07:30') === 450);
ok('7:30 与 07:30 等价', parseClockTime('7:30') === 450);
ok('非法时间返回 null', parseClockTime('25:00') === null && parseClockTime('07:60') === null);
ok('未提供字段时用默认值并有效',
  normalizeSleepProfile({}).valid === true &&
    normalizeSleepProfile({}).wakeTime === '07:30' &&
    normalizeSleepProfile({}).minSleep === 7);
ok('提供了非法起床时间时档案无效',
  normalizeSleepProfile({ wakeTime: '25:00' }).valid === false);
ok('提供了非法最低睡眠时档案无效',
  normalizeSleepProfile({ minSleep: 20 }).valid === false);
ok('isSleepProfileReady 要求已启用且有效',
  isSleepProfileReady(profile) === true &&
    isSleepProfileReady({ ...profile, enabled: false }) === false &&
    isSleepProfileReady({ ...profile, wakeTime: '25:00' }) === false);

console.log('');
console.log('二、剩余睡眠计算');

const deep = sleepLedger('2026-10-30T03:00', profile);
ok('03:00 开球 → 预计 05:00 结束', deep.valid && deep.endClock === '05:00', deep.endClock);
ok('07:30 起床、最低 7h → 剩余 2.5h', deep.remainingHours === 2.5, String(deep.remainingHours));
ok('低于底线 4.5h', deep.gapHours === 4.5, String(deep.gapHours));
ok('明显低于底线', deep.status === SLEEP_STATUS.DEEP && deep.belowFloor === true);

const slight = sleepLedger('2026-10-30T23:00', profile);
ok('23:00 开球跨夜 → 次日 07:30 起床剩 6.5h',
  slight.valid && slight.remainingHours === 6.5 && slight.wakeDate === '2026-10-31',
  `${slight.remainingHours} ${slight.wakeDate}`);
ok('6.5h 对 7h 底线是略低 0.5h',
  slight.gapHours === 0.5 && slight.status === SLEEP_STATUS.SLIGHT);

const over = sleepLedger('2026-10-30T03:00', { ...profile, wakeTime: '05:00' });
ok('比赛结束正好到起床点 → 剩余 0 而不是负数',
  over.valid && over.remainingHours === 0 && over.overWake === true && over.status === SLEEP_STATUS.OVER);

const evening = sleepLedger('2026-10-30T19:30', profile);
ok('晚间 19:30 开球 → 次日早晨起床，剩余 10h',
  evening.valid && evening.remainingHours === 10 && evening.status === SLEEP_STATUS.OK,
  String(evening.remainingHours));

const longMatch = sleepLedger('2026-10-30T03:00', profile, { durationMs: 150 * 60000 });
ok('自定义 150 分钟赛时 → 剩余 2h', longMatch.valid && longMatch.remainingHours === 2, String(longMatch.remainingHours));

const disabled = sleepLedger('2026-10-30T03:00', { ...profile, enabled: false });
ok('未启用时仍可计算，但 ready=false', disabled.valid && disabled.ready === false);

const badMatch = sleepLedger('not-a-time', profile);
ok('比赛时间不可解析时返回 invalid', badMatch.valid === false && badMatch.reason === 'invalid-match-time');
const badProfile = sleepLedger('2026-10-30T03:00', { ...profile, wakeTime: '25:00' });
ok('档案不可解析时不计算', badProfile.valid === false && badProfile.reason === 'invalid-profile');

console.log('');
console.log('三、止损点');

const stop = stopLossAt('2026-10-30T03:00', profile);
ok('03:00 场：07:30 起床、7h 底线、30min 缓冲 → 00:00 止损',
  stop && stop.stopAt === ts('2026-10-30T00:00'), stop ? new Date(stop.stopAt).toISOString() : 'null');
ok('未启用档案时不产生止损点',
  stopLossAt('2026-10-30T03:00', { ...profile, enabled: false }) === null);
ok('非法档案不产生止损点',
  stopLossAt('2026-10-30T03:00', { ...profile, wakeTime: '99:99' }) === null);

console.log('');
console.log('四、展示');

ok('2.54h → 2.5h', formatSleepHours(2.54) === '2.5h');
ok('负数被夹到 0h', formatSleepHours(-1) === '0h');
ok('非数字显示占位符', formatSleepHours(NaN) === '—');

console.log('');
console.log('五、工作日 / 周末双轨作息');

ok('周五夜（次日周六晨）识别为周末夜', isWeekendNight('2026-11-06') === true);
ok('周六夜（次日周日晨）识别为周末夜', isWeekendNight('2026-11-07') === true);
ok('周日夜（次日周一晨）不是周末夜', isWeekendNight('2026-11-08') === false);
ok('周三夜不是周末夜', isWeekendNight('2026-11-04') === false);

const dualProfile = {
  enabled: true,
  wakeTime: '07:30',
  weekendEnabled: true,
  weekendWakeTime: '09:00',
  minSleep: 7
};

const friLate = sleepLedger('2026-11-07T00:00', dualProfile);
ok('周五夜 00:00 开球 → 周六晨 09:00 起床，剩 7h 不越线',
  friLate.valid && friLate.isWeekendNight === true && friLate.wakeClock === '09:00' && friLate.remainingHours === 7 && friLate.belowFloor === false,
  JSON.stringify({ wk: friLate.wakeClock, rem: friLate.remainingHours, below: friLate.belowFloor }));

const sunLate = sleepLedger('2026-11-09T00:00', dualProfile);
ok('周日夜 00:00 开球（次日周一工作）→ 07:30 起床，剩 5.5h 越线',
  sunLate.valid && sunLate.isWeekendNight === false && sunLate.wakeClock === '07:30' && sunLate.remainingHours === 5.5 && sunLate.belowFloor === true,
  JSON.stringify({ wk: sunLate.wakeClock, rem: sunLate.remainingHours, below: sunLate.belowFloor }));

const friStop = stopLossAt('2026-11-07T03:00', dualProfile);
ok('周五夜止损点按周末 09:00 起床推算为 01:30',
  friStop && friStop.stopAt === ts('2026-11-07T01:30'),
  friStop ? String(friStop.stopAt) : 'null');

const badWeekend = sleepLedger('2026-11-07T00:00', { ...dualProfile, weekendWakeTime: '99:99' });
ok('非法周末起床时间使档案 invalid', badWeekend.valid === false && badWeekend.reason === 'invalid-profile');
ok('resolveWakeTimeForNight 未开启周末区分时回落工作日时间',
  resolveWakeTimeForNight('2026-11-06', { ...dualProfile, weekendEnabled: false }).wakeTime === '07:30');

console.log('');
console.log('────────────────────────────────────────────────────');
if (fail) {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  console.log('失败项：');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
