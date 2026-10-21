/**
 * 实时比分联网健康检查
 *
 * 不进入 CI。用最近一场已完赛比赛验证 ESPN scoreboard + summary 的真实响应形状，
 * 并比对本地最终比分，防止解析器在真实数据上静默错位。
 *
 * 运行：npm run check:live
 */

import { loadFixtures } from '../server/data-store.js';
import { loadRules } from '../server/proxy.js';
import { resolveLive, resetLiveCache } from '../server/live.js';
import { ts } from '../src/core/engine.js';

const rules = loadRules();
const fixtures = await loadFixtures();

const candidates = fixtures
  .filter(m => m.st === 'done' && /^\d+-\d+$/.test(m.sc || ''))
  .sort((a, b) => ts(b.t) - ts(a.t))
  .slice(0, 5);

console.log('实时比分联网检查');
console.log(`候选：${candidates.length} 场最近完赛`);
console.log('');

let verified = 0;
for (const match of candidates) {
  resetLiveCache();
  const r = await resolveLive(match, { rules });
  if (!r.ok) {
    console.log(`  ⚠️  ${match.l} ${match.id}：${r.reason} ${r.message || ''}`);
    continue;
  }

  const [h, a] = String(match.sc).split('-').map(Number);
  const scoreOk = r.score?.h === h && r.score?.a === a;
  const stateOk = r.state === 'finished' || r.state === 'live';

  console.log(
    `  ${scoreOk && stateOk ? '✅' : '❌'} ${match.l} ${match.id}：` +
      `本地 ${match.sc} / ESPN ${r.score?.h}-${r.score?.a}，` +
      `${r.state} ${r.minuteLabel || ''}，事件 ${r.events?.length || 0} 条`
  );

  if (!scoreOk || !stateOk) {
    console.error('✖ 真实 ESPN 比分与本地完赛比分不一致，停止发布并排查');
    process.exit(1);
  }
  verified++;
  if (verified >= 2) break;
}

if (verified === 0) {
  console.error('✖ 未能从 ESPN 验证任何一场比赛的真实响应形状');
  process.exit(1);
}
console.log(`\n✓ 已用 ${verified} 场比赛验证 ESPN 实时解析（含 summary keyEvents）`);
