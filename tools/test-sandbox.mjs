import assert from 'node:assert/strict';
import {
  canSimulateMatch,
  findLinkedCompetitors,
  SANDBOX_DISCLAIMER,
  SANDBOX_OUTCOME,
  simulateMatchStandings
} from '../src/core/sandbox.js';
import { computeStandings } from '../src/core/standings.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

const fixtures = [
  { id: 'f1', l: 'PL', r: 10, t: '2026-10-01T20:00', st: 'done', h: 'ARS', a: 'CHE', sc: '2-0' },
  { id: 'f2', l: 'PL', r: 10, t: '2026-10-01T22:00', st: 'done', h: 'MCI', a: 'LIV', sc: '1-0' },
  { id: 'f3', l: 'PL', r: 11, t: '2026-10-08T20:00', st: 'done', h: 'LIV', a: 'ARS', sc: '1-0' },
  { id: 'f4', l: 'PL', r: 11, t: '2026-10-08T22:00', st: 'done', h: 'CHE', a: 'MCI', sc: '0-0' },
  // 未来待演焦点战
  { id: 'target', l: 'PL', r: 12, t: '2026-11-16T00:30', st: 'sched', h: 'ARS', a: 'MCI', sc: null },
  // 竞争对手 7 天内关联赛
  { id: 'linked', l: 'PL', r: 12, t: '2026-11-17T00:30', st: 'sched', h: 'LIV', a: 'CHE', sc: null },
  // 超出 7 天窗口，不应命中
  { id: 'far', l: 'PL', r: 14, t: '2026-11-30T00:30', st: 'sched', h: 'LIV', a: 'ARS', sc: null },
  // 未来 12 天已定但沙盘不能偷跑的其他赛果
  { id: 'futureDoneLeakCheck', l: 'PL', r: 13, t: '2026-11-22T20:00', st: 'done', h: 'MCI', a: 'ARS', sc: '5-0' }
];

const nowTs = Date.UTC(2026, 10, 14, 15, 0, 0); // 2026-11-14 23:00 CST

check('canSimulateMatch 边界：拒绝完赛/延期/SCG/UCL淘汰赛，放行联赛与UCL联赛阶段未完赛', () => {
  assert.equal(canSimulateMatch({ id: 'a', l: 'PL', r: 12, st: 'sched', h: 'ARS', a: 'MCI' }), true);
  assert.equal(canSimulateMatch({ id: 'b', l: 'UCL', r: 8, st: 'sched', h: 'ARS', a: 'RMA' }), true);
  assert.equal(canSimulateMatch({ id: 'c', l: 'UCL', r: 9, st: 'sched', h: 'ARS', a: 'RMA' }), false);
  assert.equal(canSimulateMatch({ id: 'd', l: 'SCG', r: 1, st: 'sched', h: 'BAR', a: 'RMA' }), false);
  assert.equal(canSimulateMatch({ id: 'e', l: 'PL', r: 12, st: 'done', sc: '1-0', h: 'ARS', a: 'MCI' }), false);
  assert.equal(canSimulateMatch({ id: 'f', l: 'PL', r: 12, st: 'pp', h: 'ARS', a: 'MCI' }), false);
});

check('simulateMatchStandings 确定性推演 1-0 / 0-0 / 0-1 且不污染原数组与不泄漏未来场次', () => {
  const snapshotCopy = JSON.stringify(fixtures);
  const target = fixtures.find(f => f.id === 'target');

  const base = simulateMatchStandings(target, SANDBOX_OUTCOME.NONE, fixtures, { nowTs });
  assert.equal(base.supported, true);
  assert.equal(base.table.doneCount, 4); // futureDoneLeakCheck 绝对不能提前计入
  assert.equal(base.disclaimer, SANDBOX_DISCLAIMER);
  assert.equal(base.homeDelta.rankBefore, 2); // MCI 4分第一, ARS 3分(+1)第二, LIV 3分(0)第三, CHE 1分第四
  assert.equal(base.awayDelta.rankBefore, 1);

  const homeWin = simulateMatchStandings(target, SANDBOX_OUTCOME.HOME_WIN, fixtures, { nowTs });
  assert.equal(homeWin.table.doneCount, 5);
  assert.equal(homeWin.homeDelta.rankAfter, 1);
  assert.equal(homeWin.homeDelta.rankDelta, 1); // #2 -> #1 (+1)
  assert.equal(homeWin.homeDelta.pointsDelta, 3);
  assert.equal(homeWin.awayDelta.rankAfter, 2);
  assert.equal(homeWin.awayDelta.rankDelta, -1); // #1 -> #2 (-1)

  const awayWin = simulateMatchStandings(target, SANDBOX_OUTCOME.AWAY_WIN, fixtures, { nowTs });
  assert.equal(awayWin.awayDelta.rankAfter, 1);
  assert.equal(awayWin.awayDelta.pointsAfter, 7);
  assert.equal(awayWin.homeDelta.pointsDelta, 0);

  const draw = simulateMatchStandings(target, SANDBOX_OUTCOME.DRAW, fixtures, { nowTs });
  assert.equal(draw.homeDelta.pointsAfter, 4);
  assert.equal(draw.awayDelta.pointsAfter, 5);

  assert.equal(JSON.stringify(fixtures), snapshotCopy);
});

check('findLinkedCompetitors 命中 7 天内邻近竞争对手场次', () => {
  const target = fixtures.find(f => f.id === 'target');
  const baseTable = computeStandings('PL', fixtures, { asOfTs: nowTs });
  const linked = findLinkedCompetitors(target, baseTable, fixtures, { nowTs });
  assert.ok(linked);
  assert.equal(linked.id, 'linked');
});

check('防剧透 excludeIds 在沙盘重算后依然被严格保留', () => {
  const target = fixtures.find(f => f.id === 'target');
  const excludeIds = new Set(['f3']);
  const res = simulateMatchStandings(target, SANDBOX_OUTCOME.DRAW, fixtures, {
    nowTs,
    excludeIds
  });
  assert.equal(res.table.excludedCount, 1);
  assert.equal(res.table.doneCount, 4); // f1, f2, f4 + target
});

console.log(`[test:sandbox] ${passed} passed`);
