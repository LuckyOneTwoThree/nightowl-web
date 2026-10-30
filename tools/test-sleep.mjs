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
  normalizeSleepProfile,
  parseClockTime,
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
console.log('────────────────────────────────────────────────────');
if (fail) {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  console.log('失败项：');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
