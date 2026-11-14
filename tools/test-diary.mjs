import assert from 'node:assert/strict';
import {
  DIARY_MAX_ENTRIES,
  DIARY_NOTE_MAX_LEN,
  buildSeasonReport,
  normalizeDiary,
  removeDiaryEntry,
  upsertDiaryEntry
} from '../src/core/diary.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

const sampleFixtures = [
  { id: 'f1', h: 'ARS', a: 'MCI', t: '2026-11-15T04:00', st: 'done', sc: [3, 2] }, // 5 goals, S4, ARS win
  { id: 'f2', h: 'CHE', a: 'ARS', t: '2026-11-18T03:30', st: 'done', sc: [0, 0] }, // 0-0 dull draw, S3, ARS draw
  { id: 'f3', h: 'LIV', a: 'ARS', t: '2026-11-22T01:00', st: 'done', sc: [2, 0] }, // S2, normal 2-0, unrevealed replay
  { id: 'f4', h: 'MUN', a: 'TOT', t: '2026-11-24T20:00', st: 'done', sc: [2, 2] }  // S0 prime
];

check('upsertDiaryEntry enforces 60 char note cap and removeDiaryEntry removes item', () => {
  const longNote = 'a'.repeat(95);
  let diary = upsertDiaryEntry(null, { matchId: 'f1', mode: 'live', stamp: 'epic', note: longNote }, 1000);
  assert.equal(diary.entries.f1.note.length, DIARY_NOTE_MAX_LEN);
  diary = upsertDiaryEntry(diary, { matchId: 'f2', mode: 'second_half', stamp: 'sleepy', note: '沉闷' }, 2000);
  assert.equal(Object.keys(diary.entries).length, 2);
  diary = removeDiaryEntry(diary, 'f2');
  assert.equal(Object.keys(diary.entries).length, 1);
  assert.equal(diary.entries.f2, undefined);
});

check('normalizeDiary trims entries above 500 keeping newest updatedAt', () => {
  const entries = {};
  for (let i = 0; i < 520; i += 1) {
    entries[`m-${i}`] = {
      matchId: `m-${i}`,
      mode: 'live',
      stamp: 'epic',
      note: '',
      recordedAt: i,
      updatedAt: i
    };
  }
  const normalized = normalizeDiary({ version: 1, entries });
  assert.equal(Object.keys(normalized.entries).length, DIARY_MAX_ENTRIES);
  assert.equal(normalized.entries['m-0'], undefined);
  assert.ok(normalized.entries['m-519']);
});

check('buildSeasonReport respects spoilerFree + revealedIds isolation', () => {
  let diary = null;
  diary = upsertDiaryEntry(diary, { matchId: 'f1', mode: 'second_half', stamp: 'epic', note: '补时刺激' }, 1000);
  diary = upsertDiaryEntry(diary, { matchId: 'f2', mode: 'replay', stamp: 'sleepy' }, 2000);
  diary = upsertDiaryEntry(diary, { matchId: 'f3', mode: 'replay', stamp: 'disaster' }, 3000);
  diary = upsertDiaryEntry(diary, { matchId: 'f4', mode: 'live', stamp: 'epic' }, 4000);

  // spoilerFree=true, only f1 revealed -> f2 & f3 MUST be masked from outcome stats
  const maskedReport = buildSeasonReport(
    diary,
    sampleFixtures,
    { spoilerFree: true, followedTeams: ['ARS'] },
    ['f1']
  );
  assert.equal(maskedReport.safeSummary.totalWatched, 4);
  assert.equal(maskedReport.safeSummary.lateNightCount, 2); // f1(S4) + f2(S3)
  assert.equal(maskedReport.outcomeSummary.maskedBySpoilerCount, 2);
  assert.equal(maskedReport.outcomeSummary.inspectedCount, 2); // f1(revealed) + f4(live)
  assert.equal(maskedReport.outcomeSummary.dullDrawCount, 0); // f2 masked!

  const arsMasked = maskedReport.teamRecords.find(r => r.teamId === 'ARS');
  assert.equal(arsMasked.watched, 3); // attended f1,f2,f3 without leaking results
  assert.equal(arsMasked.decided, 1); // only f1 counted in W/D/L
  assert.equal(arsMasked.w, 1);

  // Reveal all -> all 4 inspected, dullDraw=1, ARS W1 D1 L1
  const fullReport = buildSeasonReport(
    diary,
    sampleFixtures,
    { spoilerFree: true, followedTeams: ['ARS'] },
    ['f1', 'f2', 'f3']
  );
  assert.equal(fullReport.outcomeSummary.maskedBySpoilerCount, 0);
  assert.equal(fullReport.outcomeSummary.inspectedCount, 4);
  assert.equal(fullReport.outcomeSummary.worthItCount, 2); // f1(3-2), f4(2-2)
  assert.equal(fullReport.outcomeSummary.dullDrawCount, 1); // f2(0-0)
  const arsFull = fullReport.teamRecords.find(r => r.teamId === 'ARS');
  assert.equal(arsFull.w, 1);
  assert.equal(arsFull.d, 1);
  assert.equal(arsFull.l, 1);
  assert.equal(arsFull.winRate, 33);
});

check('buildSeasonReport maps deterministic persona titles', () => {
  let diary = null;
  diary = upsertDiaryEntry(diary, { matchId: 'f1', mode: 'second_half', stamp: 'epic' }, 1);
  diary = upsertDiaryEntry(diary, { matchId: 'f2', mode: 'second_half', stamp: 'epic' }, 2);
  diary = upsertDiaryEntry(diary, { matchId: 'f3', mode: 'live', stamp: 'epic' }, 3);
  const report = buildSeasonReport(diary, sampleFixtures, { spoilerFree: false }, []);
  assert.equal(report.persona.code, 'SECOND_HALF_ACTUARY');
});

console.log(`[test:diary] ${passed} passed`);
