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
import { ts } from '../../shared/core/engine.js';

/** 注册表：priority 数字越小优先级越高 */
export const SOURCES = { espn, openfootball };

export const DEFAULT_ORDER = Object.values(SOURCES)
  .sort((a, b) => a.priority - b.priority)
  .map(s => s.id);

/** 各源的拉取策略（差异较大，各自声明） */
const STRATEGY = {
  // ESPN：按单日精准分块（单日 dates=YYYYMMDD 支持完好；日期范围会被上游 400 拒绝）
  espn: {
    perLeague: true,
    units: ({ league, targets, months, targetDates }) => {
      // 1. 若有按联赛分配的精准目标日期 Map 或对象
      if (targets) {
        const dates = targets.get ? targets.get(league) : targets[league];
        if (dates && (dates.size || dates.length)) {
          return Array.from(dates).sort().map(d => ({ kind: 'date', date: d }));
        }
        return [];
      }
      // 2. 若传入了全局 targetDates 列表
      if (targetDates && targetDates.length) {
        return targetDates.map(d => ({ kind: 'date', date: d }));
      }
      // 3. 兜底返回今日
      return [{ kind: 'today', date: '' }];
    },
    fetch: (league, unit, opts) => espn.fetchLeague(league, unit.date || '', opts)
  },
  // openfootball：整季一个文件，不分块 —— 作为副源备用
  openfootball: {
    perLeague: true,
    units: ({ league, targets }) => {
      // 该源不覆盖欧冠（只有五大联赛）：UCL 接管扫描会给 UCL 塞入查询日期，
      // 但这里拉了也是空，直接跳过，避免每次同步浪费一次请求
      if (!openfootball.LEAGUES[league]) return [];
      // 若存在精准 targets 且该联赛并无待同步场次，跳过此联赛避免多余开销
      if (targets) {
        const dates = targets.get ? targets.get(league) : targets[league];
        if (!dates || (dates.size === 0 && dates.length === 0)) return [];
      }
      return [{ kind: 'season' }];
    },
    fetch: (league, unit, opts) => openfootball.fetchLeague(league, opts.season || '2026-27', opts)
  }
};

/**
 * 拉取所有源的事件
 * @returns {{ events: object[], bySource: object, errors: object[] }}
 */
export async function fetchAllEvents({ leagues, months, targets, targetDates, season, order = DEFAULT_ORDER, log = console, fetchOptions = {}, deadlineMs = 0 }) {
  const events = [];
  const bySource = {};
  const errors = [];
  const requests = [];
  const startedAt = Date.now();

  for (const sid of order) {
    const src = SOURCES[sid];
    const strat = STRATEGY[sid];
    if (!src || !strat) continue;
    bySource[sid] = { events: 0, requests: 0, ok: 0, failed: 0 };

    for (const league of leagues) {
      const units = strat.units({ league, targets, months, targetDates });
      for (const unit of units) {
        requests.push({ sid, src, strat, league, unit });
      }
    }
  }

  // 串行 + 间隔：避免打爆上游（旧项目因并发过高被封过 IP）
  for (const r of requests) {
    // 总时长上限：慢网下 30+ 个串行请求会把「正在更新」拖成几分钟。
    // 到点就保留已完成的结果，剩余请求下个周期再补，不阻塞 UI 状态归还。
    if (deadlineMs > 0 && Date.now() - startedAt > deadlineMs) break;
    bySource[r.sid].requests++;
    try {
      const evs = await r.strat.fetch(r.league, r.unit, { log, season, ...fetchOptions });
      events.push(...evs);
      bySource[r.sid].events += evs.length;
      bySource[r.sid].ok++;
    } catch (err) {
      bySource[r.sid].failed++;
      const unitLabel = r.unit.kind === 'date' ? r.unit.date : (r.unit.kind === 'month' ? r.unit.ym : r.unit.kind);
      errors.push({ source: r.sid, league: r.league, unit: unitLabel, message: err.message });
      log.warn?.(`[sources] ${r.sid} ${r.league} ${unitLabel} 拉取失败：${err.message}`);
    }
    await new Promise(res => setTimeout(res, 200));
  }

  return { events, bySource, errors };
}

/** 跨源同一场比赛允许的开球时间偏差（实测最多约 24h，留一倍余量） */
const SAME_FIXTURE_WINDOW_MS = 48 * 3600000;

/** 合并一个「同一场次」的事件簇（簇内都是同一时刻附近的跨源结果） */
function mergeCluster(list, rank, key, conflicts) {
  const sorted = [...list].sort((a, b) => (rank.get(a.source) ?? 99) - (rank.get(b.source) ?? 99));

  const withScore = sorted.filter(e => e.state === 'done' && e.homeScore != null && e.awayScore != null);
  const scorePick = withScore[0] || null;

  const scoreSet = new Set(withScore.map(e => `${e.homeScore}-${e.awayScore}`));
  if (scoreSet.size > 1) {
    conflicts.push({
      key,
      kind: 'score',
      values: [...scoreSet],
      sources: withScore.map(e => ({ source: e.source, score: `${e.homeScore}-${e.awayScore}` }))
    });
  }

  const timePick = sorted.find(e => e.kickoffTrusted && e.kickoff) || null;
  const postponed = sorted.some(e => e.state === 'pp');
  const live = sorted.some(e => e.state === 'live');
  let state;
  if (postponed) state = 'pp';
  else if (scorePick) state = 'done';
  else if (live) state = 'live';
  else state = 'sched';

  return {
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
  };
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

  for (const [pairKey, list] of groups) {
    // 同一对阵可能在一个赛季出现两次（欧冠联赛阶段 + 淘汰赛复赛）：
    // 先按开球时间聚类，只合并同一时刻附近的跨源事件。
    const clusters = [];
    const orphans = [];
    for (const e of list) {
      const kickoffTs = ts(e.kickoff);
      if (!Number.isFinite(kickoffTs)) {
        orphans.push(e);
        continue;
      }
      const hit = clusters.find(c => Math.abs(c.ts - kickoffTs) <= SAME_FIXTURE_WINDOW_MS);
      if (hit) hit.list.push(e);
      else clusters.push({ ts: kickoffTs, list: [e] });
    }
    if (orphans.length && clusters.length === 1) clusters[0].list.push(...orphans);
    else if (orphans.length && clusters.length === 0) clusters.push({ ts: NaN, list: orphans });

    for (const cluster of clusters) {
      const key = clusters.length > 1 ? `${pairKey}@${cluster.ts}` : pairKey;
      merged.push(mergeCluster(cluster.list, rank, key, conflicts));
    }
  }

  return { merged, conflicts };
}
