/**
 * 用户偏好存储（localStorage）
 *
 * ⚠️ 铁律：**不得有任何形式的"全局兜底默认值"**
 *
 *   旧版小程序在 `evaluate()` 内用 `getApp()` 兜底，缺省时落成「六个联赛全选」。
 *   结果是铁律一（关注联赛 +8）**永远为 0**，且雷区预警的「非关注联赛」分支永不触发。
 *   本实现改为：偏好必须显式持有；首启给一个**有意义的小集合**（只关注英超），
 *   而不是"全选"——这样加成规则从第一次运行起就是活的。
 */

const KEY = {
  teams: 'followedTeams',
  leagues: 'followedLeagues',
  budget: 'weeklyBudget',
  spoilerFree: 'spoilerFree',
  notify: 'notifyBefore15',
  theme: 'theme'
};

/** 首启默认：只关注英超。刻意不设为"全部 6 个"，否则 +8 加成恒为 0 */
export const DEFAULT_FOLLOWED_LEAGUES = ['PL'];

export const DEFAULT_BUDGET_HOURS = 4.0;

export const DEFAULT_THEME = 'dark';

export const defaultPrefs = () => ({
  followedTeams: [],
  followedLeagues: [...DEFAULT_FOLLOWED_LEAGUES],
  weeklyBudget: DEFAULT_BUDGET_HOURS,
  spoilerFree: true,
  notifyBefore15: true,
  theme: DEFAULT_THEME
});

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function readNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  // ⚠️ 必须先判 null/空串：Number(null) === 0，而 0 是有限数，
  //    直接 Number.isFinite 会让 fallback 永远不生效 —— 默认周预算 4.0h 曾因此形同虚设，
  //    首启用户的「本周规划」在预算 0 下永远选不出场次。
  if (raw == null || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function readString(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v != null ? v : fallback;
  } catch {
    return fallback;
  }
}

export function applyTheme() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.add('dark');
  root.classList.remove('light');
  root.setAttribute('data-theme', 'dark');
}

export function loadPrefs() {
  const d = defaultPrefs();
  const leagues = readJSON(KEY.leagues, d.followedLeagues);

  // 始终锁定暗色夜间主题
  applyTheme();

  return {
    followedTeams: Array.isArray(readJSON(KEY.teams, d.followedTeams)) ? readJSON(KEY.teams, d.followedTeams) : d.followedTeams,
    // 空数组是合法状态（不关注任何联赛），但 null/非数组要兜回默认，避免算法拿到脏输入
    followedLeagues: Array.isArray(leagues) ? leagues : d.followedLeagues,
    weeklyBudget: readNumber(KEY.budget, d.weeklyBudget),
    spoilerFree: readJSON(KEY.spoilerFree, d.spoilerFree) !== false,
    notifyBefore15: readJSON(KEY.notify, d.notifyBefore15) !== false,
    theme: 'dark'
  };
}

export function savePrefs(p) {
  try {
    localStorage.setItem(KEY.teams, JSON.stringify(p.followedTeams));
    localStorage.setItem(KEY.leagues, JSON.stringify(p.followedLeagues));
    localStorage.setItem(KEY.budget, String(p.weeklyBudget));
    localStorage.setItem(KEY.spoilerFree, JSON.stringify(p.spoilerFree));
    localStorage.setItem(KEY.notify, JSON.stringify(p.notifyBefore15));
    localStorage.setItem(KEY.theme, 'dark');
  } catch {
    // 存储不可用时静默降级：本次会话仍可用，只是不持久化
  }
  applyTheme();
}

export function toggleIn(list, id) {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}
