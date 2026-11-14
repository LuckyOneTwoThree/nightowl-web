import assert from 'node:assert/strict';
import { planSecondHalfCutIn, isLateNightCutInEligible } from '../src/core/second-half.js';
import {
  RADAR_VERDICT,
  evaluateRadarSuspense,
  isRadarWindowActive,
  isRadarWindowExpired
} from '../src/core/radar.js';
import { ts } from '../src/core/engine.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

const profile = {
  enabled: true,
  wakeTime: '07:30',
  weekendEnabled: false,
  weekendWakeTime: '09:00',
  minSleep: 7
};

check('planSecondHalfCutIn calculates 60min cut-in and 5min wake lead for 04:00 match', () => {
  const m = { id: 'm1', t: '2026-11-15T04:00', st: 'sched', tbd: false };
  const nowTs = ts('2026-11-14T22:00');
  const plan = planSecondHalfCutIn(m, profile, nowTs);
  assert.equal(plan.eligible, true);
  assert.equal(plan.cutInAt, ts('2026-11-15T05:00'));
  assert.equal(plan.alarmAt, ts('2026-11-15T04:55'));
  assert.equal(plan.endAt, ts('2026-11-15T06:00'));
  // From 23:30 bedtime to 04:55 = 325 mins
  assert.equal(plan.preSleepMinutes, 325);
  assert.equal(plan.postSleepMinutes, 90);
  assert.equal(plan.savedNightMinutes, 55);
  assert.equal(isLateNightCutInEligible(m), true);
});

check('planSecondHalfCutIn respects late nowTs after bedtime', () => {
  const m = { id: 'm1b', t: '2026-11-15T04:00', st: 'sched', tbd: false };
  const nowTs = ts('2026-11-15T01:30');
  const plan = planSecondHalfCutIn(m, profile, nowTs);
  assert.equal(plan.eligible, true);
  assert.equal(plan.preSleepMinutes, 205); // 01:30 to 04:55
});

check('planSecondHalfCutIn rejects prime-time, tbd, done, and past-cutin', () => {
  assert.equal(
    planSecondHalfCutIn({ id: 'prime', t: '2026-11-14T20:30', st: 'sched' }, profile, ts('2026-11-14T18:00'))
      .eligible,
    false
  );
  assert.equal(
    planSecondHalfCutIn({ id: 'tbd', t: '2026-11-15T04:00', st: 'sched', tbd: true }, profile, ts('2026-11-14T18:00'))
      .reason,
    'tbd'
  );
  assert.equal(
    planSecondHalfCutIn({ id: 'done', t: '2026-11-15T04:00', st: 'done' }, profile, ts('2026-11-14T18:00'))
      .reason,
    'not-scheduled'
  );
  assert.equal(
    planSecondHalfCutIn({ id: 'past', t: '2026-11-15T04:00', st: 'sched' }, profile, ts('2026-11-15T05:05'))
      .reason,
    'past-cutin'
  );
});

check('evaluateRadarSuspense verdicts & strict anti-spoiler DTO sanitization', () => {
  const m = { id: 'r1', t: '2026-11-15T04:00', st: 'live' };

  const unavailable = evaluateRadarSuspense(m, { state: 'scheduled', score: { h: null, a: null } });
  assert.equal(unavailable.verdict, RADAR_VERDICT.UNAVAILABLE);

  const garbage = evaluateRadarSuspense(m, { state: 'live', minute: "62'", score: { h: 4, a: 0 }, events: [] });
  assert.equal(garbage.verdict, RADAR_VERDICT.GARBAGE_TIME);
  assert.deepEqual(Object.keys(garbage).sort(), ['matchId', 'minuteLabel', 'verdict']);

  const dullDraw = evaluateRadarSuspense(m, { state: 'live', minute: "60'", score: { h: 0, a: 0 }, events: [] }, {});
  assert.equal(dullDraw.verdict, RADAR_VERDICT.DULL_DRAW);
  assert.equal('score' in dullDraw, false);
  assert.equal('leadingSide' in dullDraw, false);
  assert.equal('goals' in dullDraw, false);

  const worthGoals = evaluateRadarSuspense(
    m,
    { state: 'live', minute: "64'", score: { h: 2, a: 1 }, events: [{ type: 'goal', player: 'Messi' }] },
    {}
  );
  assert.equal(worthGoals.verdict, RADAR_VERDICT.WORTH_WAKING);
  assert.equal(JSON.stringify(worthGoals).includes('Messi'), false);

  const worthTop00 = evaluateRadarSuspense(
    m,
    { state: 'live', minute: "58'", score: { h: 0, a: 0 }, events: [] },
    { isDerby: true }
  );
  assert.equal(worthTop00.verdict, RADAR_VERDICT.WORTH_WAKING);
});

check('radar time window check matches [55, 70] minutes after kickoff', () => {
  const m = { id: 'rw', t: '2026-11-15T04:00', st: 'sched' };
  assert.equal(isRadarWindowActive(m, ts('2026-11-15T04:54')), false);
  assert.equal(isRadarWindowActive(m, ts('2026-11-15T04:55')), true);
  assert.equal(isRadarWindowActive(m, ts('2026-11-15T05:10')), true);
  assert.equal(isRadarWindowActive(m, ts('2026-11-15T05:11')), false);
  assert.equal(isRadarWindowExpired(m, ts('2026-11-15T05:11')), true);
});

console.log(`[test:radar] ${passed} passed`);
