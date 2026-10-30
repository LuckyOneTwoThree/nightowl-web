/**
 * 「明早补看」队列纯函数测试（离线）
 */
import {
  WATCH_LATER_LIMIT,
  WATCH_LATER_TTL_MS,
  addToQueue,
  markQueueWatched,
  normalizeQueue,
  pendingQueue,
  queueWithMatches,
  removeFromQueue
} from '../src/core/queue.js';

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

const now = Date.parse('2026-10-30T12:00:00+08:00');
const match = { id: 'PL-8-ARS-MCI', t: '2026-10-31T03:00', h: 'ARS', a: 'MCI', l: 'PL' };
const other = { id: 'PD-8-RMA-FCB', t: '2026-10-31T03:00', h: 'RMA', a: 'FCB', l: 'PD' };

console.log('补看队列测试');
console.log('');
console.log('一、加入与去重');

const first = addToQueue([], match, now);
ok('加入比赛', first.ok && first.added && first.queue.length === 1);
ok('记录所属夜晚', first.queue[0].night === '2026-10-30', first.queue[0].night);
ok('状态为待看', first.queue[0].status === 'pending');
const duplicate = addToQueue(first.queue, match, now + 1000);
ok('重复加入幂等且不更新加入时间',
  duplicate.ok && duplicate.added === false && duplicate.queue[0].addedAt === now);

const full = Array.from({ length: WATCH_LATER_LIMIT }, (_, i) => ({
  id: `M-${i}`,
  night: '2026-10-30',
  addedAt: now,
  status: 'pending'
}));
const overflow = addToQueue(full, other, now);
ok('第 11 条返回 full，不静默丢弃', !overflow.ok && overflow.reason === 'full');

const mixedFull = [
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `P-${i}`,
    night: '2026-10-30',
    addedAt: now,
    status: 'pending'
  })),
  { id: 'WATCHED', night: '2026-10-30', addedAt: now, status: 'watched' }
];
const reclaimed = addToQueue(mixedFull, other, now);
ok('队列满时先淘汰已看项，为新待看腾位',
  reclaimed.ok && reclaimed.added && reclaimed.queue.length === 10 &&
    !reclaimed.queue.some(item => item.id === 'WATCHED'));

console.log('');
console.log('二、过期与清理');

const old = { id: 'OLD', night: '2026-10-01', addedAt: now - WATCH_LATER_TTL_MS - 1, status: 'pending' };
const fresh = { id: 'NEW', night: '2026-10-30', addedAt: now - 1000, status: 'pending' };
const normalized = normalizeQueue([old, fresh], now);
ok('超过 7 天自动过期', normalized.length === 1 && normalized[0].id === 'NEW');
ok('去重保留第一条', normalizeQueue([fresh, { ...fresh, addedAt: now }], now).length === 1);
ok('非法条目被过滤',
  normalizeQueue([null, { id: '' }, { id: 'X', addedAt: NaN, status: 'pending' }], now).length === 0);

const removed = removeFromQueue([fresh, { ...fresh, id: 'OTHER' }], 'NEW', now);
ok('移除指定比赛', removed.length === 1 && removed[0].id === 'OTHER');

console.log('');
console.log('三、已看与展示');

const watched = markQueueWatched([fresh], 'NEW', now);
ok('标记已看', watched[0].status === 'watched');
ok('待看列表不再包含已看', pendingQueue(watched, now).length === 0);
const joined = queueWithMatches([fresh], [{ ...match, id: fresh.id }, other], now);
ok('队列匹配本地比赛', joined.length === 1 && joined[0].match.id === fresh.id);
ok('队列展示不带比分', joined.every(entry => !('sc' in entry.match)));

console.log('');
console.log('────────────────────────────────────────────────────');
if (fail) {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
