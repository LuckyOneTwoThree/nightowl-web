/**
 * 桌面端偏好持久化（localStorage + 主题）
 *
 * 纯逻辑与默认值在 src/core/prefs.js（移动端共享）；这里只放浏览器 I/O，
 * 让 core 保持无 DOM / 无存储依赖，可在 Node 测试与移动端安全复用。
 */
import { defaultPrefs } from '../core/prefs.js';

const KEY = {
  teams: 'followedTeams',
  leagues: 'followedLeagues',
  budget: 'weeklyBudget',
  spoilerFree: 'spoilerFree',
  notify: 'notifyBefore15',
  liveNotify: 'notifyLiveEvents',
  sleepEnabled: 'sleepEnabled',
  sleepWakeTime: 'sleepWakeTime',
  sleepWeekendEnabled: 'sleepWeekendEnabled',
  sleepWeekendWakeTime: 'sleepWeekendWakeTime',
  sleepMinHours: 'sleepMinHours'
};

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
    notifyLiveEvents: readJSON(KEY.liveNotify, d.notifyLiveEvents) !== false,
    sleepEnabled: readJSON(KEY.sleepEnabled, d.sleepEnabled) === true,
    sleepWakeTime: readString(KEY.sleepWakeTime, d.sleepWakeTime),
    sleepWeekendEnabled: readJSON(KEY.sleepWeekendEnabled, d.sleepWeekendEnabled) !== false,
    sleepWeekendWakeTime: readString(KEY.sleepWeekendWakeTime, d.sleepWeekendWakeTime),
    sleepMinHours: readNumber(KEY.sleepMinHours, d.sleepMinHours)
  };
}

export function savePrefs(p) {
  try {
    localStorage.setItem(KEY.teams, JSON.stringify(p.followedTeams));
    localStorage.setItem(KEY.leagues, JSON.stringify(p.followedLeagues));
    localStorage.setItem(KEY.budget, String(p.weeklyBudget));
    localStorage.setItem(KEY.spoilerFree, JSON.stringify(p.spoilerFree));
    localStorage.setItem(KEY.notify, JSON.stringify(p.notifyBefore15));
    localStorage.setItem(KEY.liveNotify, JSON.stringify(p.notifyLiveEvents));
    localStorage.setItem(KEY.sleepEnabled, JSON.stringify(!!p.sleepEnabled));
    localStorage.setItem(KEY.sleepWakeTime, String(p.sleepWakeTime || '07:30'));
    localStorage.setItem(KEY.sleepWeekendEnabled, JSON.stringify(p.sleepWeekendEnabled !== false));
    localStorage.setItem(KEY.sleepWeekendWakeTime, String(p.sleepWeekendWakeTime || '09:00'));
    localStorage.setItem(KEY.sleepMinHours, String(Number.isFinite(p.sleepMinHours) ? p.sleepMinHours : 7));
  } catch {
    // 存储不可用时静默降级：本次会话仍可用，只是不持久化
  }
  applyTheme();
}