/**
 * 局域网同步数据包结构与双向无损合并算法（桌面 / 手机共用纯函数）
 *
 * 合规与防剧透收敛原则：
 *   1. prefs：按 prefsUpdatedAt 执行 Last-Write-Wins（仅保留 11 个白名单字段）；
 *   2. weekOverrides：按 weekKey 执行 LWW（同时间戳时合并并集并保持 pinned > excluded）；
 *   3. watchLater 队列：按 id 求并集，严格遵循 `watched > pending` 单向状态收敛；
 *   4. revealedIds：只增不减集合并集（Union）；
 *   5. diary（观赛情绪印章）：按 matchId 比较 updatedAt 取较新条目，受 500 条上限约束。
 */

import { defaultPrefs } from './prefs.js';
import { normalizeQueue, WATCH_LATER_LIMIT, WATCH_LATER_STATUS } from './queue.js';
import { normalizeWeekOverrides } from './week-overrides.js';
import { normalizeDiary } from './diary.js';

export const SYNC_SCHEMA_VERSION = 1;

export const ALLOWED_PREF_KEYS = Object.freeze([
  'followedTeams',
  'followedLeagues',
  'weeklyBudget',
  'spoilerFree',
  'notifyBefore15',
  'notifyLiveEvents',
  'sleepEnabled',
  'sleepWakeTime',
  'sleepWeekendEnabled',
  'sleepWeekendWakeTime',
  'sleepMinHours'
]);

function sanitizePrefs(rawPrefs) {
  const base = defaultPrefs();
  if (!rawPrefs || typeof rawPrefs !== 'object') return base;
  for (const key of ALLOWED_PREF_KEYS) {
    if (key in rawPrefs && rawPrefs[key] !== undefined) {
      base[key] = rawPrefs[key];
    }
  }
  base.followedTeams = Array.isArray(base.followedTeams)
    ? [...new Set(base.followedTeams.filter(x => typeof x === 'string' && x))]
    : [];
  base.followedLeagues = Array.isArray(base.followedLeagues)
    ? [...new Set(base.followedLeagues.filter(x => typeof x === 'string' && x))]
    : [];
  return base;
}

function sanitizeWeekOverridesMap(rawMap) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
  const out = {};
  for (const [weekKey, val] of Object.entries(rawMap)) {
    if (typeof weekKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) continue;
    out[weekKey] = normalizeWeekOverrides(val);
  }
  return out;
}

function sanitizeRevealedIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))];
}

/**
 * 构建用于局域网同步的标准白名单数据包
 */
export function buildSyncBundle(input = {}, nowTs = Date.now()) {
  const exportedAt = Number.isFinite(input.exportedAt) ? input.exportedAt : nowTs;
  return {
    version: SYNC_SCHEMA_VERSION,
    exportedAt,
    prefsUpdatedAt: Number.isFinite(input.prefsUpdatedAt) ? input.prefsUpdatedAt : exportedAt,
    prefs: sanitizePrefs(input.prefs),
    weekOverridesUpdatedAt: Number.isFinite(input.weekOverridesUpdatedAt)
      ? input.weekOverridesUpdatedAt
      : exportedAt,
    weekOverridesByWeek: sanitizeWeekOverridesMap(input.weekOverridesByWeek),
    watchLater: normalizeQueue(input.watchLater, nowTs),
    revealedIds: sanitizeRevealedIds(input.revealedIds),
    diary: normalizeDiary(input.diary)
  };
}

/**
 * 校验并规范化外部同步数据包
 */
export function normalizeSyncBundle(raw, nowTs = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('同步包必须是 JSON 对象');
  }
  if (raw.version != null && Number(raw.version) !== SYNC_SCHEMA_VERSION) {
    throw new Error(`不支持的同步协议版本: ${raw.version}`);
  }
  return buildSyncBundle(raw, nowTs);
}

/**
 * 双向状态增量合并
 */
export function mergeSyncBundles(localRaw, remoteRaw, nowTs = Date.now()) {
  const local = normalizeSyncBundle(localRaw, nowTs);
  const remote = normalizeSyncBundle(remoteRaw, nowTs);

  // 1. prefs LWW
  const remoteNewerPrefs = remote.prefsUpdatedAt > local.prefsUpdatedAt;
  const prefs = remoteNewerPrefs ? remote.prefs : local.prefs;
  const prefsUpdatedAt = Math.max(local.prefsUpdatedAt, remote.prefsUpdatedAt);

  // 2. weekOverridesByWeek（按 weekOverridesUpdatedAt LWW；若精确同时间戳则并集合并）
  const weekKeys = new Set([
    ...Object.keys(local.weekOverridesByWeek),
    ...Object.keys(remote.weekOverridesByWeek)
  ]);
  const weekOverridesByWeek = {};
  const remoteNewerWeek = remote.weekOverridesUpdatedAt > local.weekOverridesUpdatedAt;
  const equalWeekTs = remote.weekOverridesUpdatedAt === local.weekOverridesUpdatedAt;
  for (const wk of weekKeys) {
    const lv = local.weekOverridesByWeek[wk];
    const rv = remote.weekOverridesByWeek[wk];
    if (!lv) {
      weekOverridesByWeek[wk] = rv;
    } else if (!rv) {
      weekOverridesByWeek[wk] = lv;
    } else if (equalWeekTs) {
      weekOverridesByWeek[wk] = normalizeWeekOverrides({
        pinnedIds: [...lv.pinnedIds, ...rv.pinnedIds],
        excludedIds: [...lv.excludedIds, ...rv.excludedIds],
        blockedNights: [...lv.blockedNights, ...rv.blockedNights]
      });
    } else {
      weekOverridesByWeek[wk] = remoteNewerWeek ? rv : lv;
    }
  }
  const weekOverridesUpdatedAt = Math.max(local.weekOverridesUpdatedAt, remote.weekOverridesUpdatedAt);

  // 3. watchLater 并集 + `watched > pending` 单向状态收敛 + 上限裁剪
  const qMap = new Map();
  for (const item of [...local.watchLater, ...remote.watchLater]) {
    const prev = qMap.get(item.id);
    if (!prev) {
      qMap.set(item.id, { ...item });
      continue;
    }
    const status =
      prev.status === WATCH_LATER_STATUS.WATCHED || item.status === WATCH_LATER_STATUS.WATCHED
        ? WATCH_LATER_STATUS.WATCHED
        : WATCH_LATER_STATUS.PENDING;
    const addedAt = Math.max(prev.addedAt || 0, item.addedAt || 0);
    const watchedAt =
      status === WATCH_LATER_STATUS.WATCHED
        ? Math.max(prev.watchedAt || 0, item.watchedAt || 0) || nowTs
        : null;
    qMap.set(item.id, {
      id: item.id,
      night: item.night || prev.night,
      addedAt,
      status,
      watchedAt
    });
  }
  const mergedWatchLater = normalizeQueue(
    [...qMap.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, WATCH_LATER_LIMIT),
    nowTs
  );

  // 4. revealedIds 只增不减 Union
  const mergedRevealed = [...new Set([...local.revealedIds, ...remote.revealedIds])];

  // 5. diary 按 updatedAt 取较新条目
  const diaryEntries = { ...local.diary.entries };
  for (const [matchId, rEntry] of Object.entries(remote.diary.entries)) {
    const lEntry = diaryEntries[matchId];
    if (!lEntry || (rEntry.updatedAt || 0) > (lEntry.updatedAt || 0)) {
      diaryEntries[matchId] = rEntry;
    }
  }
  const mergedDiary = normalizeDiary({ version: 1, entries: diaryEntries });

  return {
    version: SYNC_SCHEMA_VERSION,
    exportedAt: nowTs,
    prefsUpdatedAt,
    prefs,
    weekOverridesUpdatedAt,
    weekOverridesByWeek,
    watchLater: mergedWatchLater,
    revealedIds: mergedRevealed,
    diary: mergedDiary
  };
}
