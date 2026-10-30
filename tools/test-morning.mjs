/**
 * 早晨补看摘要选择逻辑测试（离线）
 */
import {
  getMorningDigest,
  isMorningDigestWindow,
  morningDigestNight
} from '../src/core/morning.js';
import { addToQueue, markQueueWatched } from '../src/core/queue.js';
import { ts } from '../src/core/engine.js';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const wake = '07:30';
const morning = ts('2026-10-31T08:00');
const beforeWake = ts('2026-10-31T07:29');
const late = ts('2026-10-31T23:00');
const match = { id: 'PL-8-ARS-MCI', t: '2026-10-31T03:00', h: 'ARS', a: 'MCI', l: 'PL', st: 'sched' };
const older = { id: 'PD-8-RMA-FCB', t: '2026-10-30T03:00', h: 'RMA', a: 'FCB', l: 'PD', st: 'sched' };

console.log('早晨摘要测试');
console.log('');
console.log('一、时间窗口与夜晚');
ok('起床前不显示', isMorningDigestWindow(beforeWake, wake) === false);
ok('起床后显示', isMorningDigestWindow(morning, wake) === true);
ok('23:00 后关闭', isMorningDigestWindow(late, wake) === false);
ok('08:00 的昨晚是 2026-10-30', morningDigestNight(morning) === '2026-10-30', morningDigestNight(morning));
ok('凌晨 03:00 仍归当前夜猫日', morningDigestNight(ts('2026-10-31T03:00')) === '2026-10-30', morningDigestNight(ts('2026-10-31T03:00')));
ok('非法起床时间不显示', isMorningDigestWindow(morning, '99:99') === false);

console.log('');
console.log('二、队列筛选');
const q1 = addToQueue([], match, morning).queue;
const q2 = addToQueue(q1, older, morning).queue;
const digest = getMorningDigest(q2, [match, older], morning, wake);
ok('只取昨晚加入的队列', digest.items.length === 1 && digest.items[0].match.id === match.id);
ok('窗口外自动关闭', getMorningDigest(q2, [match, older], late, wake).canShow === false);
ok('手动打开可忽略窗口', getMorningDigest(q2, [match, older], late, wake, { force: true }).canShow === true);
const watched = markQueueWatched(q2, match.id, morning);
ok('已看项不进入摘要', getMorningDigest(watched, [match, older], morning, wake).items.length === 0);
const empty = getMorningDigest([], [match], morning, wake);
ok('空队列不生成摘要', empty.canShow === false && empty.items.length === 0);

console.log('');
console.log('────────────────────────────────────────────────────');
if (fail) {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
