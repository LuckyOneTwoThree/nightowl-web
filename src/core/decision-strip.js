/**
 * 决策条（桌面 / 手机共用纯函数）
 *
 * 回答四个问题，且只回答这四个：
 *   1. 值不值得看     → verdict
 *   2. 看完几点       → endAt
 *   3. 代价多大       → costMinutes / remainingMinutes
 *   4. 有没有更轻的   → alternativeId
 *
 * 纪律：
 *   · 只返回语义枚举与数值，**不返回中文文案**（文案属于视图层，双端措辞不同）
 *   · 不重算夜猫指数：指数由调用方传入（来自 evalOne / owlIndex），避免与引擎口径分叉
 *   · 替代场次必须由调用方按「同夜候选」口径传入（sameNightPicks），
 *     本模块只做「比当前这场更轻」的判定，不自己去翻全量赛程
 *   · 睡眠账本未启用时 costMinutes 一律为 null，不伪造 0
 */

import { MATCH_DURATION_MS, ts } from './engine.js';
import { sleepLedger } from './sleep.js';

export const DECISION_VERDICT = Object.freeze({
  RECOMMENDED: 'recommended',
  NEUTRAL: 'neutral',
  DEFER: 'defer',
  UNKNOWN: 'unknown'
});

export const DECISION_REASON = Object.freeze({
  TBD: 'tbd',
  INVALID: 'invalid',
  FOLLOWED: 'followed',
  HIGHLIGHT: 'highlight',
  LIGHTER_ALTERNATIVE: 'lighter-alternative',
  LOW_INDEX: 'low-index',
  MISSING_INDEX: 'missing-index'
});

/** 与 Hero 高光阈值同源（15 分档），低于此值不算「值得熬」 */
export const DECISION_HIGHLIGHT_INDEX = 15;
/** 替代场次至少要早结束这么多分钟才算「更轻」 */
export const LIGHTER_MIN_EARLY_MINUTES = 30;
/** 替代场次看点数不得低于当前场的这个比例，否则不值得换 */
export const LIGHTER_INDEX_RATIO = 0.6;
/** 睡眠缺口达到这个分钟数才值得建议换一场 */
export const DEFER_MIN_COST_MINUTES = 90;

const MINUTE_MS = 60000;

function finiteIndex(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function endAtOf(match) {
  const kickoff = ts(match?.t);
  if (!Number.isFinite(kickoff)) return null;
  return kickoff + MATCH_DURATION_MS;
}

function sleepProfileFrom(prefs) {
  return {
    enabled: prefs?.sleepEnabled === true,
    wakeTime: prefs?.sleepWakeTime,
    minSleep: prefs?.sleepMinHours
  };
}

/**
 * 在候选里挑「更轻的替代」。
 *
 * 条件：不是自己、时间可算、比当前场早结束至少 LIGHTER_MIN_EARLY_MINUTES 分钟、
 * 看点数不低于当前场的 LIGHTER_INDEX_RATIO。
 * 命中多个时取指数最高的那个（同等轻，选更好看的）。
 */
export function lighterAlternative(match, index, alternatives) {
  const currentEnd = endAtOf(match);
  if (currentEnd == null) return null;
  const base = finiteIndex(index);
  if (base == null || base <= 0) return null;
  const floor = base * LIGHTER_INDEX_RATIO;

  let best = null;
  for (const alt of alternatives || []) {
    if (!alt?.m || alt.m.id === match.id) continue;
    if (alt.m.tbd) continue;
    const altEnd = endAtOf(alt.m);
    if (altEnd == null) continue;
    if (currentEnd - altEnd < LIGHTER_MIN_EARLY_MINUTES * MINUTE_MS) continue;
    const altIndex = finiteIndex(alt.index);
    if (altIndex == null || altIndex < floor) continue;
    if (!best || altIndex > best.index) best = { id: alt.m.id, index: altIndex, endAt: altEnd };
  }
  return best;
}

/**
 * @param {{
 *   match: object,
 *   index?: number,
 *   prefs?: object,
 *   now?: number,
 *   alternatives?: Array<{m: object, index: number}>,
 *   followed?: boolean,
 *   spoilerFree?: boolean,
 *   revealed?: boolean
 * }} input
 */
export function decisionStrip({
  match,
  index,
  prefs,
  now = Date.now(),
  alternatives = [],
  followed = false,
  spoilerFree = false,
  revealed = false
} = {}) {
  const resultHidden = spoilerFree && !revealed && match?.st === 'done';
  const base = {
    verdict: DECISION_VERDICT.UNKNOWN,
    reason: DECISION_REASON.INVALID,
    endAt: null,
    costMinutes: null,
    remainingMinutes: null,
    alternativeId: null,
    sleepKnown: false,
    resultHidden
  };

  if (!match) return base;

  const endAt = endAtOf(match);
  // 时间待定的场次不做任何时间承诺：不猜结束时刻、不猜代价。
  if (match.tbd === true) {
    return { ...base, reason: DECISION_REASON.TBD };
  }
  if (endAt == null) return base;

  const profile = sleepProfileFrom(prefs);
  let costMinutes = null;
  let remainingMinutes = null;
  let sleepKnown = false;
  if (profile.enabled) {
    const ledger = sleepLedger(match.t, profile);
    if (ledger.valid && (ledger.ready === true)) {
      sleepKnown = true;
      costMinutes = Math.round((ledger.gapHours || 0) * 60);
      remainingMinutes = Math.round((ledger.remainingHours || 0) * 60);
    }
  }

  const resolved = finiteIndex(index);
  const alt = lighterAlternative(match, resolved, alternatives);
  const verdictOf = () => {
    if (followed) return { verdict: DECISION_VERDICT.RECOMMENDED, reason: DECISION_REASON.FOLLOWED };
    if (resolved == null) return { verdict: DECISION_VERDICT.NEUTRAL, reason: DECISION_REASON.MISSING_INDEX };
    if (resolved >= DECISION_HIGHLIGHT_INDEX) {
      return { verdict: DECISION_VERDICT.RECOMMENDED, reason: DECISION_REASON.HIGHLIGHT };
    }
    // 只有「确实睡不够」且「有更轻的同夜替代」才建议换一场；
    // 睡眠账本没启用时永远不劝退（没有依据就别动摇用户）。
    if (alt && sleepKnown && costMinutes >= DEFER_MIN_COST_MINUTES) {
      return { verdict: DECISION_VERDICT.DEFER, reason: DECISION_REASON.LIGHTER_ALTERNATIVE };
    }
    return { verdict: DECISION_VERDICT.NEUTRAL, reason: DECISION_REASON.LOW_INDEX };
  };

  const { verdict, reason } = verdictOf();
  return {
    verdict,
    reason,
    endAt,
    costMinutes,
    remainingMinutes,
    // 仅当真的建议换一场时才给出替代，避免主结论与副信息互相打脸。
    alternativeId: verdict === DECISION_VERDICT.DEFER && alt ? alt.id : null,
    sleepKnown,
    resultHidden
  };
}
