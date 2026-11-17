/**
 * 局域网同步数据包结构与双向无损合并算法（桌面 / 手机共用纯函数）
 *
 * 合规与防剧透收敛原则：
 *   1. prefs：按 prefsUpdatedAt 执行 Last-Write-Wins（仅保留 11 个白名单字段）；
 *   2. weekOverrides：按 weekKey 执行 LWW（同时间戳时合并并集并保持 pinned > excluded）；
 *      时间戳缺失时为「未知」（null）而非导出时刻——显式时间戳一侧胜出，
 *      双方均未知才并集合并，避免旧数据被盖上「刚刚更新」的假时间戳覆盖对端；
 *   3. watchLater 队列：按 id 求并集，严格遵循 `watched > pending` 单向状态收敛；
 *   4. revealedIds：只增不减集合并集（Union）；
 *   5. diary（观赛情绪印章）：按 matchId 比较 updatedAt 取较新条目，受 500 条上限约束。
 */

import { defaultPrefs, extractValidPrefPatch, normalizePrefs } from './prefs.js';
import { normalizeQueue, WATCH_LATER_LIMIT, WATCH_LATER_STATUS } from './queue.js';
import { normalizeWeekOverrides } from './week-overrides.js';
import { normalizeDiary } from './diary.js';
import { clampTimestamp, MAX_FUTURE_CLOCK_SKEW_MS } from './sync-clock.js';

export { MAX_FUTURE_CLOCK_SKEW_MS };
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
  return normalizePrefs(rawPrefs, defaultPrefs());
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

function sanitizeWeekUpdatedAtMap(rawMap, nowTs = Date.now()) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
  const out = {};
  for (const [weekKey, tsVal] of Object.entries(rawMap)) {
    if (typeof weekKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) continue;
    const t = clampTimestamp(tsVal, nowTs, -1);
    if (t >= 0) out[weekKey] = t;
  }
  return out;
}

function sanitizeRevealedIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))];
}

// 未知（null/非法）时间戳参与比较的语义：显式 > 未知；双未知视为相等（走并集）
const tsKnown = t => Number.isFinite(t);
const tsNewer = (a, b) => tsKnown(a) && (!tsKnown(b) || a > b);
const tsEqual = (a, b) => (!tsKnown(a) && !tsKnown(b)) || (tsKnown(a) && tsKnown(b) && a === b);

/**
 * 构建用于局域网同步的标准白名单数据包
 */
export function buildSyncBundle(input = {}, nowTs = Date.now()) {
  const safeInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const exportedAt = clampTimestamp(
    Number.isFinite(safeInput.exportedAt) ? safeInput.exportedAt : nowTs,
    nowTs
  );
  // 缺失全局时间戳 = 未知（null）。绝不能回退 exportedAt：
  // 那会把「不知道何时改的」伪装成「刚刚改的」，让旧数据赢过对端真实较新的修改。
  const weekOverridesUpdatedAt = Number.isFinite(safeInput.weekOverridesUpdatedAt)
    ? clampTimestamp(safeInput.weekOverridesUpdatedAt, nowTs)
    : null;
  return {
    version: SYNC_SCHEMA_VERSION,
    exportedAt,
    prefsUpdatedAt: clampTimestamp(
      Number.isFinite(safeInput.prefsUpdatedAt) ? safeInput.prefsUpdatedAt : exportedAt,
      nowTs
    ),
    prefs: sanitizePrefs(safeInput.prefs),
    weekOverridesUpdatedAt,
    weekUpdatedAtByWeek: sanitizeWeekUpdatedAtMap(safeInput.weekUpdatedAtByWeek, nowTs),
    weekOverridesByWeek: sanitizeWeekOverridesMap(safeInput.weekOverridesByWeek),
    watchLater: normalizeQueue(safeInput.watchLater, nowTs),
    revealedIds: sanitizeRevealedIds(safeInput.revealedIds),
    diary: normalizeDiary(safeInput.diary, nowTs)
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
  const localPatch = extractValidPrefPatch(localRaw?.prefs);
  const remotePatch = extractValidPrefPatch(remoteRaw?.prefs);

  // 1. prefs 字段级安全合并（带未来时钟夹逼；缺失/非法字段不覆写对端既有配置）
  const localPrefsTs = clampTimestamp(local.prefsUpdatedAt, nowTs);
  const remotePrefsTs = clampTimestamp(remote.prefsUpdatedAt, nowTs);
  const remoteNewerPrefs = remotePrefsTs > localPrefsTs;
  const mergedPrefs = { ...defaultPrefs(), ...localPatch };
  for (const key of ALLOWED_PREF_KEYS) {
    const hasLocal = key in localPatch;
    const hasRemote = key in remotePatch;
    if (remoteNewerPrefs) {
      if (hasRemote) mergedPrefs[key] = remotePatch[key];
      else if (hasLocal) mergedPrefs[key] = localPatch[key];
    } else {
      if (hasLocal) mergedPrefs[key] = localPatch[key];
      else if (hasRemote) mergedPrefs[key] = remotePatch[key];
    }
  }
  const prefs = normalizePrefs(mergedPrefs, local.prefs);
  const prefsUpdatedAt = Math.max(localPrefsTs, remotePrefsTs);

  // 2. weekOverridesByWeek（按 weekKey 细粒度 LWW；同时间戳时并集合并；支持重置墓碑传播）
  const weekKeys = new Set([
    ...Object.keys(local.weekOverridesByWeek),
    ...Object.keys(remote.weekOverridesByWeek),
    ...Object.keys(local.weekUpdatedAtByWeek),
    ...Object.keys(remote.weekUpdatedAtByWeek)
  ]);
  const weekOverridesByWeek = {};
  const weekUpdatedAtByWeek = {};
  for (const wk of weekKeys) {
    const lv = local.weekOverridesByWeek[wk];
    const rv = remote.weekOverridesByWeek[wk];
    const hasExplicitL = Object.prototype.hasOwnProperty.call(local.weekUpdatedAtByWeek, wk);
    const hasExplicitR = Object.prototype.hasOwnProperty.call(remote.weekUpdatedAtByWeek, wk);
    const lTs = hasExplicitL ? local.weekUpdatedAtByWeek[wk] : local.weekOverridesUpdatedAt;
    const rTs = hasExplicitR ? remote.weekUpdatedAtByWeek[wk] : remote.weekOverridesUpdatedAt;
    if (hasExplicitL || hasExplicitR) weekUpdatedAtByWeek[wk] = Math.max(lTs ?? 0, rTs ?? 0);

    if (lv && rv) {
      if (tsEqual(lTs, rTs)) {
        weekOverridesByWeek[wk] = normalizeWeekOverrides({
          pinnedIds: [...lv.pinnedIds, ...rv.pinnedIds],
          excludedIds: [...lv.excludedIds, ...rv.excludedIds],
          blockedNights: [...lv.blockedNights, ...rv.blockedNights]
        });
      } else {
        weekOverridesByWeek[wk] = tsNewer(rTs, lTs) ? rv : lv;
      }
    } else if (lv && !rv) {
      // 对侧显式重置了该周且时间戳更新 → 尊重重置，不从本机复活
      if (!(hasExplicitR && tsNewer(rTs, lTs))) weekOverridesByWeek[wk] = lv;
    } else if (!lv && rv) {
      if (!(hasExplicitL && tsNewer(lTs, rTs))) weekOverridesByWeek[wk] = rv;
    }
  }
  const knownWeekTs = [
    local.weekOverridesUpdatedAt,
    remote.weekOverridesUpdatedAt,
    ...Object.values(weekUpdatedAtByWeek)
  ].filter(tsKnown);
  const weekOverridesUpdatedAt = knownWeekTs.length > 0 ? Math.max(...knownWeekTs) : null;

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
        ? clampTimestamp(Math.max(prev.watchedAt || 0, item.watchedAt || 0) || nowTs, nowTs)
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

  // 5. diary 按 updatedAt / deleted 墓碑取较新动作
  const diaryEntries = {};
  const diaryDeleted = {};
  const diaryIds = new Set([
    ...Object.keys(local.diary.entries),
    ...Object.keys(remote.diary.entries),
    ...Object.keys(local.diary.deleted || {}),
    ...Object.keys(remote.diary.deleted || {})
  ]);
  for (const matchId of diaryIds) {
    const lEntry = local.diary.entries[matchId];
    const rEntry = remote.diary.entries[matchId];
    const bestEntry =
      !lEntry
        ? rEntry
        : !rEntry
          ? lEntry
          : (rEntry.updatedAt || 0) > (lEntry.updatedAt || 0)
            ? rEntry
            : lEntry;
    const delTs = Math.max(local.diary.deleted?.[matchId] || 0, remote.diary.deleted?.[matchId] || 0);
    if (delTs > 0 && (!bestEntry || delTs >= (bestEntry.updatedAt || 0))) {
      diaryDeleted[matchId] = delTs;
    } else if (bestEntry) {
      diaryEntries[matchId] = bestEntry;
    }
  }
  const mergedDiary = normalizeDiary(
    {
      version: 1,
      entries: diaryEntries,
      ...(Object.keys(diaryDeleted).length > 0 ? { deleted: diaryDeleted } : {})
    },
    nowTs
  );

  return {
    version: SYNC_SCHEMA_VERSION,
    exportedAt: nowTs,
    prefsUpdatedAt,
    prefs,
    weekOverridesUpdatedAt,
    weekUpdatedAtByWeek,
    weekOverridesByWeek,
    watchLater: mergedWatchLater,
    revealedIds: mergedRevealed,
    diary: mergedDiary
  };
}
