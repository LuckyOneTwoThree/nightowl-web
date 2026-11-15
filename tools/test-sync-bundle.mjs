import assert from 'node:assert/strict';
import { buildSyncBundle, mergeSyncBundles } from '../src/core/sync-bundle.js';
import { removeDiaryEntry, upsertDiaryEntry } from '../src/core/diary.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

check('mergeSyncBundles applies prefs LWW and strips unknown preference keys', () => {
  const local = buildSyncBundle({
    prefsUpdatedAt: 1000,
    prefs: { followedTeams: ['ARS'], weeklyBudget: 6, extraSecret: 'drop-me' }
  });
  const remote = buildSyncBundle({
    prefsUpdatedAt: 2000,
    prefs: { followedTeams: ['ARS', 'MCI'], weeklyBudget: 8, spoilerFree: false }
  });
  assert.equal('extraSecret' in local.prefs, false);

  const merged = mergeSyncBundles(local, remote, 3000);
  assert.equal(merged.prefsUpdatedAt, 2000);
  assert.deepEqual(merged.prefs.followedTeams, ['ARS', 'MCI']);
  assert.equal(merged.prefs.weeklyBudget, 8);
  assert.equal(merged.prefs.spoilerFree, false);
});

check('mergeSyncBundles enforces watched > pending convergence and revealedIds union', () => {
  const now = 1_795_000_000_000;
  const local = buildSyncBundle(
    {
      watchLater: [
        { id: 'm1', night: '2026-11-15', addedAt: now - 5000, status: 'pending' },
        { id: 'm2', night: '2026-11-15', addedAt: now - 4000, status: 'pending' }
      ],
      revealedIds: ['m1'],
      diary: {
        version: 1,
        entries: {
          m1: { matchId: 'm1', mode: 'replay', stamp: 'epic', note: 'old', recordedAt: 10, updatedAt: 10 }
        }
      }
    },
    now
  );
  const remote = buildSyncBundle(
    {
      watchLater: [
        { id: 'm1', night: '2026-11-15', addedAt: now - 5000, status: 'watched', watchedAt: now - 100 },
        { id: 'm3', night: '2026-11-16', addedAt: now - 3000, status: 'pending' }
      ],
      revealedIds: ['m2'],
      diary: {
        version: 1,
        entries: {
          m1: { matchId: 'm1', mode: 'replay', stamp: 'heartbreak', note: 'newer', recordedAt: 10, updatedAt: 99 }
        }
      }
    },
    now
  );

  const merged = mergeSyncBundles(local, remote, now);
  const qm1 = merged.watchLater.find(x => x.id === 'm1');
  assert.equal(qm1.status, 'watched'); // pending NEVER regresses watched!
  assert.equal(merged.watchLater.length, 3);
  assert.deepEqual(merged.revealedIds.sort(), ['m1', 'm2']);
  assert.equal(merged.diary.entries.m1.stamp, 'heartbreak');
  assert.equal(merged.diary.entries.m1.note, 'newer');
});

check('mergeSyncBundles merges weekOverridesByWeek per-week and propagates resets and diary tombstones', () => {
  let dLocal = upsertDiaryEntry(null, { matchId: 'm-del', mode: 'live', stamp: 'epic' }, 100);
  dLocal = removeDiaryEntry(dLocal, 'm-del', 500);
  const dRemote = upsertDiaryEntry(null, { matchId: 'm-del', mode: 'live', stamp: 'epic' }, 200);

  const local = buildSyncBundle({
    weekUpdatedAtByWeek: { '2026-11-09': 3000, '2026-11-16': 1000 },
    weekOverridesByWeek: {
      '2026-11-09': { pinnedIds: ['desk-pin'], excludedIds: [], blockedNights: [] },
      '2026-11-16': { pinnedIds: ['old-pin'], excludedIds: [], blockedNights: [] }
    },
    diary: dLocal
  }, 4000);

  const remote = buildSyncBundle({
    weekUpdatedAtByWeek: { '2026-11-09': 1000, '2026-11-16': 4000 },
    weekOverridesByWeek: {
      '2026-11-09': { pinnedIds: ['old-mobile'], excludedIds: [], blockedNights: [] },
      '2026-11-16': { pinnedIds: ['mob-pin'], excludedIds: [], blockedNights: [] }
    },
    diary: dRemote
  }, 5000);

  const merged = mergeSyncBundles(local, remote, 6000);
  assert.deepEqual(merged.weekOverridesByWeek['2026-11-09'].pinnedIds, ['desk-pin']);
  assert.deepEqual(merged.weekOverridesByWeek['2026-11-16'].pinnedIds, ['mob-pin']);
  assert.equal(merged.diary.entries['m-del'], undefined);
  assert.equal(merged.diary.deleted['m-del'], 500);

  // 周重置传播：remote 在 t=7000 清空了 2026-11-09
  const resetRemote = buildSyncBundle({
    weekUpdatedAtByWeek: { '2026-11-09': 7000 },
    weekOverridesByWeek: {}
  }, 7000);
  const afterReset = mergeSyncBundles(merged, resetRemote, 7100);
  assert.equal(afterReset.weekOverridesByWeek['2026-11-09'], undefined);
});

console.log(`[test:sync-bundle] ${passed} passed`);
