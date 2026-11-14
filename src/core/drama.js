/**
 * 无剧透剧情心电图（Drama Meter）· 桌面 / 手机共用纯函数
 *
 * 定位：
 *   在防剧透开启且比分未揭晓时，基于本地完赛比分与 ESPN keyEvents 提炼
 *   「零比分、零胜负、零队名/主客归属」的客观剧情标签与时间轴脉冲点，
 *   帮助用户在早间补看或完赛列表中 3 秒分辨「值得找集锦的名局」与「平淡场次」。
 *
 * 铁律：
 *   · 纯 ES2022，禁止 Node/DOM 专属 API，保证 sync:shared 后双端零差异运行
 *   · 返回体经过字段白名单构造，绝对不包含 score、h、a、side、winner 等可反推结果字段
 *   · summary 事件缺失时诚实降级，绝不猜测反转/绝杀或伪造脉冲点
 */

import { isFinished } from './engine.js';

export const DRAMA_TAGS = Object.freeze({
  LATE_DRAMA: { id: 'late-drama', label: '终场悬念 🎭', tone: 'accent', priority: 100 },
  COMEBACK: { id: 'comeback', label: '剧本反转 🔄', tone: 'accent', priority: 90 },
  SEESAW: { id: 'seesaw', label: '绝平拉锯 ⚖️', tone: 'accent', priority: 80 },
  GOAL_FEST: { id: 'goal-fest', label: '进球大战 ⚡', tone: 'accent', priority: 70 },
  CARDS_PENALTY: { id: 'cards-penalty', label: '红点名场面 🟥', tone: 'warn', priority: 60 },
  GOALLESS: { id: 'goalless', label: '颗粒无收 💤', tone: 'neutral', priority: 10 }
});

const HIGH_ENERGY_EVENT_TYPES = new Set(['goal', 'own', 'red', 'penalty']);
const MAX_TAGS = 2;

function parseFinalScore(sc) {
  if (typeof sc !== 'string') return null;
  const matched = sc.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!matched) return null;
  return { h: Number(matched[1]), a: Number(matched[2]) };
}

/**
 * 解析 ESPN 比赛时钟，如 "90+4'" → { base: 90, added: 4, minute: 94 }
 * 返回 null 表示无法解析。
 */
export function parseClockMinute(clock) {
  const raw = String(clock ?? '').trim();
  if (!raw) return null;
  const matched = raw.match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (!matched) return null;
  const base = Number(matched[1]);
  const added = matched[2] ? Number(matched[2]) : 0;
  if (!Number.isFinite(base) || base < 0) return null;
  const minute = Math.max(0, Math.min(105, base + (Number.isFinite(added) ? added : 0)));
  return { base, added, minute };
}

function isLateDramaClock(parsedClock) {
  if (!parsedClock) return false;
  // 排除上半场伤停补时（例如 "45+3'" 解析为 minute=48），只认下半场尾声 85'+
  return parsedClock.base >= 85;
}

function signOf(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/**
 * 重放进球事件轨迹，验证是否与终场分差一致（防止个别上游乌龙球归属反转产生假反转）。
 * 仅在内部运行，不暴露任何队属或分数细节。
 */
function analyzeTimeline(normalizedEvents, finalScore) {
  let tempH = 0;
  let tempA = 0;
  let prevNonZeroSign = 0;
  let hasComeback = false;
  let equalizedCount = 0;
  let hasLateGoal = false;
  let hasRedOrPenalty = false;
  let goalEventsCount = 0;
  let sidedGoalCount = 0;

  for (const item of normalizedEvents) {
    if (item.type === 'red' || item.type === 'penalty') {
      hasRedOrPenalty = true;
    }
    if (item.type === 'goal' || item.type === 'own') {
      goalEventsCount += 1;
      if (isLateDramaClock(item.clock)) {
        hasLateGoal = true;
      }
      if (item.side === 'h' || item.side === 'a') {
        sidedGoalCount += 1;
        if (item.side === 'h') tempH += 1;
        else tempA += 1;

        const diff = tempH - tempA;
        if (diff === 0) {
          equalizedCount += 1;
        } else {
          const s = signOf(diff);
          if (prevNonZeroSign !== 0 && s !== prevNonZeroSign) {
            hasComeback = true;
          }
          prevNonZeroSign = s;
        }
      }
    }
  }

  // 事件明细齐备且总进球及最终分差均自洽时，才认定轨迹分析完全可信
  const totalFromScore = finalScore ? finalScore.h + finalScore.a : null;
  const finalDiffFromScore = finalScore ? finalScore.h - finalScore.a : null;
  const consistent =
    sidedGoalCount > 0 &&
    sidedGoalCount === goalEventsCount &&
    (totalFromScore == null ||
      (tempH + tempA === totalFromScore && tempH - tempA === finalDiffFromScore));

  return {
    hasComeback: consistent && hasComeback,
    isSeeSaw: consistent && equalizedCount >= 2,
    hasLateGoal,
    hasRedOrPenalty,
    consistent
  };
}

/**
 * 计算单场完赛比赛的无剧透剧情摘要。
 *
 * @param {object} match 赛程对象
 * @param {Array|null} [recapEvents] ESPN keyEvents 数组（可为 null / []）
 */
export function summarizeDrama(match, recapEvents = null) {
  const finished = isFinished(match) || match?.state === 'finished';
  const finalScore = parseFinalScore(match?.sc);
  const rawEvents = Array.isArray(recapEvents) ? recapEvents : [];

  if (!finished && rawEvents.length === 0) {
    return {
      available: false,
      hasEvents: false,
      tags: [],
      pulseMinutes: [],
      degradedReason: 'not-finished'
    };
  }

  const normalized = [];
  const pulseSet = new Set();

  for (const ev of rawEvents) {
    if (!ev || !HIGH_ENERGY_EVENT_TYPES.has(ev.type)) continue;
    const clock = parseClockMinute(ev.clock);
    if (clock) pulseSet.add(clock.minute);
    normalized.push({
      type: ev.type,
      side: ev.side === 'h' || ev.side === 'a' ? ev.side : null,
      clock,
      order: clock ? clock.minute : 999
    });
  }

  normalized.sort((a, b) => a.order - b.order);
  const goalEventsCount = normalized.filter(e => e.type === 'goal' || e.type === 'own').length;
  // 若已有非零终场比分，但上游 summary 未包含任何进球事件，说明关键时间轴残缺，不可伪造反转/脉搏
  const hasEvents =
    rawEvents.length > 0 && (!finalScore || finalScore.h + finalScore.a === 0 || goalEventsCount > 0);

  if (!finalScore && !hasEvents) {
    return {
      available: false,
      hasEvents: false,
      tags: [],
      pulseMinutes: [],
      degradedReason: 'no-events'
    };
  }

  const totalGoals = finalScore
    ? finalScore.h + finalScore.a
    : normalized.filter(e => e.type === 'goal' || e.type === 'own').length;
  const finalDiff = finalScore ? Math.abs(finalScore.h - finalScore.a) : null;

  const timeline = hasEvents
    ? analyzeTimeline(normalized, finalScore)
    : { hasComeback: false, isSeeSaw: false, hasLateGoal: false, hasRedOrPenalty: false };

  const picked = [];
  if (hasEvents && timeline.hasLateGoal && finalDiff != null && finalDiff <= 1 && totalGoals >= 1) {
    picked.push(DRAMA_TAGS.LATE_DRAMA);
  }
  if (hasEvents && timeline.hasComeback) {
    picked.push(DRAMA_TAGS.COMEBACK);
  }
  if (hasEvents && timeline.isSeeSaw) {
    picked.push(DRAMA_TAGS.SEESAW);
  }
  if (totalGoals >= 4) {
    picked.push(DRAMA_TAGS.GOAL_FEST);
  }
  if (hasEvents && timeline.hasRedOrPenalty) {
    picked.push(DRAMA_TAGS.CARDS_PENALTY);
  }
  if (totalGoals === 0 && !timeline.hasRedOrPenalty) {
    picked.push(DRAMA_TAGS.GOALLESS);
  }

  picked.sort((a, b) => b.priority - a.priority);
  const tags = picked.slice(0, MAX_TAGS).map(({ id, label, tone, priority }) => ({
    id,
    label,
    tone,
    priority
  }));

  const pulseMinutes = hasEvents ? [...pulseSet].sort((a, b) => a - b) : [];

  return {
    available: true,
    hasEvents,
    tags,
    pulseMinutes,
    degradedReason: hasEvents ? null : 'no-events'
  };
}
