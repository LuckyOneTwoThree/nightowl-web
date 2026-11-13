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
import {
  PRODUCT_WEIGHTS,
  followedBonus,
  isBigSixClash,
  leagueBonus,
  sleepTier,
  storyBonus
} from './engine.js';

export const LEVEL = { L1: 'L1', L2: 'L2', L3: 'L3' };

/** 档位通识提示（不含任何具体分钟数或医学结论） */
export const TIER_ADVICE = {
  S0: '零成本档 · 不影响作息',
  S1: '轻度档 · 结束时间适中',
  S2: '黄金修仙档 · 次日注意补觉',
  S3: '重度档 · 次日建议轻负荷',
  S4: '极限档 · 熬夜代价较高'
};

/**
 * 档位 → 视觉（对齐 UI 规范 §三）
 *
 * 此前这里是 emerald / teal / amber / orange / purple 五种互不相干的
 * Tailwind 原生色 —— 五个色相让人无法一眼看出"S4 比 S1 严重"，
 * 紫色还额外抢走了"特殊"的注意力。
 * 现在改为 index.css 里 --tier-0..4 的**单条连续色阶**（绿→琥珀→红橙），
 * 色相沿"代价从低到高"单调推进，扫一眼就能排序。
 */
export const TIERS = [
  { label: 'S0', text: 'text-tier-0', soft: 'bg-tier-0/12', solid: 'bg-tier-0' },
  { label: 'S1', text: 'text-tier-1', soft: 'bg-tier-1/12', solid: 'bg-tier-1' },
  { label: 'S2', text: 'text-tier-2', soft: 'bg-tier-2/12', solid: 'bg-tier-2' },
  { label: 'S3', text: 'text-tier-3', soft: 'bg-tier-3/12', solid: 'bg-tier-3' },
  { label: 'S4', text: 'text-tier-4', soft: 'bg-tier-4/12', solid: 'bg-tier-4' }
];

export const TIER_MAP = TIERS.reduce((acc, t) => {
  acc[t.label] = t;
  return acc;
}, {});

/** 兼容旧引用名：从 TIER_MAP 派生，不再单独维护一份色值 */
export const TIER_STYLE = Object.fromEntries(
  TIERS.map(t => [t.label, `${t.text} ${t.soft}`])
);

/**
 * 档位文字色：S0–S4 → text-tier-N
 *
 * 此前 NextUpRail / SameNightPicks / UpcomingFixtures 各自用
 * `Object.fromEntries(Object.entries(TIER_MAP).map(...))` 生成同一张表 ——
 * 三份副本，改一处忘两处就是同一徽章三种颜色。查不到标签时回落中性色，
 * 不抛错（数据里出现未知档位时界面仍要能渲染）。
 */
export const TIER_TEXT = Object.freeze(
  TIERS.reduce((acc, t) => {
    acc[t.label] = t.text;
    return acc;
  }, {})
);

export function tierTextClass(label) {
  return TIER_TEXT[label] || 'text-text-secondary';
}

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
 * 「为什么看这场」——最多三条语义驱动因素，按贡献降序。
 *
 * 只出标签不出数字：第一层摆三个 `+5.9 / +0.0 / +0.0` 只是逼用户做他做不了的除法。
 * 双端共用（桌面 IntelPanel 第一层、移动详情第一层），措辞与排序必须一致。
 */
export function driversOf(ev) {
  if (!ev) return [];
  const head =
    ev.rivalry ||
    (ev.rec
      ? '人工精编推荐'
      : ev.stakes?.driverLabel
        ? ev.stakes.driverLabel
        : ev.star >= 3
          ? '焦点战'
          : ev.star === 2
            ? '有看点'
            : '常规场次');
  const list = [{ key: 'star', label: head, value: ev.star * 10 }];
  if (ev.stakes?.driverLabel && head !== ev.stakes.driverLabel) {
    list.push({ key: 'stakes', label: ev.stakes.driverLabel, value: 18 });
  }
  const storyB = storyBonus(ev, PRODUCT_WEIGHTS);
  if (storyB > 0) {
    list.push({ key: 'story', label: ev.keyNode ? '故事线关键节点' : '故事线在役', value: storyB });
  }
  const followedB = followedBonus(ev, PRODUCT_WEIGHTS);
  if (followedB > 0) list.push({ key: 'followed', label: '关注球队出战', value: followedB });
  const leagueB = leagueBonus(ev, PRODUCT_WEIGHTS);
  if (leagueB > 0) list.push({ key: 'league', label: '关注联赛', value: leagueB });
  return list.sort((a, b) => b.value - a.value).slice(0, 3);
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
  //
  // ⚠️ 这里必须覆盖 `evaluate` 的**全部**星级来源，否则会出现「★★★ + 看点有限」的自相矛盾：
  //    星级来源：rec.star / rivalry / isBigSixClash / stories / keyNode(由 storylines 派生) / isFollowed
  //    此前 L2 只认 rivalry + storylines —— 曼城 vs 切尔西（六强内战）、关注球队的比赛
  //    都会拿到 2–3 星却没有一句正文，直接掉到 L3「看点有限」。
  //    实测（未来可行动 451 场）：无关注配置 16/33 的 2 星以上场次落 L3；关注 ARS 后升至 39/56。
  const l2 = [];
  if (ev?.rivalry) l2.push(`${ev.rivalry} —— 宿敌对决`);
  // 与宿敌重复时不叠加（曼市德比本身已是六强内战）
  else if (isBigSixClash(match)) l2.push(`${leagueName(match.l)} 六强内战`);
  if (ev?.stakes?.headline) l2.push(ev.stakes.headline);
  // 关注球队只由调用方传入的 ev 决定；缺 ev 时不臆测（避免把「未配置」写成「关注」）
  if (ev?.isFollowed) l2.push('关注球队出战');
  const stories = storylinesOf(match, storylines);
  stories.forEach(s => l2.push(`${s.name}：${s.desc}`));
  if (match.tbd) l2.push('开球时间待定，电视台尚未定档');
  // 推荐条目存在但没有精修文案时，用「编辑推荐」承接 L1 星级——
  // 否则 star>=2 会落到 L3，与「星级≥2 不得 L3」的不变式冲突。
  if (rec && !(Array.isArray(rec.points) && rec.points.length) && !l2.length) l2.push('编辑推荐 · 本轮重点关注');

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
  // 重度档覆盖大半周时，逐日列出等于没有建议；改为给出取舍动作。
  if (heavy.length >= 5) {
    return `本周重度档覆盖 ${heavy.length} 天（${heavyStr}），建议只保留 1–2 个主看夜，其余用零成本场或回放代替`;
  }
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
