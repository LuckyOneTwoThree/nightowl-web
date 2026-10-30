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

import { MATCH_DURATION_MS, ts } from './engine.js';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const BJ_OFFSET_MS = 8 * HOUR_MS;

export const SLEEP_DEFAULTS = Object.freeze({
  enabled: false,
  wakeTime: '07:30',
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

/** 把任意输入收敛成可计算档案；invalid 时不显示推算值 */
export function normalizeSleepProfile(profile = {}) {
  const enabled = profile?.enabled === true;
  const rawWake = typeof profile?.wakeTime === 'string' ? profile.wakeTime.trim() : '';
  const suppliedWake = rawWake !== '';
  const suppliedMin = profile?.minSleep != null;
  const minutes = suppliedWake ? parseClockTime(rawWake) : parseClockTime(SLEEP_DEFAULTS.wakeTime);
  const minSleep = suppliedMin ? normalizeMinSleep(profile.minSleep) : SLEEP_DEFAULTS.minSleep;
  const valid = (!suppliedWake || minutes != null) && (!suppliedMin || minSleep != null);
  const resolvedMinutes = minutes ?? parseClockTime(SLEEP_DEFAULTS.wakeTime);
  return {
    enabled,
    wakeTime: `${pad2(Math.floor(resolvedMinutes / 60))}:${pad2(resolvedMinutes % 60)}`,
    minSleep: minSleep ?? SLEEP_DEFAULTS.minSleep,
    valid
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
 * @param {{enabled?: boolean, wakeTime?: string, minSleep?: number}} profile
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

  const durationMs =
    Number.isFinite(options.durationMs) && options.durationMs > 0
      ? options.durationMs
      : MATCH_DURATION_MS;
  const endTs = kickoffTs + durationMs;
  const wakeMinutes = parseClockTime(p.wakeTime);
  let wakeTs = ts(`${bjDate(endTs)}T${p.wakeTime}`);
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
    kickoffTs,
    endTs,
    wakeTs,
    endDate: bjDate(endTs),
    wakeDate: bjDate(wakeTs),
    endClock: `${pad2(bjParts(endTs).hh)}:${pad2(bjParts(endTs).mm)}`,
    wakeClock: p.wakeTime,
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
