import assert from 'node:assert/strict';
import { detectCrunchPeriods } from '../src/core/crunch.js';
import { buildPlanIcs } from '../src/core/ics.js';
import { ts } from '../src/core/engine.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

const nowTs = ts('2026-11-14T20:00');

check('detectCrunchPeriods flags >=2 matches in 10d window with S3/S4 or star>=2 and skips tbd cleanly', () => {
  const fixtures = [
    { id: 'c1', l: 'PL', h: 'ARS', a: 'CHE', t: '2026-11-16T04:00', st: 'sched', tbd: false, sc: [1, 0] }, // S4
    { id: 'c2', l: 'UCL', h: 'ARS', a: 'BAY', t: '2026-11-20T04:00', st: 'sched', tbd: false }, // S4
    { id: 'c3', l: 'PL', h: 'ARS', a: 'BOU', t: '2026-11-24T20:00', st: 'sched', tbd: false }, // 8d later -> window of 3 matches
    { id: 'c-tbd', l: 'PL', h: 'ARS', a: 'WHU', t: '2026-11-22T02:00', st: 'sched', tbd: true },
    { id: 'c-far', l: 'PL', h: 'ARS', a: 'EVE', t: '2026-12-05T04:00', st: 'sched', tbd: false } // outside 14d
  ];

  const { alerts, totalTbdSkipped } = detectCrunchPeriods(['ARS'], fixtures, nowTs);
  assert.equal(totalTbdSkipped, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].teamId, 'ARS');
  assert.equal(alerts[0].matchCount, 3);
  assert.equal(alerts[0].nightCount, 2);
  assert.equal(alerts[0].tbdSkipped, 1);
  assert.equal(alerts[0].highlightedIds.includes('c-tbd'), false);
  assert.equal(alerts[0].highlightedIds.includes('c-far'), false);
});

check('buildPlanIcs outputs RFC 5545 calendar with tier and stop-loss and zero spoilers', () => {
  const picks = [
    { m: { id: 'p1', l: 'PL', r: 15, h: 'ARS', a: 'MCI', t: '2026-11-16T04:00', st: 'sched', sc: [2, 1] } },
    { m: { id: 'p-tbd', l: 'PL', r: 15, h: 'LIV', a: 'CHE', t: '2026-11-17T04:00', st: 'sched', tbd: true } }
  ];
  const ics = buildPlanIcs(
    picks,
    { enabled: true, wakeTime: '07:30', weekendEnabled: false, minSleep: 7 },
    { now: nowTs, reminderMinutes: 15 }
  );
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('UID:p1@nightowl-terrace'));
  assert.equal(ics.includes('p-tbd'), false);
  assert.ok(ics.includes('S4'));
  assert.ok(ics.includes('建议止损'));
  assert.equal(ics.includes('2 - 1'), false);
  assert.equal(ics.includes('\r\n'), true);
});

console.log(`[test:crunch] ${passed} passed`);
