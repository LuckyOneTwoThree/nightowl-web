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

/* ------------------------------------------------------------------ */
/* 今晚                                                                */
/* ------------------------------------------------------------------ */

export function computeTonight(nowTs, prefs) {
  const night = E.nightOf(nowTs);
  const slice = fixtures.filter(m => E.owlDay(m.t) === night).sort(byTs);

  const { hero, extras } = E.pickToday(
    slice,
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
    E.minefield(slice, REC_MAP, rivalries, storylines, prefs.followedTeams, prefs.followedLeagues).map(e => e.m.id)
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

  const plan = E.planWeek(
    matches,
    REC_MAP,
    rivalries,
    storylines,
    prefs.followedTeams,
    prefs.weeklyBudget,
    prefs.followedLeagues,
    E.PRODUCT_PLAN_OPTS
  );

  const mine = E.minefield(matches, REC_MAP, rivalries, storylines, prefs.followedTeams, prefs.followedLeagues);
  const days = buildWeekDays(ws.str, matches);
  const advice = weekDistributionAdvice(days.filter(d => d.count > 0));

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

