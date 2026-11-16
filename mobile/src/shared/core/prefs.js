/**
 * 用户偏好默认值与纯逻辑（无 I/O）
 *
 * 桌面端的 localStorage 读写 / 主题应用见 src/lib/prefs-storage.js；
 * 移动端用 AsyncStorage + zustand 持久化（mobile/src/state/prefs.ts），
 * 但默认值统一从这里取，避免两端各写一份导致口径漂移。
 *
 * ⚠️ 铁律：**不得有任何形式的"全局兜底默认值"**
 *
 *   旧版小程序在 `evaluate()` 内用 `getApp()` 兜底，缺省时落成「六个联赛全选」。
 *   结果是铁律一（关注联赛 +8）**永远为 0**，且雷区预警的「非关注联赛」分支永不触发。
 *   本实现改为：偏好必须显式持有；首启给一个**有意义的小集合**（只关注英超），
 *   而不是"全选"——这样加成规则从第一次运行起就是活的。
 */

/** 首启默认：只关注英超。刻意不设为"全部 6 个"，否则 +8 加成恒为 0 */
export const DEFAULT_FOLLOWED_LEAGUES = ['PL'];

export const DEFAULT_BUDGET_HOURS = 4.0;

export const PREF_BOUNDS = Object.freeze({
  weeklyBudgetMin: 0,
  weeklyBudgetMax: 8,
  sleepMinHoursMin: 4,
  sleepMinHoursMax: 10
});

const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeHHMM(value) {
  return typeof value === 'string' && TIME_HHMM_RE.test(value);
}

function normalizeIdList(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export const defaultPrefs = () => ({
  /** @type {string[]} */
  followedTeams: [],
  /** @type {string[]} */
  followedLeagues: [...DEFAULT_FOLLOWED_LEAGUES],
  weeklyBudget: DEFAULT_BUDGET_HOURS,
  spoilerFree: true,
  notifyBefore15: true,
  notifyLiveEvents: true,
  sleepEnabled: false,
  sleepWakeTime: '07:30',
  sleepWeekendEnabled: true,
  sleepWeekendWakeTime: '09:00',
  sleepMinHours: 7
});

/**
 * 仅提取「显式给出且合法」的偏好补丁字段，拒绝字符串/NaN/越界数值，
 * 同时不把未传字段悄然填成默认值（防止部分同步包用默认值覆盖对端配置）。
 */
export function extractValidPrefPatch(rawPrefs, { clamp = false } = {}) {
  const patch = {};
  if (!rawPrefs || typeof rawPrefs !== 'object' || Array.isArray(rawPrefs)) return patch;

  if ('followedTeams' in rawPrefs) {
    const teams = normalizeIdList(rawPrefs.followedTeams);
    if (teams !== null) patch.followedTeams = teams;
  }
  if ('followedLeagues' in rawPrefs) {
    const leagues = normalizeIdList(rawPrefs.followedLeagues);
    if (leagues !== null) patch.followedLeagues = leagues;
  }
  if ('weeklyBudget' in rawPrefs && typeof rawPrefs.weeklyBudget === 'number' && Number.isFinite(rawPrefs.weeklyBudget)) {
    const v = rawPrefs.weeklyBudget;
    if (clamp || (v >= PREF_BOUNDS.weeklyBudgetMin && v <= PREF_BOUNDS.weeklyBudgetMax)) {
      const clamped = Math.max(PREF_BOUNDS.weeklyBudgetMin, Math.min(PREF_BOUNDS.weeklyBudgetMax, v));
      patch.weeklyBudget = Math.round(clamped * 2) / 2;
    }
  }
  if ('sleepMinHours' in rawPrefs && typeof rawPrefs.sleepMinHours === 'number' && Number.isFinite(rawPrefs.sleepMinHours)) {
    const v = rawPrefs.sleepMinHours;
    if (clamp || (v >= PREF_BOUNDS.sleepMinHoursMin && v <= PREF_BOUNDS.sleepMinHoursMax)) {
      const clamped = Math.max(PREF_BOUNDS.sleepMinHoursMin, Math.min(PREF_BOUNDS.sleepMinHoursMax, v));
      patch.sleepMinHours = Math.round(clamped * 2) / 2;
    }
  }
  for (const boolKey of ['spoilerFree', 'notifyBefore15', 'notifyLiveEvents', 'sleepEnabled', 'sleepWeekendEnabled']) {
    if (boolKey in rawPrefs && typeof rawPrefs[boolKey] === 'boolean') {
      patch[boolKey] = rawPrefs[boolKey];
    }
  }
  if ('sleepWakeTime' in rawPrefs && isValidTimeHHMM(rawPrefs.sleepWakeTime)) {
    patch.sleepWakeTime = rawPrefs.sleepWakeTime;
  }
  if ('sleepWeekendWakeTime' in rawPrefs && isValidTimeHHMM(rawPrefs.sleepWeekendWakeTime)) {
    patch.sleepWeekendWakeTime = rawPrefs.sleepWeekendWakeTime;
  }
  return patch;
}

/**
 * 将任意原始偏好对象规范化为完整、安全的 11 项偏好结构
 * @param {Record<string, any>} [rawPrefs]
 * @param {Record<string, any>} [basePrefs]
 */
export function normalizePrefs(rawPrefs, basePrefs = defaultPrefs()) {
  const safeBase = {
    ...defaultPrefs(),
    ...extractValidPrefPatch(basePrefs, { clamp: true })
  };
  const validPatch = extractValidPrefPatch(rawPrefs, { clamp: true });
  const merged = { ...safeBase, ...validPatch };
  merged.followedTeams = [...merged.followedTeams];
  merged.followedLeagues = [...merged.followedLeagues];
  return merged;
}

export function toggleIn(list, id) {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}
