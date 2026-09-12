/**
 * 比分源注册与多源合并
 *
 * 设计意图：**不绑定单一源**。任一源挂掉，其余源继续工作；同组数据按优先级取用。
 *
 * 合并规则（每一条都是踩过坑后定的）：
 *   · 比分  —— 取「优先级最高且已完赛且有比分」的那条。多源不一致时记录冲突，不静默选一个
 *   · 开球时间 —— **只取 kickoffTrusted 的源**（openfootball 给的是当地墙钟，直接用会整体偏移）
 *   · 状态  —— 任一源报改期则判改期；进行中（live）保留标记，由上层决定不落库
 */

import * as espn from './espn.js';
import * as openfootball from './openfootball.js';

/** 注册表：priority 数字越小优先级越高 */
export const SOURCES = { espn, openfootball };

export const DEFAULT_ORDER = Object.values(SOURCES)
  .sort((a, b) => a.priority - b.priority)
  .map(s => s.id);

/** 各源的拉取策略（差异较大，各自声明） */
const STRATEGY = {
  // ESPN：按月分块（单次查询有上限），需要日期区间
  espn: {
    perLeague: true,
    units: months => months.map(ym => ({ kind: 'month', ym })),
    fetch: (league, unit, opts) => espn.fetchLeague(league, espn.monthRange(unit.ym), opts)
  },
  // openfootball：整季一个文件，不分块 —— 只拉一次
  openfootball: {
    perLeague: true,
    units: () => [{ kind: 'season' }],
    fetch: (league, unit, opts) => openfootball.fetchLeague(league, opts.season || '2026-27', opts)
  }
};

/**
 * 拉取所有源的事件
 * @returns {{ events: object[], bySource: object, errors: object[] }}
 */
export async function fetchAllEvents({ leagues, months, season, order = DEFAULT_ORDER, log = console }) {
  const events = [];
  const bySource = {};
  const errors = [];
  const requests = [];

  for (const sid of order) {
    const src = SOURCES[sid];
    const strat = STRATEGY[sid];
    if (!src || !strat) continue;
    bySource[sid] = { events: 0, requests: 0, ok: 0, failed: 0 };

    for (const league of leagues) {
      for (const unit of strat.units(months)) {
        requests.push({ sid, src, strat, league, unit });
      }
    }
  }

  // 串行 + 间隔：避免打爆上游（旧项目因并发过高被封过 IP）
  for (const r of requests) {
    bySource[r.sid].requests++;
    try {
      const evs = await r.strat.fetch(r.league, r.unit, { log, season });
      events.push(...evs);
      bySource[r.sid].events += evs.length;
      bySource[r.sid].ok++;
    } catch (err) {
      bySource[r.sid].failed++;
      errors.push({ source: r.sid, league: r.league, unit: r.unit.kind === 'month' ? r.unit.ym : 'season', message: err.message });
      log.warn?.(`[sources] ${r.sid} ${r.league} 拉取失败：${err.message}`);
    }
    await new Promise(res => setTimeout(res, 350));
  }

  return { events, bySource, errors };
}

/**
 * 多源合并
 * @param {object[]} events 统一事件数组
 * @param {object[]} priorityOrder 源 id 顺序（小的优先）
 * @returns {{ merged: object[], conflicts: object[] }}
 */
export function mergeEvents(events, priorityOrder = DEFAULT_ORDER) {
  const rank = new Map(priorityOrder.map((s, i) => [s, i]));
  const groups = new Map();

  for (const e of events) {
    const k = `${e.league}|${e.homeId}|${e.awayId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const merged = [];
  const conflicts = [];

  for (const [k, list] of groups) {
    const sorted = [...list].sort((a, b) => (rank.get(a.source) ?? 99) - (rank.get(b.source) ?? 99));

    // 比分：优先取已完赛且有比分的，同级取优先级高的
    const withScore = sorted.filter(e => e.state === 'done' && e.homeScore != null && e.awayScore != null);
    const scorePick = withScore[0] || null;

    // 多源比分不一致 → 记录冲突（不静默）
    const scoreSet = new Set(withScore.map(e => `${e.homeScore}-${e.awayScore}`));
    if (scoreSet.size > 1) {
      conflicts.push({
        key: k,
        kind: 'score',
        values: [...scoreSet],
        sources: withScore.map(e => ({ source: e.source, score: `${e.homeScore}-${e.awayScore}` }))
      });
    }

    // 开球时间：只信 kickoffTrusted 的源
    const timePick = sorted.find(e => e.kickoffTrusted && e.kickoff) || null;

    // 状态：改期优先；其次取有比分依据的状态
    const postponed = sorted.some(e => e.state === 'pp');
    const live = sorted.some(e => e.state === 'live');
    let state;
    if (postponed) state = 'pp';
    else if (scorePick) state = 'done';
    else if (live) state = 'live';
    else state = 'sched';

    merged.push({
      league: sorted[0].league,
      homeId: sorted[0].homeId,
      awayId: sorted[0].awayId,
      kickoff: timePick?.kickoff || sorted[0].kickoff || null,
      kickoffTrusted: !!timePick,
      state,
      homeScore: scorePick?.homeScore ?? null,
      awayScore: scorePick?.awayScore ?? null,
      scoreSource: scorePick?.source || null,
      timeSource: timePick?.source || null,
      sources: sorted.map(e => e.source)
    });
  }

  return { merged, conflicts };
}
