/**
 * 通知文案与时机（纯函数）
 *
 * 系统通知本身由 Electron 主进程弹出；这里只负责：
 *   · 赛前 15 分钟窗口判断
 *   · 文案（中文队名 / 联赛 / 比分）
 *
 * 放在 core 是为了可离线回归；组件只负责“什么时候调用”。
 */

import { teamName, leagueName } from '../data/index.js';
import { hm } from './format.js';
import { ts } from './engine.js';
import { EVENT_LABEL, eventSummary } from './live-events.js';

export const PREMATCH_WINDOW_MS = 15 * 60 * 1000;

/** 是否进入赛前提醒窗口：未开赛、时间可信、距开球 0–15 分钟 */
export function isPrematchDue(match, nowTs, windowMs = PREMATCH_WINDOW_MS) {
  if (!match || match.st !== 'sched' || match.tbd) return false;
  const kick = ts(match.t);
  if (!Number.isFinite(kick)) return false;
  const diff = kick - nowTs;
  return diff >= 0 && diff <= windowMs;
}

export function prematchNotification(match, { isHero = false } = {}) {
  const title = `${isHero ? '今晚之选即将开球' : '即将开球'} · ${teamName(match.h)} vs ${teamName(match.a)}`;
  const round = match.r ? ` 第 ${match.r} 轮` : '';
  return {
    title,
    body: `${hm(match.t)} · ${leagueName(match.l)}${round}`
  };
}

export function liveEventNotification(match, liveData, ev) {
  const label = EVENT_LABEL[ev?.type] || '事件';
  const h = liveData?.score?.h ?? '—';
  const a = liveData?.score?.a ?? '—';
  return {
    title: `${label} · ${teamName(match.h)} ${h}-${a} ${teamName(match.a)}`,
    body: `${ev?.clock || ''} ${eventSummary(ev, match)}`.trim() || label
  };
}

export function fullTimeNotification(match, liveData) {
  const h = liveData?.score?.h ?? '—';
  const a = liveData?.score?.a ?? '—';
  return {
    title: `终场 · ${teamName(match.h)} ${h}-${a} ${teamName(match.a)}`,
    body: '比赛已结束，点击查看赛后回顾与集锦'
  };
}
