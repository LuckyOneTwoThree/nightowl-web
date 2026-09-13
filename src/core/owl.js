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

import { getFixtures, rivalries, storylines, REC_MAP, LEAGUE_ORDER, TEAM_MAP, leagueName } from '../data/index.js';
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
  const slice = getFixtures().filter(m => E.owlDay(m.t) === night).sort(byTs);

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
    : E.nextFocal(getFixtures(), REC_MAP, rivalries, storylines, prefs.followedTeams, nowTs, prefs.followedLeagues);

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
      // 注意：不产出 tier 字段。曾有个 `tier: sleepTier(dayMatches[0].t)`，
      // 它取的是「当天第一场」的档位，而 cost 取的是「当天最高档位」——
      // 两个口径不一致，且界面从未消费过它，属死数据兼语义陷阱。
      matches: dayMatches.sort(byTs)
    });
  }
  return days;
}

export function computeWeek(nowTs, prefs) {
  const ws = E.weekStartBJ(nowTs);
  const end = ws.ts + 7 * DAY_MS;
  const matches = getFixtures()
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

  const pool = getFixtures().filter(m => {
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
  // date: null 表示「今天」（视图层动态解析，跨天自动跟随）；'all' 保留全季列表；
  // 其他值为具体夜猫日字符串。⚠️ 不要用 'today' 这类语义值 —— 它会被当成日期去匹配。
  return { leagues: [...LEAGUE_ORDER], onlyFollowed: false, query: '', date: null };
}

/** 每个「夜猫日」的场次统计 —— 日期条上的圆点标记用 */
export function dayCounts() {
  const counts = {};
  for (const m of getFixtures()) {
    if (m.tbd) continue;
    const d = E.owlDay(m.t);
    counts[d] = (counts[d] || 0) + 1;
  }
  return counts;
}

/** 相对今天偏移 n 天的夜猫日（n=0 即今天；夜猫日口径与 nightOf 一致） */
export function owlDayOffset(n, nowTs = Date.now()) {
  return E.nightOf(nowTs + n * 86400000);
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
  for (const m of getFixtures()) {
    if (m.st !== 'sched') continue;
    if (E.matchState(m, nowTs) === 'live') n++;
  }
  return n;
}

/** 单场状态（对界面隐藏引擎细节） */
/**
 * 同夜其他推荐（右栏模块区用）
 *
 * 今晚另外几场值得看的 —— 与「双方后续赛程」互补：
 * 一个回答「这场之后还有什么」，一个回答「今晚还有什么」。
 * 排除当前场次、tbd、已结束；按夜猫指数降序取前 limit 场。
 */
export function sameNightPicks(m, prefs, limit = 3, nowTs = Date.now()) {
  const night = E.owlDay(m.t);
  return getFixtures()
    .filter(
      x =>
        x.id !== m.id &&
        !x.tbd &&
        E.owlDay(x.t) === night &&
        isPickable(x, nowTs)
    )
    .map(x => {
      const { ev } = evalOne(x, prefs);
      return {
        m: x,
        ev,
        index: E.owlIndex(ev, x, E.PRODUCT_WEIGHTS),
        tier: E.tierOf(x)
      };
    })
    .sort((a, b) => b.index - a.index)
    .slice(0, Math.max(0, limit));
}

export function stateOf(m, nowTs) {
  return E.matchState(m, nowTs);
}

/**
 * 双方球队在「本场之后」的赛程（右栏时间轴用）
 *
 * 直接服务核心决策：如果主队/客队几天后还有更值得看的比赛，
 * 这场就不必熬夜。排除本场自身与 tbd；只取本场开球之后的；每队最多 limit 场。
 */
export function upcomingForTeams(m, all = getFixtures(), limit = 4) {
  const kick = E.ts(m.t);
  const pickFor = teamId =>
    all
      .filter(
        x =>
          x.id !== m.id &&
          !x.tbd &&
          x.st === 'sched' &&
          (x.h === teamId || x.a === teamId)
      )
      .filter(x => {
        const t = E.ts(x.t);
        return !Number.isNaN(t) && t > kick;
      })
      .sort(byTs)
      .slice(0, limit);
  return { home: pickFor(m.h), away: pickFor(m.a) };
}

/**
 * 今晚切片按状态分区
 *
 * 界面此前把「进行中 / 未开赛 / 已结束」混在一个列表里 —— 用户分不清当前状态，
 * 尤其刚终场、比分还没同步的那些（ended_pending）会和真正未开赛的排在一起。
 * 分区后：进行中置顶（最该看）、未开赛按时间、已结束默认折叠不占屏。
 */
export function groupTonight(slice, nowTs) {
  const live = [];
  const upcoming = [];
  const finished = [];
  for (const m of slice) {
    const s = E.matchState(m, nowTs);
    if (s === 'live') live.push(m);
    else if (s === 'ended_pending' || s === 'done') finished.push(m);
    else upcoming.push(m);
  }
  live.sort(byTs);
  upcoming.sort(byTs);
  finished.sort(byTs);
  return { live, upcoming, finished };
}

export { E as engine };

