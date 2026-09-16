/**
 * 数据保鲜：把多源比分数据折算成本地 fixtures 的补丁
 *
 * 为什么必须有：本产品赛程是**动态数据**。
 *   · 全季 1,023 场（53.9%）的开球时间是占位值，官方提前 2–4 周才公布
 *   · 每日产生新的完赛比分
 *   不做保鲜，过半场次的时间与比分永久失真。
 *
 * 数据来源：`server/sources/` 的多源适配层（ESPN 主源 + openfootball 副源），
 *          按优先级合并后交给本模块折算。
 *
 * 铁律（PRD FR-D-01）：**`st` 落库取值域只允许 `sched` / `done` / `pp`**
 *   进行中（live）**一律不落库**——由 `matchState()` 从时间推导。
 *   若写入 `live`，`pickToday` / `planWeek` / `minefield` 的 `st === 'sched'` 硬过滤
 *   会把正在进行的焦点战排除，Hero 卡会在开球那一刻消失。
 */

import { ts } from '../src/core/engine.js';
import { fetchAllEvents, mergeEvents, DEFAULT_ORDER } from './sources/index.js';

export const ALLOWED_ST = ['sched', 'done', 'pp'];

/** 单场最多允许的匹配时间偏差（天）——超过则视为不同场次，拒绝匹配 */
export const MATCH_WINDOW_DAYS = 4;

/** 本地 Season 覆盖的月份（2026-08 ～ 2027-05） */
export function seasonMonths(now = new Date()) {
  const out = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i < 15; i++) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (y > 2027 || (y === 2027 && m > 5)) break;
  }
  return out;
}

/**
 * 智能活跃同步月份：
 * 完赛比分与即时改期主要发生于「历史已开球但未录入」或「当前/近期 7 天内」的比赛月份。
 * 避免盲目扫描全季 9 个月（54 次请求），将常态同步请求压缩至 1~2 个月（8 秒极速完成）。
 */
export function activeSyncMonths(fixtures = [], nowTs = Date.now()) {
  const months = new Set();
  const d = new Date(nowTs);
  const curY = d.getUTCFullYear();
  const curM = d.getUTCMonth() + 1;
  const pad = n => String(n).padStart(2, '0');

  // 当前月
  months.add(`${curY}${pad(curM)}`);

  // 上个月
  let prevY = curY;
  let prevM = curM - 1;
  if (prevM < 1) {
    prevM = 12;
    prevY--;
  }
  months.add(`${prevY}${pad(prevM)}`);

  // 扫描 fixtures 中确有过去未完赛或近期 7 天开球的场次所属月份
  const future7Days = nowTs + 7 * 86400000;
  for (const m of fixtures) {
    const t = ts(m.t);
    if (Number.isNaN(t)) continue;
    if (m.st === 'sched' && (t < nowTs || t <= future7Days)) {
      const matchDate = new Date(t);
      const ym = `${matchDate.getUTCFullYear()}${pad(matchDate.getUTCMonth() + 1)}`;
      months.add(ym);
    }
  }

  return Array.from(months).sort();
}

/**
 * 增量未同步精准目标：
 * 铁律：**已完赛（st === 'done' 且已有比分）的记录坚决不再重复同步**。
 *
 * 仅获取未同步的数据：
 *   1. 历史已开球但未录入完赛比分的场次（m.st === 'sched' && kickTs < nowTs）
 *   2. 当前正在进行的场次（kickTs <= nowTs && kickTs + 120min >= nowTs）
 *   3. 近期 48 小时内的未来场次（可能刚刚确定精确开球时间或改期）
 *
 * 返回：Map<league, Set<string(YYYYMMDD)>>（转为 UTC 日期以匹配上游 API）
 */
export function activeSyncTargets(fixtures = [], nowTs = Date.now()) {
  const targets = new Map();
  const future48h = nowTs + 48 * 3600000;
  const pad = n => String(n).padStart(2, '0');

  for (const m of fixtures) {
    // 已同步完赛比分的记录，100% 排除，绝不重复同步
    if (m.st === 'done' && m.sc) continue;
    // 延期场次且无确切开球时间的暂不主动扫
    if (m.st === 'pp' && !m.t) continue;

    const t = ts(m.t);
    if (Number.isNaN(t)) continue;

    // 只有已开球（未录入）或未来 48 小时以内的场次才需要保鲜
    if (m.st === 'sched' && t <= future48h) {
      const d = new Date(t);
      const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
      if (!targets.has(m.l)) targets.set(m.l, new Set());
      targets.get(m.l).add(ymd);
    }
  }

  return targets;
}

/* ------------------------------------------------------------------ */
/* 折算补丁                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把合并后的事件折算成本地 fixtures 的补丁
 *
 * @param {object[]} merged  mergeEvents 的输出
 * @param {object[]} fixtures 本地赛程
 * @returns {{ patches: Map<string, object>, stats: object, unmatched: object[], conflicts: object[] }}
 */
export function planPatches(merged, fixtures, conflicts = []) {
  const patches = new Map();
  const unmatched = [];
  const incompleteScore = [];
  const stats = {
    done: 0, timeUpdated: 0, tbdCleared: 0, pp: 0,
    skippedLive: 0, noCounterpart: 0, scoreFromSecondary: 0,
    skippedIncompleteScore: 0
  };

  // 按 (联赛, 主队-客队) 建索引，避免每次全表扫描
  const index = new Map();
  for (const m of fixtures) {
    const k = `${m.l}|${m.h}-${m.a}`;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(m);
  }

  for (const e of merged) {
    // 进行中：不落库（铁律）
    if (e.state === 'live') {
      stats.skippedLive++;
      continue;
    }
    if (!e.kickoff) continue;

    const cands = index.get(`${e.league}|${e.homeId}-${e.awayId}`);
    if (!cands || !cands.length) {
      stats.noCounterpart++;
      unmatched.push({ league: e.league, h: e.homeId, a: e.awayId, at: e.kickoff, sources: e.sources, reason: '本地赛程无此对阵' });
      continue;
    }

    // 取时间最接近的一场（同对阵一季可能主客各一次）
    const evTs = ts(e.kickoff);
    let best = null;
    let bestDiff = Infinity;
    for (const m of cands) {
      const d = Math.abs(ts(m.t) - evTs);
      if (d < bestDiff) {
        bestDiff = d;
        best = m;
      }
    }
    if (!best || bestDiff > MATCH_WINDOW_DAYS * 86400000) {
      stats.noCounterpart++;
      unmatched.push({
        league: e.league, h: e.homeId, a: e.awayId, at: e.kickoff, sources: e.sources,
        reason: `时间差超阈值（${(bestDiff / 86400000).toFixed(1)} 天）`
      });
      continue;
    }

    /**
     * 前置校验：声称「完赛」就必须带完整比分
     *
     * 否则会产出一条 { st: 'done' } 的半套补丁，让 fixtures 出现「已完赛却无比分」，
     * 于是写盘前校验失败、sync-scores --apply 整批中止 —— 其余完全合法的补丁一起丢，
     * 而唯一"解法"是手工改数据文件，违反本仓「数据只走脚本」的铁律。
     * 这里改为：**整条事件跳过**（连开球时间也不更新，避免留下半套补丁），并计入统计。
     */
    const scoreStr = `${e.homeScore}-${e.awayScore}`;
    const hasFullScore = e.homeScore != null && e.awayScore != null && /^\d+-\d+$/.test(scoreStr);
    if (e.state === 'done' && !hasFullScore) {
      stats.skippedIncompleteScore++;
      incompleteScore.push({
        league: e.league,
        h: e.homeId,
        a: e.awayId,
        at: e.kickoff,
        got: `homeScore=${e.homeScore} awayScore=${e.awayScore}`,
        sources: e.sources
      });
      continue;
    }

    const patch = {};

    /* 比分：只对完赛且两比分齐全的场次写入，格式必须 H-A */
    if (e.state === 'done') {
      stats.done++;
      if (scoreStr !== best.sc) patch.sc = scoreStr;
      if (e.scoreSource && e.scoreSource !== 'espn') stats.scoreFromSecondary++;
    }

    /* 开球时间：**只信 kickoffTrusted 的源**（副源给的是当地墙钟，直接用会整体偏移） */
    if (e.kickoffTrusted && e.kickoff !== best.t) {
      patch.t = e.kickoff;
      stats.timeUpdated++;
      if (best.tbd) stats.tbdCleared++;
    }

    /* 状态 */
    if (e.state === 'pp' && best.st !== 'pp') {
      patch.st = 'pp';
      stats.pp++;
    } else if (e.state === 'done' && best.st !== 'done') {
      patch.st = 'done';
    } else if (e.state === 'sched' && best.st === 'pp') {
      patch.st = 'sched'; // 之前标了延期，现在又有安排 → 回到 sched
    }

    /* 解除 tbd：
       · 有时间且可信 → 必然解除
       · 已完赛且有比分 → 这场比赛确实发生了，占位时间不再成立（t 保持占位值，
         但 st='done' 后不再参与算法，故无影响） */
    if (best.tbd && (e.state === 'pp' ? false : (patch.t || (e.state === 'done' && patch.sc)))) {
      patch.tbd = false;
      if (!patch.t) stats.tbdCleared++;
    }

    if (Object.keys(patch).length) patches.set(best.id, patch);
  }

  return { patches, stats, unmatched, conflicts, incompleteScore };
}

/* ------------------------------------------------------------------ */
/* 同步主流程                                                          */
/* ------------------------------------------------------------------ */

/**
 * 执行一次保鲜同步
 * @param {object} opts
 * @param {Array}  opts.fixtures 本地赛程（只读）
 * @param {object} opts.rules    server/rules.json
 * @param {string[]} [opts.months] 限定月份（仅对按月分块的源生效）
 * @param {string[]} [opts.sources] 指定启用的源，默认全部
 */
export async function syncScores({ fixtures, rules, months, allMonths = false, sources, log = console }) {
  const cfg = rules.scores || {};
  const leagues = Object.keys(cfg.leagues || {});
  const order = (sources && sources.length ? sources : DEFAULT_ORDER).filter(s => DEFAULT_ORDER.includes(s));
  const pad = n => String(n).padStart(2, '0');
  
  let list = null;
  let targets = null;

  if (months && months.length && months !== 'all') {
    list = Array.isArray(months) ? months : [months];
    // 指定月份模式：提取指定月份内涉及的比赛日期
    targets = new Map();
    for (const m of fixtures) {
      if (m.st === 'done' && !allMonths) continue;
      const t = ts(m.t);
      if (Number.isNaN(t)) continue;
      const d = new Date(t);
      const ym = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
      if (list.includes(ym)) {
        const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
        if (!targets.has(m.l)) targets.set(m.l, new Set());
        targets.get(m.l).add(ymd);
      }
    }
  } else if (allMonths || months === 'all') {
    list = seasonMonths();
    targets = new Map();
    for (const m of fixtures) {
      const t = ts(m.t);
      if (Number.isNaN(t)) continue;
      const d = new Date(t);
      const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
      if (!targets.has(m.l)) targets.set(m.l, new Set());
      targets.get(m.l).add(ymd);
    }
  } else {
    // 默认常态增量同步：精准提取未同步完赛场次与近期 48 小时比赛的日期，已同步场次完全跳过
    targets = activeSyncTargets(fixtures);
    list = activeSyncMonths(fixtures);
  }

  const { events, bySource, errors } = await fetchAllEvents({
    leagues, months: list, targets, order, log,
    season: cfg.season || '2026-27'
  });

  const { merged, conflicts } = mergeEvents(events, order);
  const { patches, stats, unmatched, incompleteScore } = planPatches(merged, fixtures, conflicts);

  return {
    patches, merged, conflicts, unmatched, incompleteScore,
    bySource, errors,
    stats,
    months: list,
    targets,
    sources: order
  };
}

/** 把补丁应用到 fixtures 数组（返回新数组，不改原对象） */
export function applyPatches(fixtures, patches) {
  let changed = 0;
  const next = fixtures.map(m => {
    const p = patches.get(m.id);
    if (!p) return m;
    changed++;
    return { ...m, ...p };
  });
  return { fixtures: next, changed };
}

/**
 * 写盘前校验：st 取值域 + done 必有比分
 *
 * 列出**具体 offender**（最多 10 个），而不是只给第一个样本 ——
 * 否则排错只能靠猜，而这个校验一旦触发就是整批中止，代价很高。
 */
export function validateFixtures(fixtures) {
  const issues = [];

  const badSt = fixtures.filter(m => !ALLOWED_ST.includes(m.st));
  if (badSt.length) {
    const sample = badSt.slice(0, 10).map(m => `${m.id}=${m.st}`).join('、');
    issues.push(
      `${badSt.length} 场次的 st 不在取值域 ${ALLOWED_ST.join('/')} 内：${sample}${badSt.length > 10 ? ` … 共 ${badSt.length} 场` : ''}`
    );
  }

  const doneNoScore = fixtures.filter(m => m.st === 'done' && !m.sc);
  if (doneNoScore.length) {
    const sample = doneNoScore.slice(0, 10).map(m => m.id).join('、');
    issues.push(
      `${doneNoScore.length} 场次 st=done 但无比分：${sample}${doneNoScore.length > 10 ? ` … 共 ${doneNoScore.length} 场` : ''}`
    );
  }

  return issues;
}
