import assert from 'node:assert/strict';
import { planManualReminder } from '../mobile/src/lib/reminder-plan.ts';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

const item = (identifier, data) => ({ identifier, content: { data } });
const KICK = '2026-11-21T22:00';

check('同开球 prematch → 取消并以 manual 重排（关自动开关不再丢显式提醒）', () => {
  const plan = planManualReminder(
    [item('n1', { matchId: 'm1', kind: 'prematch', kickoff: KICK })],
    'm1',
    KICK
  );
  assert.deepEqual(plan.cancelIds, ['n1']);
  assert.equal(plan.alreadyUpToDate, false);
});

check('同开球 manual → 幂等不重排', () => {
  const plan = planManualReminder(
    [item('n1', { matchId: 'm1', kind: 'manual', kickoff: KICK })],
    'm1',
    KICK
  );
  assert.deepEqual(plan.cancelIds, []);
  assert.equal(plan.alreadyUpToDate, true);
});

check('改期：旧 kickoff 的 manual/prematch 都取消', () => {
  const plan = planManualReminder(
    [
      item('n1', { matchId: 'm1', kind: 'manual', kickoff: '2026-11-20T22:00' }),
      item('n2', { matchId: 'm1', kind: 'prematch', kickoff: '2026-11-20T22:00' })
    ],
    'm1',
    KICK
  );
  assert.deepEqual(plan.cancelIds.sort(), ['n1', 'n2']);
  assert.equal(plan.alreadyUpToDate, false);
});

check('无关比赛/无关 kind 不受影响', () => {
  const plan = planManualReminder(
    [
      item('n1', { matchId: 'm2', kind: 'prematch', kickoff: KICK }),
      item('n2', { matchId: 'm1', kind: 'second-half', kickoff: KICK }),
      item('n3', { matchId: 'm1', kind: 'manual' })
    ],
    'm1',
    KICK
  );
  assert.deepEqual(plan.cancelIds, ['n3']);
  assert.equal(plan.alreadyUpToDate, false);
});

check('manual + prematch 并存：取消 prematch，manual 保持幂等', () => {
  const plan = planManualReminder(
    [
      item('n1', { matchId: 'm1', kind: 'manual', kickoff: KICK }),
      item('n2', { matchId: 'm1', kind: 'prematch', kickoff: KICK })
    ],
    'm1',
    KICK
  );
  assert.deepEqual(plan.cancelIds, ['n2']);
  assert.equal(plan.alreadyUpToDate, true);
});

console.log(`[test:reminder-plan] ${passed} passed`);