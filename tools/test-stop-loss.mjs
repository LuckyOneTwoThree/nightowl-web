/**
 * 止损状态机测试（离线）
 */
import {
  STOP_LOSS_MAX_SNOOZE,
  STOP_LOSS_SNOOZE_MS,
  STOP_LOSS_STATUS,
  ignoreStopLoss,
  markStopLossPrompted,
  normalizeStopLossState,
  shouldStopLossPrompt,
  sleepStopLoss,
  snoozeStopLoss,
  stopLossNightKey
} from '../src/core/stop-loss.js';
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
const match = { id: 'PL-8-ARS-MCI', t: '2026-10-31T03:00', h: 'ARS', a: 'MCI', l: 'PL', st: 'sched' };
const stopAt = ts('2026-10-31T00:00');
const before = stopAt - 1000;
const at = stopAt + 60000;
const end = ts('2026-10-31T05:00');

console.log('止损状态机测试');
console.log('');
console.log('一、触发窗口');
ok('止损前不提示', shouldStopLossPrompt(match, profile, before, null) === null);
ok('到达止损点提示', shouldStopLossPrompt(match, profile, at, null)?.night === '2026-10-30');
ok('比赛结束后不提示', shouldStopLossPrompt(match, profile, end + 1, null) === null);
ok('已完赛不提示',
  shouldStopLossPrompt({ ...match, st: 'done' }, profile, at, null) === null);
ok('tbd 不提示',
  shouldStopLossPrompt({ ...match, tbd: true }, profile, at, null) === null);
ok('未启用档案不提示',
  shouldStopLossPrompt(match, { ...profile, enabled: false }, at, null) === null);
ok('非法比赛时间不提示',
  shouldStopLossPrompt({ ...match, t: 'bad' }, profile, at, null) === null);

console.log('');
console.log('二、每夜状态');
ok('夜晚 key 按夜猫日口径', stopLossNightKey(match) === '2026-10-30');
ok('已提示后不再重复',
  shouldStopLossPrompt(match, profile, at, markStopLossPrompted(null)) === null);
ok('忽略后不再提示',
  shouldStopLossPrompt(match, profile, at, ignoreStopLoss(null)) === null);
ok('已睡后不再提示',
  shouldStopLossPrompt(match, profile, at, sleepStopLoss(null)) === null);

const snoozed = snoozeStopLoss(null, at);
ok('推迟 15 分钟',
  snoozed.status === STOP_LOSS_STATUS.SNOOZED &&
    snoozed.snoozeUntil === at + STOP_LOSS_SNOOZE_MS &&
    snoozed.snoozeCount === 1);
ok('推迟期间不提示',
  shouldStopLossPrompt(match, profile, at + STOP_LOSS_SNOOZE_MS - 1, snoozed) === null);
ok('推迟到期后再次提示',
  !!shouldStopLossPrompt(match, profile, at + STOP_LOSS_SNOOZE_MS, snoozed));

const second = snoozeStopLoss(snoozed, at + STOP_LOSS_SNOOZE_MS);
ok('最多推迟一次后不再提示',
  second.snoozeCount > STOP_LOSS_MAX_SNOOZE &&
    shouldStopLossPrompt(match, profile, second.snoozeUntil + 1, second) === null);

ok('非法状态归一为 idle',
  normalizeStopLossState({ status: 'wat', snoozeUntil: 'x' }).status === 'idle');

console.log('');
console.log('────────────────────────────────────────────────────');
if (fail) {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
