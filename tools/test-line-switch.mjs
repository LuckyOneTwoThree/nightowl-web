/**
 * 直播断流自动换线（纯函数）测试
 *
 * 运行：node tools/test-line-switch.mjs
 */

import { nextDirectLine, autoSwitchDecision } from '../src/core/line-switch.js';

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

const lines = [
  { id: 'l1', url: 'https://a/1.m3u8', isDirect: true },
  { id: 'l2', url: 'https://a/2.m3u8', isDirect: true },
  { id: 'l3', url: 'https://a/3.m3u8', isDirect: true },
  { id: 'embed', url: 'https://a/embed', isDirect: false }
];

console.log('直播断流自动换线测试');
console.log('');

/* ================================================================== */
console.log('一、下一条直链');
{
  ok('l1 → l2', nextDirectLine(lines, 'l1')?.id === 'l2');
  ok('l2 → l3', nextDirectLine(lines, 'l2')?.id === 'l3');
  ok('★ l3 回绕到 l1', nextDirectLine(lines, 'l3')?.id === 'l1');
  ok('★ 当前不是直链 → 从第一条开始', nextDirectLine(lines, 'embed')?.id === 'l1');
  ok('当前线路不在列表 → 从第一条开始', nextDirectLine(lines, 'missing')?.id === 'l1');
  ok('只有当前这一条直链 → 无备用', nextDirectLine([lines[0]], 'l1') === null);
  ok('没有直链 → null', nextDirectLine([lines[3]], 'embed') === null);
  ok('空列表 → null', nextDirectLine([], 'l1') === null);
}

/* ================================================================== */
console.log('');
console.log('二、自动切换决策与次数上限');
{
  const first = autoSwitchDecision({ lines, activeId: 'l1', attempts: 0, maxAttempts: 2 });
  ok('首次失败 → 切下一条', first.switch === true && first.line?.id === 'l2');

  const second = autoSwitchDecision({ lines, activeId: 'l2', attempts: 1, maxAttempts: 2 });
  ok('第二次失败 → 再切一条', second.switch === true && second.line?.id === 'l3');

  const exhausted = autoSwitchDecision({ lines, activeId: 'l3', attempts: 2, maxAttempts: 2 });
  ok('★ 已尝试 2 次 → 停止自动切换', exhausted.switch === false && exhausted.reason === 'exhausted');

  const none = autoSwitchDecision({ lines: [lines[0]], activeId: 'l1', attempts: 0, maxAttempts: 2 });
  ok('没有备用直链 → 不切换', none.switch === false && none.reason === 'no-alternative');

  const embedOnly = autoSwitchDecision({ lines: [lines[3]], activeId: 'embed', attempts: 0 });
  ok('只有内嵌线路 → 不自动切换', embedOnly.switch === false);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
