/**
 * 赛程变动检测测试（离线）
 *
 * 守住 PRD FR-05 的判定：开球时间变化 ≥5 分钟 / 延期 / 恢复才算「计划有变」；
 * 比分补上不算（那是数据保鲜）；上游几分钟的对齐误差不该打扰用户。
 *
 * 运行：node tools/test-schedule-diff.mjs
 */

import { diffFixtures, TIME_CHANGE_THRESHOLD_MS } from '../server/schedule-diff.js';
import { describeChange, summarizeChanges } from '../src/core/schedule-change.js';

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
};

const base = (id, extra = {}) => ({
  id,
  l: 'PL',
  r: 9,
  t: '2026-11-02T00:30',
  st: 'sched',
  h: 'ARS',
  a: 'MCI',
  tbd: false,
  ...extra
});

console.log('赛程变动检测测试');
console.log('');
console.log('一、时间变化');

{
  const before = [base('A')];
  const after = [base('A', { t: '2026-11-02T04:15' })];
  const d = diffFixtures(before, after);
  ok('★ 开球时间大幅变化 → time', d.length === 1 && d[0].kind === 'time', JSON.stringify(d));
  ok('带上原时间与新时间', d[0].from === '2026-11-02T00:30' && d[0].to === '2026-11-02T04:15');
}

{
  const before = [base('A')];
  const after = [base('A', { t: '2026-11-02T00:33' })]; // 3 分钟
  const d = diffFixtures(before, after);
  ok('★ 小于 5 分钟的挪动不提醒（上游对齐误差）', d.length === 0, JSON.stringify(d));
}

{
  const before = [base('A')];
  const after = [base('A', { t: '2026-11-02T00:36' })]; // 6 分钟
  const d = diffFixtures(before, after);
  ok('恰好超过阈值就提醒', d.length === 1, JSON.stringify(d));
}

{
  const before = [base('A', { tbd: true, t: '2026-11-02T02:00' })];
  const after = [base('A', { tbd: false, t: '2026-11-02T22:00' })];
  const d = diffFixtures(before, after);
  ok('★ 从「时间待定」到公布时间 → 单独标记 fromTbd', d.length === 1 && d[0].fromTbd === true, JSON.stringify(d));
}

console.log('');
console.log('二、状态变化');

{
  const d = diffFixtures([base('A')], [base('A', { st: 'pp' })]);
  ok('★ sched → pp → postponed', d.length === 1 && d[0].kind === 'postponed', JSON.stringify(d));
}
{
  const d = diffFixtures([base('A', { st: 'pp' })], [base('A', { st: 'sched' })]);
  ok('★ pp → sched → resumed', d.length === 1 && d[0].kind === 'resumed', JSON.stringify(d));
}
{
  const d = diffFixtures([base('A')], [base('A', { st: 'done', sc: '2-1' })]);
  ok('★ 比分补上不算计划变化', d.length === 0, JSON.stringify(d));
}
{
  const d = diffFixtures([base('A')], [base('A'), base('B', { id: 'B' })]);
  ok('新增场次不算变动（数据只走脚本）', d.length === 0, JSON.stringify(d));
}

console.log('');
console.log('三、文案');

{
  ok('时间调整文案带箭头',
    describeChange({ kind: 'time', from: '2026-11-02T00:30', to: '2026-11-02T04:15' }) === '00:30 → 04:15',
    describeChange({ kind: 'time', from: '2026-11-02T00:30', to: '2026-11-02T04:15' }));
  ok('待定转确定用「已确定」而不是箭头',
    describeChange({ kind: 'time', fromTbd: true, to: '2026-11-02T23:00' }).includes('已确定'));
  ok('延期 / 恢复文案', describeChange({ kind: 'postponed' }) === '已延期' && describeChange({ kind: 'resumed' }) === '恢复赛程');
}
{
  const s = summarizeChanges([
    { kind: 'time' },
    { kind: 'time' },
    { kind: 'postponed' }
  ]);
  ok('汇总标题给总数', s.title === '计划有变 · 3 场', s.title);
  ok('汇总细节分类计数', s.detail === '2 场时间调整 · 1 场延期', s.detail);
  ok('空数组不产生标题', summarizeChanges([]).total === 0);
}

ok('阈值常量是 5 分钟', TIME_CHANGE_THRESHOLD_MS === 5 * 60 * 1000);

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
