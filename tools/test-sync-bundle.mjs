import assert from 'node:assert/strict';
import { buildSyncBundle, mergeSyncBundles, MAX_FUTURE_CLOCK_SKEW_MS } from '../src/core/sync-bundle.js';
import { normalizePrefs } from '../src/core/prefs.js';
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

check('buildSyncBundle tolerates null input and mergeSyncBundles protects prefs types, partial updates, and clock skew', () => {
  const nullBuilt = buildSyncBundle(null, 5000);
  assert.equal(nullBuilt.exportedAt, 5000);
  assert.equal(nullBuilt.prefs.weeklyBudget, 4);

  const local = buildSyncBundle(
    {
      prefsUpdatedAt: 1000,
      prefs: { followedTeams: ['ARS'], followedLeagues: ['PL', 'UCL'], weeklyBudget: 6, notifyBefore15: true }
    },
    2000
  );

  // 远端只带部分 prefs 且夹杂非法类型字段，不应以默认值覆写 followedLeagues，也不能放进字符串
  const partialDirtyRemote = {
    version: 1,
    prefsUpdatedAt: 9_999_999_999_999,
    prefs: {
      weeklyBudget: 'oops',
      sleepMinHours: -99,
      notifyBefore15: 'yes',
      sleepWakeTime: '99:99',
      spoilerFree: false
    }
  };
  const now = 3000;
  const merged = mergeSyncBundles(local, partialDirtyRemote, now);
  assert.equal(merged.prefs.weeklyBudget, 6);
  assert.equal(merged.prefs.notifyBefore15, true);
  assert.equal(merged.prefs.spoilerFree, false);
  assert.deepEqual(merged.prefs.followedLeagues, ['PL', 'UCL']);
  assert.equal(merged.prefs.sleepMinHours, 7);
  assert.ok(merged.prefsUpdatedAt <= now + MAX_FUTURE_CLOCK_SKEW_MS);

  // 未来时钟被夹逼后，随后超过容差窗口的本地更新仍可胜出
  const laterLocal = buildSyncBundle(
    {
      prefsUpdatedAt: now + MAX_FUTURE_CLOCK_SKEW_MS + 1000,
      prefs: { ...merged.prefs, weeklyBudget: 7.5 }
    },
    now + MAX_FUTURE_CLOCK_SKEW_MS + 2000
  );
  const merged2 = mergeSyncBundles(laterLocal, merged, now + MAX_FUTURE_CLOCK_SKEW_MS + 2000);
  assert.equal(merged2.prefs.weeklyBudget, 7.5);

  const clean = normalizePrefs({ weeklyBudget: 12, sleepMinHours: 2, sleepWakeTime: 'bad' });
  assert.equal(clean.weeklyBudget, 8);
  assert.equal(clean.sleepMinHours, 4);
  assert.equal(clean.sleepWakeTime, '07:30');
});

check('mergeSyncBundles clamps future clock skew on weekUpdatedAtByWeek, diary, and watchLater', () => {
  const now = 1_795_000_000_000;
  const evilRemote = {
    version: 1,
    weekUpdatedAtByWeek: { '2026-11-16': now + 365 * 86400_000 },
    weekOverridesByWeek: {
      '2026-11-16': { pinnedIds: ['evil-pin'], excludedIds: [], blockedNights: [] }
    },
    watchLater: [
      { id: 'evil-q', night: '2026-11-16', addedAt: now + 365 * 86400_000, status: 'pending' }
    ],
    diary: {
      version: 1,
      entries: {
        'm-evil': { matchId: 'm-evil', mode: 'live', stamp: 'disaster', recordedAt: now + 1e10, updatedAt: now + 1e10 }
      }
    }
  };
  const localBase = buildSyncBundle({}, now);
  const merged = mergeSyncBundles(localBase, evilRemote, now);
  assert.ok(merged.weekUpdatedAtByWeek['2026-11-16'] <= now + MAX_FUTURE_CLOCK_SKEW_MS);
  assert.ok(merged.diary.entries['m-evil'].updatedAt <= now + MAX_FUTURE_CLOCK_SKEW_MS);
  assert.ok(merged.watchLater[0].addedAt <= now + MAX_FUTURE_CLOCK_SKEW_MS);

  // 本地超越容差窗口的更新必须能正常胜出，不被远端未来时间戳永久锁死
  const laterTs = now + MAX_FUTURE_CLOCK_SKEW_MS + 5000;
  const localLater = buildSyncBundle(
    {
      weekUpdatedAtByWeek: { '2026-11-16': laterTs },
      weekOverridesByWeek: {
        '2026-11-16': { pinnedIds: ['local-win'], excludedIds: [], blockedNights: [] }
      },
      diary: upsertDiaryEntry(null, { matchId: 'm-evil', mode: 'live', stamp: 'epic' }, laterTs)
    },
    laterTs
  );
  const resolved = mergeSyncBundles(localLater, merged, laterTs);
  assert.deepEqual(resolved.weekOverridesByWeek['2026-11-16'].pinnedIds, ['local-win']);
  assert.equal(resolved.diary.entries['m-evil'].stamp, 'epic');
});

check('weekOverrides 未知时间戳语义：显式优先、双未知并集、重复构建不推进时间戳', () => {
  const now = 1_795_000_000_000;
  const wk = '2026-11-09';
  const ov = pins => ({ pinnedIds: pins, excludedIds: [], blockedNights: [] });

  // 回归：本地遗留数据无任何时间戳（全局=null），远端有显式全局时间戳 → 远端胜出，
  // 绝不能把本地旧值盖上 exportedAt 伪装成「刚刚更新」
  const legacyLocal = buildSyncBundle({ weekOverridesByWeek: { [wk]: ov(['old-desktop']) } }, now);
  assert.equal(legacyLocal.weekOverridesUpdatedAt, null);
  const explicitRemote = buildSyncBundle(
    { weekOverridesUpdatedAt: now - 5000, weekOverridesByWeek: { [wk]: ov(['new-mobile']) } },
    now
  );
  const merged = mergeSyncBundles(legacyLocal, explicitRemote, now);
  assert.deepEqual(merged.weekOverridesByWeek[wk].pinnedIds, ['new-mobile']);
  assert.equal(merged.weekOverridesUpdatedAt, now - 5000);

  // 双方均未知 → 并集合并，全局时间戳保持 null，不推进到当前时刻
  const unknownA = buildSyncBundle({ weekOverridesByWeek: { [wk]: ov(['a']) } }, now);
  const unknownB = buildSyncBundle({ weekOverridesByWeek: { [wk]: ov(['b']) } }, now);
  const unionMerged = mergeSyncBundles(unknownA, unknownB, now);
  assert.deepEqual(unionMerged.weekOverridesByWeek[wk].pinnedIds.sort(), ['a', 'b']);
  assert.equal(unionMerged.weekOverridesUpdatedAt, null);

  // 同一 bundle 重复构建不推进时间戳（null 保持 null，显式值保持原值）
  assert.equal(buildSyncBundle(unionMerged, now + 60000).weekOverridesUpdatedAt, null);
  assert.equal(buildSyncBundle(explicitRemote, now + 60000).weekOverridesUpdatedAt, now - 5000);

  // 仅一侧有逐周时间戳：逐周显式 > 对端全局未知
  const perWeekLocal = buildSyncBundle(
    { weekUpdatedAtByWeek: { [wk]: now - 1000 }, weekOverridesByWeek: { [wk]: ov(['per-week']) } },
    now
  );
  const globalUnknownRemote = buildSyncBundle({ weekOverridesByWeek: { [wk]: ov(['unknown']) } }, now);
  const perWeekMerged = mergeSyncBundles(perWeekLocal, globalUnknownRemote, now);
  assert.deepEqual(perWeekMerged.weekOverridesByWeek[wk].pinnedIds, ['per-week']);

  // 未知一侧的重置不生效：远端无该周数据且时间戳未知，不得清除本地显式周计划
  const resetUnknownRemote = buildSyncBundle({ weekOverridesByWeek: {} }, now);
  const kept = mergeSyncBundles(perWeekLocal, resetUnknownRemote, now);
  assert.deepEqual(kept.weekOverridesByWeek[wk].pinnedIds, ['per-week']);
});

check('ts=0 视为未知：不击败对端未知、逐周 0 被过滤', () => {
  const now = 1_795_000_000_000;
  const wk = '2026-11-09';
  const ov = pins => ({ pinnedIds: pins, excludedIds: [], blockedNights: [] });
  const zeroLocal = buildSyncBundle(
    { weekOverridesUpdatedAt: 0, weekOverridesByWeek: { [wk]: ov(['zero']) } },
    now
  );
  assert.equal(zeroLocal.weekOverridesUpdatedAt, null);
  const unknownRemote = buildSyncBundle({ weekOverridesByWeek: { [wk]: ov(['unknown']) } }, now);
  const merged = mergeSyncBundles(zeroLocal, unknownRemote, now);
  assert.deepEqual(merged.weekOverridesByWeek[wk].pinnedIds.sort(), ['unknown', 'zero']);
  const perWeekZero = buildSyncBundle(
    { weekUpdatedAtByWeek: { [wk]: 0 }, weekOverridesByWeek: { [wk]: ov(['pw']) } },
    now
  );
  assert.deepEqual(perWeekZero.weekUpdatedAtByWeek, {});
});

console.log(`[test:sync-bundle] ${passed} passed`);
