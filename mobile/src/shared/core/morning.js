/**
 * 早晨补看摘要 · 桌面 / 手机共用选择逻辑
 *
 * 只选择「昨晚加入补看队列、仍未看」的比赛；不把关注球队的所有赛果自动塞入。
 * 窗口为起床时间 → 23:00（北京时间）；manual=true 时忽略窗口，仍保证只取昨晚队列。
 */

import { nightOf } from './engine.js';
import { parseClockTime } from './sleep.js';
import { queueWithMatches } from './queue.js';

const DAY_MS = 86400000;

function beijingMinutes(now) {
  const d = new Date(Number(now) + 8 * 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function isMorningDigestWindow(now, wakeTime) {
  const wake = parseClockTime(wakeTime);
  if (wake == null) return false;
  const mins = beijingMinutes(now);
  return mins >= wake && mins < 23 * 60;
}

/** 早晨看到的「昨晚」；07:30 打开时是前一个夜猫日 */
export function morningDigestNight(now) {
  // 凌晨 00:00–06:00 仍属于「当前夜猫日」；其余时间才是前一个夜猫日。
  const d = new Date(Number(now) + 8 * 3600000);
  const hours = d.getUTCHours();
  return hours < 6 ? nightOf(now) : nightOf(Number(now) - DAY_MS);
}

export function getMorningDigest(queue, fixtures, now, wakeTime, options = {}) {
  const force = options.force === true;
  const night = morningDigestNight(now);
  if (!force && !isMorningDigestWindow(now, wakeTime)) {
    return { night, items: [], canShow: false };
  }
  const items = queueWithMatches(queue, fixtures, now).filter(e => e.item.night === night);
  return { night, items, canShow: items.length > 0 };
}
