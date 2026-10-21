/**
 * 实时/赛后事件展示口径
 *
 * 服务端只给结构化事件（type/text/side），中文标签与摘要在这里统一，
 * 实时面板、赛后回顾、通知文案共用同一份，避免三处各写一套。
 */

import { teamName } from '../data/index.js';

export const EVENT_LABEL = {
  goal: '进球',
  own: '乌龙',
  red: '红牌',
  yellow: '黄牌',
  penalty: '点球',
  var: 'VAR'
};

export const EVENT_TONE = {
  goal: 'accent',
  own: 'danger',
  red: 'danger',
  yellow: 'warn',
  penalty: 'neutral',
  var: 'neutral'
};

/** 事件摘要（中文）；完整英文原文仍由调用方放在 title 里 */
export function eventSummary(ev, match) {
  if (!ev) return '事件';
  const team = ev.side === 'h' ? teamName(match.h) : ev.side === 'a' ? teamName(match.a) : '';
  const label = EVENT_LABEL[ev.type] || '事件';
  if (!team) return label;
  if (ev.type === 'goal') return `${team}进球`;
  if (ev.type === 'own') return `${team}乌龙`;
  if (ev.type === 'red') return `${team}红牌`;
  if (ev.type === 'yellow') return `${team}黄牌`;
  if (ev.type === 'var') return `VAR · ${team}`;
  return `${team}${label}`;
}

/** 轮询去重键：同一事件在多次响应里必须稳定 */
export function eventKey(ev) {
  return `${ev?.clock || ''}|${ev?.type || ''}|${ev?.text || ''}`;
}

/** 值得系统通知的事件：进球/乌龙/红牌/点球；黄牌和 VAR 太吵，不进通知 */
export function shouldNotifyEvent(ev) {
  return ['goal', 'own', 'red', 'penalty'].includes(ev?.type);
}
