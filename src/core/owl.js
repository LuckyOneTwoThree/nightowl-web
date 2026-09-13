/**
 * 应用层状态计算
 *
 * 把「数据层 + 算法引擎 + 用户偏好」串成界面直接可用的视图模型。
 *
 * 算法调用契约（PRD §7.1，违反即出错）：
 *   pickToday  → 只吃「今晚切片」（按 owlDay 过滤），**不可传全量赛程**
 *   planWeek   → 吃「本周窗口」
 *   minefield  → 吃「本周窗口」
 *   nextFocal  → 吃全量未来场次
 */

import { fixtures, rivalries, storylines, REC_MAP, LEAGUE_ORDER, TEAM_MAP, leagueName } from '../data/index.js';
import * as E from './engine.js';
import { weekDistributionAdvice } from './narrative.js';

const DAY_MS = 86400000;

/** 一律按时间戳排序，禁用字符串比较（凌晨场次会错位） */
function byTs(a, b) {
  return E.ts(a.t) - E.ts(b.t);
}

/**
 * 该场次能否进入算法候选池
 *
 * 三条同时成立：未开赛（st='sched'）、时间已确认（非 tbd）、**且尚未结束**。
 *
 * 为什么必须显式检查"尚未结束"（这是本轮修的一个真实缺陷）：
 *   本产品是本地单机 + 手动保鲜，快照可能滞后数天；即便跑了保鲜，
 *   也总有「刚终场、比分尚未同步」的窗口期。而算法原先只按 st === 'sched' 过滤，
 *   于是这些场次以"未开赛"身份留在候选池，被当成可安排的场次。
 *   实测（2026-09-13 快照）：本周窗口 66 场里有 57 场已过开球时间，
 *   导致「本周精选」推荐了 2 场已踢完的比赛，13 条雷区预警也全是已结束的场次。
 *
 * 为什么放在应用层而不是 engine.js：
 *   engine.js 是算法的唯一权威实现，且需与原版保持 0 处偏差（回归基线）。
 *   时间有效性属于「应用层对数据的信任边界」，不是算法本身的一部分。
 */
function isPickable(m, nowTs) {
  if (m.st !== 'sched' || m.tbd) return false;
  const kick = E.ts(m.t);
  if (isNaN(kick)) return false; // 时间不可解析 → 保守排除，不猜
  return nowTs < kick + E.MATCH_DURATION_MS;
}

/* ------------------------------------------------------------------ */
/* 今晚                                                                */
/* ------------------------------------------------------------------ */

export function computeTonight(nowTs, prefs) {
  const night = E.nightOf(nowTs);
  const slice = fixtures.filter(m => E.owlDay(m.t) === night).sort(byTs);

  // slice 供展示（含刚终场、待录比分的场次）；算法只吃尚未结束的
  const pickable = slice.filter(m => isPickable(m, nowTs));

  const { hero, extras } = E.pickToday(
    pickable,
    REC_MAP,
    rivalries,
    storylines,
    prefs.followedTeams,
    prefs.followedLeagues,
    E.PRODUCT_WEIGHTS
  );

  // 无球日 / 全部 tbd → 降级为"下一场焦点战倒计时"
  const focal = hero
    ? null
    : E.nextFocal(fixtures, REC_MAP, rivalries, storylines, prefs.followedTeams, nowTs, prefs.followedLeagues);

  // 今晚的雷区场次（复用引擎，避免界面自造判据）
  const minefieldIds = new Set(
    E.minefield(pickable, REC_MAP, rivalries, storylines, prefs.followedTeams, prefs.followedLeagues).map(e => e.m.id)
  );

  return { night, slice, hero, extras, focal, minefieldIds };
}

/** Hero 展示档位（D9：阈值 15 / 5） */
export function heroTier(hero) {
  if (!hero) return 'none';
  return E.heroTierOf(hero.index);
}

/* ------------------------------------------------------------------ */
/* 本周                                                                */
/* ------------------------------------------------------------------ */

function buildWeekDays(weekStartStr, matches) {
  const base = Date.parse(weekStartStr + 'T00:00:00Z');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(base + i * DAY_MS).toISOString().slice(0, 10);
    const dayMatches = matches.filter(
      m => E.owlDay(m.t) === date && m.st === 'sched' && !m.tbd
    );
    const cost = dayMatches.reduce((mx, m) => Math.max(mx, E.tierOf(m).cost), 0);
    days.push({
      date,
      count: dayMatches.length,
      cost,
      tier: dayMatches.length ? E.sleepTier(dayMatches[0].t) : null,
      matches: dayMatches.sort(byTs)
    });
  }
  return days;
}

export function computeWeek(nowTs, prefs) {
  const ws = E.weekStartBJ(nowTs);
  const end = ws.ts + 7 * DAY_MS;
  const matches = fixtures
    .filter(m => {
      const t = E.ts(m.t);
      return t >= ws.ts && t < end;
    })
    .sort(byTs);

  // 本周窗口内"尚未结束"的场次才进算法；
  // 已踢完但状态未同步的场次（本地单机 + 手动保鲜下很常见）不参与背包与雷区
  const pickable = matches.filter(m => isPickable(m, nowTs));

  const plan = E.planWeek(
    pickable,
    REC_MAP,
    rivalries,
    storylines,
    prefs.followedTeams,
    prefs.weeklyBudget,
    prefs.followedLeagues,
    E.PRODUCT_PLAN_OPTS
  );

  const mine = E.minefield(pickable, REC_MAP, rivalries, storylines, prefs.followedTeams, prefs.followedLeagues);
  const days = buildWeekDays(ws.str, matches);

  // 周度建议只基于「还能安排」的场次。
  // 若沿用全周场次，会出现"建议本周注意 09-10 的重度档"而那天早已过去的情况 ——
  // 背包看未来、建议却看全周，两者口径不一致会让人怀疑结论。柱状图仍展示全周（历史视角）。
  const upcomingDays = buildWeekDays(ws.str, pickable);
  const advice = weekDistributionAdvice(upcomingDays.filter(d => d.count > 0));

  return { weekStartStr: ws.str, matches, plan, minefield: mine, days, advice };
}

/* ------------------------------------------------------------------ */
/* 赛程                                                                */
/* ------------------------------------------------------------------ */

/**
 * 生成扁平「行」列表（供虚拟滚动）：日期分隔行 + 比赛行
 * 注意：这里全部场次（含 tbd / done）都要出现，与算法候选池不同。
 */
export function computeScheduleRows(nowTs, prefs, filters) {
  const { leagues, onlyFollowed, query } = filters;
  const q = (query || '').trim().toLowerCase();

  const pool = fixtures.filter(m => {
    if (leagues && leagues.length && !leagues.includes(m.l)) return false;
    if (onlyFollowed) {
      const hit = prefs.followedTeams.includes(m.h) || prefs.followedTeams.includes(m.a);
      if (!hit) return false;
    }
    if (q) {
      const h = TEAM_MAP[m.h];
      const a = TEAM_MAP[m.a];
      const hay = [
        h?.zh, h?.en, a?.zh, a?.en,
        leagueName(m.l), m.id
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...pool].sort(byTs);

  // 先一次遍历统计每个夜猫日的场次，再生成行。
  // 原写法在循环内对全表 filter 求 count，是 O(n²)：1,897 场实测 67ms（优化后 0ms）。
  // 这个函数在搜索框每次键入时都会重算，那 67ms 会直接表现为输入卡顿。
  const counts = new Map();
  for (const m of sorted) {
    const day = E.owlDay(m.t);
    counts.set(day, (counts.get(day) || 0) + 1);
  }

  // 分组头按夜猫口径（owlDay），保证凌晨场次归属正确
  const rows = [];
  let lastDay = null;
  for (const m of sorted) {
    const day = E.owlDay(m.t);
    if (day !== lastDay) {
      rows.push({ type: 'date', key: `d-${day}`, date: day, count: counts.get(day) });
      lastDay = day;
    }
    rows.push({ type: 'match', key: m.id, m });
  }
  return rows;
}

/** 赛程筛选的默认值 */
export function defaultScheduleFilters() {
  return { leagues: [...LEAGUE_ORDER], onlyFollowed: false, query: '' };
}

/**
 * 单场评估（供列表行按需取星级 / 德比名 / 指数）
 * evaluate 成本很低（20 条德比 + 8 条故事线的线性扫描），虚拟滚动下每次只算可见行。
 */
export function evalOne(m, prefs) {
  const ev = E.evaluate(m, REC_MAP, rivalries, storylines, prefs.followedTeams, prefs.followedLeagues);
  return { ev, index: E.owlIndex(ev, m, E.PRODUCT_WEIGHTS) };
}

/** 当前进行中的场次计数（用于顶栏指示） */
export function liveCountAt(nowTs) {
  let n = 0;
  for (const m of fixtures) {
    if (m.st !== 'sched') continue;
    if (E.matchState(m, nowTs) === 'live') n++;
  }
  return n;
}

/** 单场状态（对界面隐藏引擎细节） */
export function stateOf(m, nowTs) {
  return E.matchState(m, nowTs);
}

export { E as engine };

