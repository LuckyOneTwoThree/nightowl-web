/**
 * 下半场切入策略与省睡试算（桌面 / 手机共用纯函数）
 *
 * 针对 00:00–05:30 跨夜凌晨场次：
 *   - 建议先入睡，于开球后 55 分钟（cutInAt 前 5 分钟）唤醒
 *   - 60' 切入下半场直播，省掉开球等待与上半场 55–60 分钟煎熬
 *   - 纯 ES2022 实现，零宿主依赖
 */

import { MATCH_DURATION_MS, owlDay, parseMin, ts } from './engine.js';
import { sleepLedger } from './sleep.js';

export const SECOND_HALF_OFFSET_MIN = 60;
export const WAKE_LEAD_MIN = 5;
export const SECOND_HALF_WINDOW_START_MIN = 0;
export const SECOND_HALF_WINDOW_END_MIN = 5 * 60 + 30;

const MIN_MS = 60000;
const HOUR_MS = 3600000;

/**
 * 判断场次是否属于凌晨下半场切入候选
 * @param {object|null|undefined} match
 * @returns {boolean}
 */
export function isLateNightCutInEligible(match) {
  if (!match || match.tbd || match.st !== 'sched') return false;
  const min = parseMin(match.t);
  if (!Number.isFinite(min)) return false;
  return min >= SECOND_HALF_WINDOW_START_MIN && min <= SECOND_HALF_WINDOW_END_MIN;
}

/**
 * 计算单场比赛的下半场切入与睡前连续可睡分钟数
 *
 * @param {object} match 比赛对象（需含 id, t, st, tbd）
 * @param {object} sleepProfile 用户作息配置
 * @param {number} [nowTs=Date.now()] 当前时间戳
 * @param {{bedtimeClock?: string, suggestedBedtimeTs?: number}} [options]
 */
export function planSecondHalfCutIn(match, sleepProfile, nowTs = Date.now(), options = {}) {
  if (!match || !match.id) {
    return { eligible: false, reason: 'invalid-match', matchId: null };
  }
  if (match.tbd) {
    return { eligible: false, reason: 'tbd', matchId: match.id };
  }
  if (match.st !== 'sched') {
    return { eligible: false, reason: 'not-scheduled', matchId: match.id };
  }

  const min = parseMin(match.t);
  const kickoffAt = ts(match.t);
  if (!Number.isFinite(min) || !Number.isFinite(kickoffAt)) {
    return { eligible: false, reason: 'invalid-time', matchId: match.id };
  }
  if (min < SECOND_HALF_WINDOW_START_MIN || min > SECOND_HALF_WINDOW_END_MIN) {
    return { eligible: false, reason: 'not-late-night', matchId: match.id };
  }

  const cutInAt = kickoffAt + SECOND_HALF_OFFSET_MIN * MIN_MS;
  const alarmAt = cutInAt - WAKE_LEAD_MIN * MIN_MS;
  const endAt = kickoffAt + MATCH_DURATION_MS;

  if (nowTs >= cutInAt) {
    return {
      eligible: false,
      reason: 'past-cutin',
      matchId: match.id,
      kickoffAt,
      cutInAt,
      alarmAt,
      endAt,
      preSleepMinutes: 0,
      postSleepMinutes: null,
      totalSplitSleepMinutes: 0,
      savedNightMinutes: 0,
      belowFloorAfterCutIn: null
    };
  }

  const night = owlDay(match.t);
  const bedtimeClock = options.bedtimeClock || '23:30';
  const defaultBedTs = night ? ts(`${night}T${bedtimeClock}`) : NaN;
  const rawBedTs = Number.isFinite(options.suggestedBedtimeTs) ? options.suggestedBedtimeTs : defaultBedTs;
  const suggestedBedtimeAt =
    Number.isFinite(rawBedTs) && rawBedTs < alarmAt ? rawBedTs : Math.max(nowTs, kickoffAt - 60 * MIN_MS);

  const sleepStartAt = Math.min(alarmAt, Math.max(nowTs, suggestedBedtimeAt));
  const preSleepMinutes = Math.max(0, Math.round((alarmAt - sleepStartAt) / MIN_MS));
  const savedNightMinutes = Math.max(0, Math.round((alarmAt - kickoffAt) / MIN_MS));

  const ledger = sleepLedger(match.t, sleepProfile);
  const postSleepMinutes =
    ledger.valid && ledger.ready ? Math.max(0, Math.round(ledger.remainingHours * 60)) : null;
  const totalSplitSleepMinutes =
    postSleepMinutes == null ? preSleepMinutes : preSleepMinutes + postSleepMinutes;
  const belowFloorAfterCutIn =
    ledger.valid && ledger.ready ? totalSplitSleepMinutes / 60 < ledger.profile.minSleep : null;

  return {
    eligible: true,
    reason: null,
    matchId: match.id,
    kickoffAt,
    cutInAt,
    alarmAt,
    endAt,
    suggestedBedtimeAt,
    sleepStartAt,
    preSleepMinutes,
    postSleepMinutes,
    totalSplitSleepMinutes,
    savedNightMinutes,
    belowFloorAfterCutIn,
    minSleepHours: ledger.valid && ledger.ready ? ledger.profile.minSleep : null,
    hoursUntilAlarm: Math.max(0, Math.round(((alarmAt - nowTs) / HOUR_MS) * 10) / 10)
  };
}
