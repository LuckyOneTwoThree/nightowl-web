/**
 * 无剧透「悬念唤醒雷达」纯函数评判器（桌面端受控轮询使用）
 *
 * 严格约束：
 *   1. 返回 DTO 严禁出现 score / goals / redCount / leadingSide / 球员名；
 *   2. 仅保留枚举结论 verdict 与当前分钟刻度 minuteLabel；
 *   3. 每晚本地最多盯盘 RADAR_MAX_WATCHED (2) 场，仅在 [55', 70'] 窗内判定。
 */

import { ts } from './engine.js';

export const RADAR_MAX_WATCHED = 2;
export const RADAR_WINDOW_START_MIN = 55;
export const RADAR_WINDOW_END_MIN = 70;

export const RADAR_VERDICT = Object.freeze({
  WORTH_WAKING: 'WORTH_WAKING',
  DULL_DRAW: 'DULL_DRAW',
  GARBAGE_TIME: 'GARBAGE_TIME',
  UNAVAILABLE: 'UNAVAILABLE'
});

export const RADAR_VERDICT_META = Object.freeze({
  [RADAR_VERDICT.WORTH_WAKING]: {
    label: '悬念犹存 · 值得切入',
    shortLabel: '值得切入',
    notifyTitle: '悬念雷达：值得醒来切入下半场',
    notifyBody: '当前胶着或具备看点，不剧透比分，可直接进场看末段。',
    tone: 'gold'
  },
  [RADAR_VERDICT.DULL_DRAW]: {
    label: '目前胶着平局 · 可继续补觉',
    shortLabel: '偏闷平可继续睡',
    notifyTitle: '悬念雷达：暂无破局动作，继续放心睡',
    notifyBody: '暂未出现高波动事件，建议把睡眠留给明早复盘。',
    tone: 'muted'
  },
  [RADAR_VERDICT.GARBAGE_TIME]: {
    label: '分差较大 · 不建议打断睡眠',
    shortLabel: '分差拉开建议续睡',
    notifyTitle: '悬念雷达：悬念基本终结，安心继续睡',
    notifyBody: '场势已拉开，明早再通过无剧透心电图复盘即可。',
    tone: 'teal'
  },
  [RADAR_VERDICT.UNAVAILABLE]: {
    label: '暂无实时比赛状态',
    shortLabel: '状态待确认',
    notifyTitle: '悬念雷达：暂未获取到实时状态',
    notifyBody: '已自动降级停止唤醒，避免在无数据时打断睡眠。',
    tone: 'muted'
  }
});

/**
 * 当前时刻是否处于 [kickoff + 55min, kickoff + 70min] 雷达有效窗口
 */
export function isRadarWindowActive(match, nowTs = Date.now()) {
  if (!match || match.tbd) return false;
  const k = ts(match.t);
  if (!Number.isFinite(k)) return false;
  const start = k + RADAR_WINDOW_START_MIN * 60000;
  const end = k + RADAR_WINDOW_END_MIN * 60000;
  return nowTs >= start && nowTs <= end;
}

/**
 * 是否已超出 70 分钟窗口（触发自动停止轮询）
 */
export function isRadarWindowExpired(match, nowTs = Date.now()) {
  if (!match || match.tbd) return false;
  const k = ts(match.t);
  if (!Number.isFinite(k)) return true;
  return nowTs > k + RADAR_WINDOW_END_MIN * 60000;
}

function hasKeyIncident(events) {
  if (!Array.isArray(events)) return false;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const t = String(e.type || '').toLowerCase();
    const d = String(e.detail || '').toLowerCase();
    if (
      t === 'red' ||
      t === 'yellowred' ||
      t === 'pen' ||
      t === 'penalty' ||
      d.includes('red card') ||
      d.includes('penalty')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 纯函数悬念评判器：绝对不返回比分、进球队或红牌数。
 *
 * @param {object} match 比赛对象
 * @param {object|null|undefined} liveSnapshot server/live.js 快照或等价结构
 * @param {{isDerby?: boolean, isFollowed?: boolean, star?: number, hasRedOrPen?: boolean}} [context]
 * @returns {{matchId: string|null, verdict: string, minuteLabel: string|null}}
 */
export function evaluateRadarSuspense(match, liveSnapshot, context = {}) {
  const matchId = match?.id || null;
  const minuteLabel = typeof liveSnapshot?.minute === 'string' && liveSnapshot.minute.trim() ? liveSnapshot.minute.trim() : null;

  if (
    !matchId ||
    !liveSnapshot ||
    liveSnapshot.state === 'scheduled' ||
    liveSnapshot.score?.h == null ||
    liveSnapshot.score?.a == null
  ) {
    return {
      matchId,
      verdict: RADAR_VERDICT.UNAVAILABLE,
      minuteLabel
    };
  }

  const h = Number(liveSnapshot.score.h);
  const a = Number(liveSnapshot.score.a);
  if (!Number.isFinite(h) || !Number.isFinite(a)) {
    return {
      matchId,
      verdict: RADAR_VERDICT.UNAVAILABLE,
      minuteLabel
    };
  }

  const diff = Math.abs(h - a);
  const totalGoals = h + a;
  const hasRedOrPen = Boolean(context.hasRedOrPen) || hasKeyIncident(liveSnapshot.events);
  const isTopClash = Boolean(context.isDerby || context.isFollowed || Number(context.star) >= 2);

  let verdict = RADAR_VERDICT.WORTH_WAKING;
  if (diff >= 3) {
    verdict = RADAR_VERDICT.GARBAGE_TIME;
  } else if (diff <= 1 && (totalGoals >= 1 || hasRedOrPen || isTopClash)) {
    verdict = RADAR_VERDICT.WORTH_WAKING;
  } else if (totalGoals === 0 && !hasRedOrPen && !isTopClash) {
    verdict = RADAR_VERDICT.DULL_DRAW;
  }

  return {
    matchId,
    verdict,
    minuteLabel
  };
}
