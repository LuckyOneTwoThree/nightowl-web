/**
 * 展示格式化纯函数测试（离线）
 */
import { formatGoalDiff, formatMinuteOfDay, hm } from '../src/core/format.js';

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

console.log('格式化测试');
console.log('');
console.log('一、时间轴分钟');

ok('07:30 起床 − 6h = 01:30', formatMinuteOfDay(1530) === '01:30', formatMinuteOfDay(1530));
ok('07:30 起床 − 6.5h = 01:00', formatMinuteOfDay(1500) === '01:00', formatMinuteOfDay(1500));
ok('跨零点 00:00', formatMinuteOfDay(1440) === '00:00', formatMinuteOfDay(1440));
ok('前一晚 23:30', formatMinuteOfDay(1410) === '23:30', formatMinuteOfDay(1410));
ok('超过一天仍按 24h 回绕', formatMinuteOfDay(2940) === '01:00', formatMinuteOfDay(2940));
ok('负数不产生非法钟点', formatMinuteOfDay(-30) === '23:30', formatMinuteOfDay(-30));
ok('非法输入安全降级', formatMinuteOfDay(NaN) === '--:--', formatMinuteOfDay(NaN));

console.log('');
console.log('二、既有格式不回归');

ok('开球时刻保持 HH:mm', hm('2026-11-02T03:00') === '03:00');
ok('净胜球正数带 +', formatGoalDiff(3) === '+3');
ok('净胜球零不带符号', formatGoalDiff(0) === '0');
ok('净胜球负数保持负号', formatGoalDiff(-2) === '-2');

console.log('');
console.log('────────────────────────────────────────────────────');
if (fail) {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
