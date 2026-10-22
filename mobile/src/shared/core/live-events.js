/**
 * 实时/赛后事件展示口径
 *
 * 服务端只给结构化事件（type/typeText/clock/side）；中文标签与摘要在这里统一，
 * 实时面板、赛后回顾、通知文案共用同一份，避免三处各写一套。
 * 原始英文 text 仅保留在数据层，不作为界面文案。
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

/** ESPN 的自由文本不翻译；只从结构化 typeText 提取可核实的中文细节 */
const GOAL_DETAILS = [
  [/header/, '头球'],
  [/left[- ]footed|left foot/, '左脚'],
  [/right[- ]footed|right foot/, '右脚'],
  [/volley/, '凌空'],
  [/free[- ]kick/, '任意球'],
  [/penalty/, '点球']
];

function eventDetail(ev) {
  const typeText = String(ev?.typeText || '').toLowerCase();
  if (!typeText) return '';
  if (ev.type === 'penalty' && /miss/.test(typeText)) return '未进';
  if (ev.type === 'goal') {
    const hit = GOAL_DETAILS.find(([re]) => re.test(typeText));
    return hit ? hit[1] : '';
  }
  return '';
}

/** 事件摘要（中文）；英文原文不直接展示，细节只从结构化 typeText 提取 */
export function eventSummary(ev, match) {
  if (!ev) return '事件';
  const team = ev.side === 'h' ? teamName(match.h) : ev.side === 'a' ? teamName(match.a) : '';
  const label = EVENT_LABEL[ev.type] || '事件';
  if (!team) return label;
  const detail = eventDetail(ev);
  if (ev.type === 'goal') return detail ? `${team}进球 · ${detail}` : `${team}进球`;
  if (ev.type === 'own') return `${team}乌龙`;
  if (ev.type === 'red') {
    return ev.typeText && /second/i.test(ev.typeText) ? `${team}两黄变红` : `${team}红牌`;
  }
  if (ev.type === 'yellow') {
    return ev.typeText && /second/i.test(ev.typeText) ? `${team}第二张黄牌` : `${team}黄牌`;
  }
  if (ev.type === 'penalty') return detail === '未进' ? `${team}点球未进` : `${team}点球`;
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
