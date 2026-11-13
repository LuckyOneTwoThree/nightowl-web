/**
 * 个人睡眠账本（桌面 / 手机共用纯函数）
 *
 * 产品口径：
 *   · 比赛结束 = 开球 + 120 分钟（沿用 products 里的估算，不引入外部时长数据）
 *   · 起床时间是用户自己的作息，不是设备本地时区
 *   · 只回答“看完还剩多少睡眠”，不改变推荐算法；是否进入排序由产品后续验证
 *
 * 时间口径：输入 matchTime 是北京墙钟（YYYY-MM-DDTHH:mm），wakeTime 是墙钟 HH:mm。
 * 内部用 epoch 计算，避免设备时区参与。
 */

import { MATCH_DURATION_MS, owlDay, ts } from './engine.js';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const BJ_OFFSET_MS = 8 * HOUR_MS;

export const SLEEP_DEFAULTS = Object.freeze({
  enabled: false,
  wakeTime: '07:30',
  weekendEnabled: false,
  weekendWakeTime: '09:00',
  minSleep: 7
});

export const SLEEP_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  OVER: 'over',
  OK: 'ok',
  SLIGHT: 'slight',
  DEEP: 'deep'
});

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function bjParts(ms) {
  const d = new Date(ms + BJ_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes()
  };
}

function bjDate(ms) {
  const p = bjParts(ms);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** "07:30" → 450；非法输入返回 null */
export function parseClockTime(value) {
  const text = String(value ?? '').trim();
  const m = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

function normalizeMinSleep(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 12) return null;
  return Math.round(n * 10) / 10;
}

function formatClockMinutes(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/**
 * 判断所属比赛夜（YYYY-MM-DD）的次日晨是否为周末/休息日：
 * 周五夜（UTCDay=5 → 周六晨）与周六夜（UTCDay=6 → 周日晨）。
 */
export function isWeekendNight(nightStr) {
  const m = String(nightStr ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return day === 5 || day === 6;
}

/** 把任意输入收敛成可计算档案；invalid 时不显示推算值 */
export function normalizeSleepProfile(profile = {}) {
  const enabled = profile?.enabled === true;
  const rawWake = typeof profile?.wakeTime === 'string' ? profile.wakeTime.trim() : '';
  const suppliedWake = rawWake !== '';
  const weekendEnabled = Boolean(profile?.weekendEnabled ?? SLEEP_DEFAULTS.weekendEnabled);
  const rawWeekendWake = typeof profile?.weekendWakeTime === 'string' ? profile.weekendWakeTime.trim() : '';
  const suppliedWeekendWake = rawWeekendWake !== '';
  const suppliedMin = profile?.minSleep != null;
  const minutes = suppliedWake ? parseClockTime(rawWake) : parseClockTime(SLEEP_DEFAULTS.wakeTime);
  const weekendMinutes = suppliedWeekendWake
    ? parseClockTime(rawWeekendWake)
    : parseClockTime(SLEEP_DEFAULTS.weekendWakeTime);
  const minSleep = suppliedMin ? normalizeMinSleep(profile.minSleep) : SLEEP_DEFAULTS.minSleep;
  const valid =
    (!suppliedWake || minutes != null) &&
    (!suppliedWeekendWake || weekendMinutes != null) &&
    (!suppliedMin || minSleep != null);
  const resolvedMinutes = minutes ?? parseClockTime(SLEEP_DEFAULTS.wakeTime);
  const resolvedWeekendMinutes = weekendMinutes ?? parseClockTime(SLEEP_DEFAULTS.weekendWakeTime);
  return {
    enabled,
    wakeTime: formatClockMinutes(resolvedMinutes),
    wakeMinutes: resolvedMinutes,
    weekendEnabled,
    weekendWakeTime: formatClockMinutes(resolvedWeekendMinutes),
    weekendWakeMinutes: resolvedWeekendMinutes,
    minSleep: minSleep ?? SLEEP_DEFAULTS.minSleep,
    valid
  };
}

/** 根据所属夜（owlDay）解析当夜生效的起床时间（工作日 vs 周末） */
export function resolveWakeTimeForNight(nightStr, profile) {
  const p = normalizeSleepProfile(profile);
  const isWeekend = Boolean(p.weekendEnabled && isWeekendNight(nightStr));
  return {
    wakeTime: isWeekend ? p.weekendWakeTime : p.wakeTime,
    wakeMinutes: isWeekend ? p.weekendWakeMinutes : p.wakeMinutes,
    isWeekend
  };
}

export function isSleepProfileReady(profile) {
  const p = normalizeSleepProfile(profile);
  return p.enabled && p.valid;
}

function profileFrom(profile) {
  const p = normalizeSleepProfile(profile);
  return p;
}

/**
 * 计算一场比赛看完后的个人睡眠。
 *
 * @param {string} matchTime 北京墙钟 YYYY-MM-DDTHH:mm
 * @param {{enabled?: boolean, wakeTime?: string, weekendEnabled?: boolean, weekendWakeTime?: string, minSleep?: number}} profile
 * @param {{durationMs?: number}} [options]
 */
export function sleepLedger(matchTime, profile, options = {}) {
  const p = profileFrom(profile);
  if (!p.valid) {
    return { valid: false, ready: false, reason: 'invalid-profile', profile: p };
  }

  const kickoffTs = ts(matchTime);
  if (!Number.isFinite(kickoffTs)) {
    return { valid: false, ready: false, reason: 'invalid-match-time', profile: p };
  }

  const nightDate = owlDay(matchTime);
  const resolved = resolveWakeTimeForNight(nightDate, p);
  const effectiveWakeTime = resolved.wakeTime;

  const durationMs =
    Number.isFinite(options.durationMs) && options.durationMs > 0
      ? options.durationMs
      : MATCH_DURATION_MS;
  const endTs = kickoffTs + durationMs;
  let wakeTs = ts(`${bjDate(endTs)}T${effectiveWakeTime}`);
  let overWake = false;

  if (!Number.isFinite(wakeTs)) {
    return { valid: false, ready: false, reason: 'invalid-wake-time', profile: p };
  }

  if (wakeTs <= endTs) {
    const endHour = bjParts(endTs).hh;
    // 晚间比赛可能在次日凌晨结束；若结束时刻在中午之前且已越过起床点，
    // 用户已经睡不成一个完整夜晚，只如实显示“直接到起床点”。
    if (endHour >= 12) wakeTs += DAY_MS;
    else overWake = true;
  }

  const remainingMs = overWake ? 0 : Math.max(0, wakeTs - endTs);
  const remainingHours = remainingMs / HOUR_MS;
  const gapHours = Math.max(0, p.minSleep - remainingHours);
  const status = overWake
    ? SLEEP_STATUS.OVER
    : gapHours <= 0
      ? SLEEP_STATUS.OK
      : gapHours <= 1.5
        ? SLEEP_STATUS.SLIGHT
        : SLEEP_STATUS.DEEP;

  return {
    valid: true,
    ready: p.enabled,
    reason: null,
    profile: p,
    nightDate,
    isWeekendNight: resolved.isWeekend,
    kickoffTs,
    endTs,
    wakeTs,
    endDate: bjDate(endTs),
    wakeDate: bjDate(wakeTs),
    endClock: `${pad2(bjParts(endTs).hh)}:${pad2(bjParts(endTs).mm)}`,
    wakeClock: effectiveWakeTime,
    wakeTime: effectiveWakeTime,
    remainingHours: Math.round(remainingHours * 100) / 100,
    gapHours: Math.round(gapHours * 100) / 100,
    belowFloor: gapHours > 0,
    overWake,
    status
  };
}

/** 止损点 = 起床 − 最低睡眠 − 入睡缓冲；未启用/无效返回 null */
export function stopLossAt(matchTime, profile, options = {}) {
  const ledger = sleepLedger(matchTime, profile, options);
  if (!ledger.valid || !ledger.ready) return null;
  const bufferMinutes = Number.isFinite(options.bufferMinutes)
    ? Math.max(0, options.bufferMinutes)
    : 30;
  return {
    ...ledger,
    stopAt:
      ledger.wakeTs -
      ledger.profile.minSleep * HOUR_MS -
      bufferMinutes * 60000
  };
}

/** 供 UI 使用：把剩余睡眠截断成一位小数，不制造虚假精度 */
export function formatSleepHours(hours) {
  if (!Number.isFinite(hours)) return '—';
  const text = Math.max(0, hours).toFixed(1);
  return `${text.endsWith('.0') ? text.slice(0, -2) : text}h`;
}
