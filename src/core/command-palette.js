/**
 * 命令面板的纯数据层
 *
 * 视图/操作命令 + 比赛检索项；搜索打分只依赖标题、副标题与关键词。
 * 不在副标题里放比分 —— 防剧透是全局规则，命令面板也不例外。
 */

import { teamName, leagueName } from '../data/index.js';
import { datePart, hm } from './format.js';
import { ts } from './engine.js';

export const VIEW_COMMANDS = [
  {
    id: 'view:tonight',
    kind: '导航',
    title: '今晚观赛',
    subtitle: '回到今晚之选与赛程',
    keywords: ['今晚', 'tonight', '视图'],
    action: { type: 'view', view: 'tonight' }
  },
  {
    id: 'view:week',
    kind: '导航',
    title: '本周规划',
    subtitle: '睡眠预算与背包推荐',
    keywords: ['本周', 'week', '预算', '规划'],
    action: { type: 'view', view: 'week' }
  },
  {
    id: 'view:schedule',
    kind: '导航',
    title: '赛程日历',
    subtitle: '全季赛程与筛选',
    keywords: ['赛程', 'schedule', '日历'],
    action: { type: 'view', view: 'schedule' }
  }
];

export const ACTION_COMMANDS = [
  {
    id: 'action:settings',
    kind: '操作',
    title: '偏好与数据',
    subtitle: '关注球队、提醒、同步与更新',
    keywords: ['设置', '偏好', 'settings', '提醒', '通知'],
    action: { type: 'settings' }
  },
  {
    id: 'action:sync',
    kind: '操作',
    title: '立即同步比分',
    subtitle: '从 ESPN / openfootball 拉取最新赛果',
    keywords: ['同步', '刷新', '比分', 'sync'],
    action: { type: 'sync' }
  }
];

/** 全量比赛命令；副标题不含比分，避免命令面板剧透；按“进行中 → 最近未来 → 最近过去”排序 */
export function buildMatchCommands(fixtures = [], nowTs = Date.now()) {
  const ordered = [...fixtures].sort((a, b) => {
    const ta = ts(a.t);
    const tb = ts(b.t);
    const da = Number.isFinite(ta) ? ta - nowTs : Infinity;
    const db = Number.isFinite(tb) ? tb - nowTs : Infinity;
    const ongoingA = a.st === 'sched' && da <= 0 && da > -2 * 3600000;
    const ongoingB = b.st === 'sched' && db <= 0 && db > -2 * 3600000;
    const bucketA = ongoingA ? -1 : da >= 0 ? 0 : 1;
    const bucketB = ongoingB ? -1 : db >= 0 ? 0 : 1;
    if (bucketA !== bucketB) return bucketA - bucketB;
    return Math.abs(da) - Math.abs(db);
  });

  return ordered.map(m => ({
    id: `match:${m.id}`,
    kind: '比赛',
    title: `${teamName(m.h)} vs ${teamName(m.a)}`,
    subtitle: `${leagueName(m.l)} · ${datePart(m.t)} ${hm(m.t)}`,
    keywords: [
      teamName(m.h),
      teamName(m.a),
      m.h,
      m.a,
      m.l,
      leagueName(m.l),
      m.id,
      datePart(m.t)
    ],
    action: { type: 'match', matchId: m.id }
  }));
}

/**
 * 轻量搜索：包含即命中；标题命中/前缀命中优先，导航与操作给小加成。
 * @returns {object[]} 截断后的结果
 */
export function searchPalette(items, query, limit = 12) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return (items || []).slice(0, limit);

  const hits = [];
  for (const item of items || []) {
    const title = String(item.title || '').toLowerCase();
    const hay = [item.title, item.subtitle, ...(item.keywords || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) continue;
    let score = 1;
    if (title.includes(q)) score += 8;
    if (title.startsWith(q)) score += 6;
    if (item.kind === '导航') score += 3;
    if (item.kind === '操作') score += 2;
    hits.push({ item, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map(x => x.item);
}
