/**
 * 单场数据健康判定测试（离线）
 *
 * 这条口径要能解释「为什么看不到比分」，所以每个分支都要有明确含义，
 * 尤其是「待同步 vs 上游未提供」的 24 小时边界 —— 界面上就是「再等等」与「别等了」。
 *
 * 运行：node tools/test-data-health.mjs
 */

import {
  DATA_STATE,
  MISSING_AFTER_MS,
  canRecheck,
  dataStateHint,
  dataStateLabel,
  dataStateTone,
  matchDataState
} from '../src/core/data-health.js';

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

// 2026-11-02 00:30 开球 → 完赛近似 02:30；now 取 2026-11-02 03:00
const KICK = '2026-11-02T00:30';
const END = Date.UTC(2026, 10, 1, 18, 30, 0); // 02:30 北京
const NOW = END + 30 * 60000; // 03:00 北京

const m = extra => ({ id: 'PL-9-ARS-MCI', l: 'PL', r: 9, t: KICK, st: 'sched', h: 'ARS', a: 'MCI', ...extra });

console.log('单场数据健康判定测试');
console.log('');
console.log('一、状态判定');

{
  ok('已完赛且有比分 → 已同步', matchDataState(m({ st: 'done', sc: '2-1' }), NOW) === DATA_STATE.OK);
  ok('★ 已完赛但无比分 → 上游未提供', matchDataState(m({ st: 'done' }), NOW) === DATA_STATE.MISSING);
  ok('还没到完赛时间 → 未开赛', matchDataState(m(), Date.UTC(2026, 10, 1, 17, 0, 0)) === DATA_STATE.UPCOMING);
  ok('★ 过了完赛时间 30 分钟 → 待同步', matchDataState(m(), NOW) === DATA_STATE.PENDING);
  ok('★ 过了 24 小时仍无比分 → 上游未提供', matchDataState(m(), END + MISSING_AFTER_MS + 1000) === DATA_STATE.MISSING);
  ok('★ 恰好在 24 小时边界内仍算待同步', matchDataState(m(), END + MISSING_AFTER_MS - 1000) === DATA_STATE.PENDING);
  ok('时间待定 → tbd', matchDataState(m({ tbd: true }), NOW) === DATA_STATE.TBD);
  ok('延期 → postponed', matchDataState(m({ st: 'pp' }), NOW) === DATA_STATE.POSTPONED);
  ok('状态未同步但已有比分 → 仍算已同步', matchDataState(m({ sc: '1-1' }), NOW) === DATA_STATE.OK);
  ok('没有比赛 → none', matchDataState(null, NOW) === DATA_STATE.NONE);
}

{
  const bad = m({ t: 'not-a-time' });
  ok('开球时间不可解析时保守判「上游未提供」，不谎称待同步', matchDataState(bad, NOW) === DATA_STATE.MISSING);
}

console.log('');
console.log('二、标签与动作');

{
  ok('标签：待同步', dataStateLabel(DATA_STATE.PENDING) === '待同步');
  ok('标签：上游未提供', dataStateLabel(DATA_STATE.MISSING) === '上游未提供');
  ok('标签：已同步', dataStateLabel(DATA_STATE.OK) === '已同步');
  ok('只有「待同步 / 上游未提供」提供重查入口',
    canRecheck(DATA_STATE.PENDING) && canRecheck(DATA_STATE.MISSING) &&
    !canRecheck(DATA_STATE.OK) && !canRecheck(DATA_STATE.UPCOMING));
  ok('语气：待同步为 warn，上游未提供为 danger',
    dataStateTone(DATA_STATE.PENDING) === 'warn' && dataStateTone(DATA_STATE.MISSING) === 'danger');
}

console.log('');
console.log('三、说明文案');

{
  const pending = dataStateHint(DATA_STATE.PENDING, Date.UTC(2026, 10, 1, 14, 40, 0), NOW);
  ok('待同步文案带出最后检查时刻', pending.includes('22:40'), pending);
  const missing = dataStateHint(DATA_STATE.MISSING, 0, NOW);
  ok('★ 上游未提供时不说「稍后会自动再查」', !missing.includes('稍后'), missing);
  ok('上游未提供给出两条可行路径', missing.includes('重查') && missing.includes('官方'), missing);
  ok('未开赛文案明确「不需要比分」', dataStateHint(DATA_STATE.UPCOMING).includes('不需要'));
  ok('tbd 文案说明时间未定', dataStateHint(DATA_STATE.TBD).includes('时间'));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
