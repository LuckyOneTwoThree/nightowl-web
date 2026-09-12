/**
 * 看点内容的三层供给（PRD §5.6 / FR-N-01~04）
 *
 * 背景：人工推荐层只覆盖 31 场（1.6%），93.3% 的场次没有任何人工看点信号。
 * 因此看点必须**分层降级**，而非"有则显示、无则空白"。
 *
 *   L1 人工精修   `recommendations.points` / `trivia`   —— 仅 31 场
 *   L2 规则合成   德比名 / 故事线 / 赛季身份 / 档位        —— 约 97 场
 *   L3 通用兜底   联赛 + 轮次 + 档位 + 状态                —— 其余全部
 *
 * ⚠️ 硬约束：文案中不得出现任何无数据源的内容
 *    （xG / 控球率 / 阵型 / 补觉分钟数 / 生理指标 / 码率），判据见《数据可达性对账表》。
 */

import { REC_MAP, TEAM_MAP, leagueName } from '../data/index.js';
import { sleepTier } from './engine.js';

export const LEVEL = { L1: 'L1', L2: 'L2', L3: 'L3' };

/** 档位通识提示（不含任何具体分钟数或医学结论） */
export const TIER_ADVICE = {
  S0: '零成本档 · 不影响作息',
  S1: '轻度档 · 结束时间适中',
  S2: '黄金修仙档 · 次日注意补觉',
  S3: '重度档 · 次日建议轻负荷',
  S4: '极限档 · 熬夜代价较高'
};

/** 档位 → 视觉色（对齐 UI 规范 §三，支持明暗高对比度） */
export const TIER_STYLE = {
  S0: 'text-emerald-400 bg-emerald-500/15',
  S1: 'text-teal-400 bg-teal-500/15',
  S2: 'text-amber-400 bg-amber-500/15',
  S3: 'text-orange-400 bg-orange-500/15',
  S4: 'text-purple-400 bg-purple-500/15'
};

export function tierAdviceOf(match) {
  return TIER_ADVICE[sleepTier(match.t).label] || '';
}

/**
 * 赛季身份标签（D5）
 * `teams.tag` 的实际语义是**赛季身份**（卫冕冠军 / 升班马），且仅 17/111 队有值。
 * 不是战术风格 —— 原 UI 规范此处描述有误，已更正。
 */
export function seasonIdentityOf(match) {
  const h = TEAM_MAP[match.h];
  const a = TEAM_MAP[match.a];
  const parts = [];
  if (h?.tag) parts.push(`${h.zh}：${h.tag}`);
  if (a?.tag) parts.push(`${a.zh}：${a.tag}`);
  if (parts.length) return { lines: parts, fallback: false };
  return {
    lines: [`${leagueName(match.l)} · 第 ${match.r} 轮`],
    fallback: true
  };
}

/** 故事线（去重后取前 2 条） */
export function storylinesOf(match, storylines) {
  return (storylines || [])
    .filter(s => s.status !== 'draft' && (s.nodes || []).includes(match.id))
    .slice(0, 2);
}

/**
 * 主看点供给
 * @returns {{ level: 'L1'|'L2'|'L3', headline: string, lines: string[], trivia: string|null }}
 */
export function narrativeOf(match, ev, storylines) {
  const rec = REC_MAP[match.id];
  const tier = sleepTier(match.t);

  // ---- L1 人工精修 ----
  if (rec && Array.isArray(rec.points) && rec.points.length) {
    return {
      level: LEVEL.L1,
      headline: rec.points[0],
      lines: rec.points.slice(1),
      trivia: rec.trivia || null
    };
  }

  // ---- L2 规则合成 ----
  const l2 = [];
  if (ev?.rivalry) l2.push(`${ev.rivalry} —— 宿敌对决`);
  const stories = storylinesOf(match, storylines);
  stories.forEach(s => l2.push(`${s.name}：${s.desc}`));
  if (match.tbd) l2.push('开球时间待定，电视台尚未定档');

  if (l2.length) {
    return {
      level: LEVEL.L2,
      headline: l2[0],
      lines: l2.slice(1),
      trivia: null
    };
  }

  // ---- L3 通用兜底（保证永不空白）----
  const l3 = [
    `${leagueName(match.l)} 第 ${match.r} 轮`,
    `${tier.label} ${tier.zh}档 · 睡眠成本 ${tier.cost}h`
  ];
  return {
    level: LEVEL.L3,
    headline: `${tier.label} ${tier.zh}档 · 看点有限`,
    lines: l3,
    trivia: null
  };
}

/* ------------------------------------------------------------------ */
/* 本周层面的文案（D1 整改：替换"36 小时补觉窗口"等无口径表述）          */
/* ------------------------------------------------------------------ */

/**
 * 按档位分布给出周度提示。
 * 只描述**档位分布事实**，不做生理学推断（"补觉窗口""免疫力"等一律禁止）。
 */
export function weekDistributionAdvice(days) {
  // days: [{ date, tierLabel, cost }]
  if (!days.length) return '本周没有可安排的场次';

  const heavy = days.filter(d => d.cost >= 3.5);
  const light = days.filter(d => d.cost <= 1.0);

  if (!heavy.length) {
    return `本周没有需要熬夜的场次，全部落在 S0–S2 区间`;
  }
  const heavyStr = heavy.map(d => `${d.date.slice(5)}`).join('、');
  if (light.length) {
    return `本周重度档集中在 ${heavyStr}；其余晚间为 S0–S1 低档，可从容安排`;
  }
  return `本周重度档集中在 ${heavyStr}，注意分配精力`;
}

/** 中置信 / 低置信场次的匹配提示文案（供 P3 抓取模块复用） */
export function matchConfidenceCopy(level) {
  if (level === 'high') return null;
  if (level === 'medium') return '可能匹配，请确认后再播放';
  return '匹配度低，建议直达原站';
}
