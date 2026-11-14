/**
 * 3 分杠杆 · 确定性赛果沙盘引擎（桌面 / 手机共用纯函数）
 *
 * 口径：
 *   · 严格基于本地已同步积分榜，按本场假设结果（1-0 / 0-0 / 0-1）进行确定性重算
 *   · 只支持 STANDINGS_LEAGUES（PL/PD/SA/BL/FL 及 UCL 第 1–8 轮）；SCG 不提供
 *   · 仅开放给未完赛场次（防止对未揭晓完赛场次反向枚举试出真比分）
 *   · 绝不输出任何胜率百分比或晋级概率，严格遵循《数据可达性与合规边界增补表》
 */

import { getFixtures } from '../data/index.js';
import { isFinished, MATCH_DURATION_MS, ts } from './engine.js';
import {
  computeStandings,
  DOMESTIC_ZONES,
  STANDINGS_LEAGUES,
  UCL_LEAGUE_PHASE_MAX_ROUND,
  UCL_ZONES
} from './standings.js';

export const SANDBOX_OUTCOME = Object.freeze({
  NONE: 'none',
  HOME_WIN: 'home',
  DRAW: 'draw',
  AWAY_WIN: 'away'
});

export const SANDBOX_DISCLAIMER = '按本场 1-0 / 0-0 / 0-1 推演，其余未赛保持不变 · 简化同分规则';

const DAY_MS = 86400000;

function scoreForOutcome(outcome) {
  if (outcome === SANDBOX_OUTCOME.HOME_WIN) return '1-0';
  if (outcome === SANDBOX_OUTCOME.DRAW) return '0-0';
  if (outcome === SANDBOX_OUTCOME.AWAY_WIN) return '0-1';
  return null;
}

export function canSimulateMatch(match) {
  if (!match || !match.id || !match.h || !match.a) return false;
  if (!STANDINGS_LEAGUES.includes(match.l)) return false;
  if (match.l === 'UCL') {
    const r = Number(match.r);
    if (!Number.isFinite(r) || r < 1 || r > UCL_LEAGUE_PHASE_MAX_ROUND) return false;
  }
  if (match.st === 'pp') return false;
  if (isFinished(match)) return false;
  return true;
}

function summarizeTeamDelta(teamId, baseRows, simRows, isUcl) {
  const before = baseRows.find(r => r.teamId === teamId) || null;
  const after = simRows.find(r => r.teamId === teamId) || null;
  if (!after) return null;

  const total = simRows.length;
  const rankBefore = before ? before.rank : null;
  const rankAfter = after.rank;
  const rankDelta = rankBefore != null ? rankBefore - rankAfter : 0; // 正数 = 上升
  const pointsDelta = before ? after.points - before.points : after.points;
  const zoneChanged = !!before && before.zoneKey !== after.zoneKey;

  let lineNote = '';
  const leader = simRows[0];
  if (isUcl) {
    const eighth = simRows[UCL_ZONES.direct - 1];
    if (rankAfter <= UCL_ZONES.direct) {
      const ninth = simRows[UCL_ZONES.direct];
      lineNote = ninth ? `领先第9名 ${Math.max(0, after.points - ninth.points)} 分` : '前8直通区';
    } else if (eighth) {
      const gap = Math.max(0, eighth.points - after.points);
      lineNote = gap === 0 ? '与前8同分' : `距前8 ${gap} 分`;
    }
  } else if (rankAfter === 1 && simRows[1]) {
    const gap = Math.max(0, after.points - simRows[1].points);
    lineNote = gap === 0 ? '与第2同分领跑' : `领先第2名 ${gap} 分`;
  } else if (rankAfter <= DOMESTIC_ZONES.top && leader) {
    const gap = Math.max(0, leader.points - after.points);
    lineNote = gap === 0 ? '与榜首同分' : `距榜首 ${gap} 分`;
  } else if (rankAfter > total - DOMESTIC_ZONES.bottom && simRows[total - DOMESTIC_ZONES.bottom - 1]) {
    const safe = simRows[total - DOMESTIC_ZONES.bottom - 1];
    const gap = Math.max(0, safe.points - after.points);
    lineNote = gap === 0 ? '与安全区同分' : `距安全区 ${gap} 分`;
  } else if (simRows[DOMESTIC_ZONES.top - 1]) {
    const fourth = simRows[DOMESTIC_ZONES.top - 1];
    const gap = Math.max(0, fourth.points - after.points);
    lineNote = gap === 0 ? '与前四同分' : `距前四 ${gap} 分`;
  }

  return {
    teamId,
    rankBefore,
    rankAfter,
    rankDelta,
    pointsBefore: before ? before.points : 0,
    pointsAfter: after.points,
    pointsDelta,
    zoneKey: after.zoneKey,
    zoneLabel: after.zoneLabel,
    zoneChanged,
    lineNote
  };
}

function isNearKeyBoundary(rank, total, isUcl) {
  if (!Number.isFinite(rank)) return false;
  if (isUcl) {
    return (rank >= 1 && rank <= 10) || (rank >= 22 && rank <= 27);
  }
  return rank <= 6 || (total > 0 && rank >= total - 5);
}

/**
 * 找出同联赛未来 7 天内直接竞争对手（排名相近且同处关键分区）的关联焦点场次，至多 1 场。
 */
export function findLinkedCompetitors(match, baseTable, allFixtures = null, opts = {}) {
  if (!match || !baseTable?.supported || !baseTable.rows?.length) return null;
  const nowTs = Number.isFinite(opts.nowTs) ? opts.nowTs : Date.now();
  const fixtures = allFixtures || getFixtures();
  const isUcl = match.l === 'UCL';
  const total = baseTable.rows.length;

  const homeRow = baseTable.rows.find(r => r.teamId === match.h) || null;
  const awayRow = baseTable.rows.find(r => r.teamId === match.a) || null;
  const anchors = [homeRow, awayRow].filter(
    r => r && isNearKeyBoundary(r.rank, total, isUcl)
  );
  if (!anchors.length) return null;

  const rankOf = new Map(baseTable.rows.map(r => [r.teamId, r.rank]));
  const windowEnd = nowTs + 7 * DAY_MS;
  let best = null;

  for (const cand of fixtures || []) {
    if (!cand || cand.id === match.id || cand.l !== match.l) continue;
    if (cand.st !== 'sched' || cand.tbd) continue;
    if (cand.h === match.h || cand.h === match.a || cand.a === match.h || cand.a === match.a) {
      continue;
    }
    const kick = ts(cand.t);
    if (!Number.isFinite(kick) || kick < nowTs || kick > windowEnd) continue;

    const rH = rankOf.get(cand.h);
    const rA = rankOf.get(cand.a);
    let minGap = Infinity;
    let focusTeamId = null;

    for (const anchor of anchors) {
      if (Number.isFinite(rH)) {
        const g = Math.abs(rH - anchor.rank);
        if (g <= 2 && g < minGap) {
          minGap = g;
          focusTeamId = cand.h;
        }
      }
      if (Number.isFinite(rA)) {
        const g = Math.abs(rA - anchor.rank);
        if (g <= 2 && g < minGap) {
          minGap = g;
          focusTeamId = cand.a;
        }
      }
    }

    if (focusTeamId && (!best || minGap < best.gap || (minGap === best.gap && kick < best.kick))) {
      best = {
        id: cand.id,
        h: cand.h,
        a: cand.a,
        t: cand.t,
        l: cand.l,
        focusTeamId,
        gap: minGap,
        kick
      };
    }
  }

  return best
    ? { id: best.id, h: best.h, a: best.a, t: best.t, l: best.l, focusTeamId: best.focusTeamId }
    : null;
}

/**
 * 按假设赛果对积分榜做一次性确定性推演。
 *
 * @param {object} match
 * @param {'none'|'home'|'draw'|'away'} outcome
 * @param {Array|null} [allFixtures]
 * @param {{nowTs?: number, excludeIds?: Set<string>}} [opts]
 */
export function simulateMatchStandings(match, outcome = SANDBOX_OUTCOME.NONE, allFixtures = null, opts = {}) {
  const fixtures = allFixtures || getFixtures();
  const nowTs = Number.isFinite(opts.nowTs) ? opts.nowTs : Date.now();
  const excludeIds = opts.excludeIds || null;

  if (!canSimulateMatch(match)) {
    return {
      supported: false,
      outcome: SANDBOX_OUTCOME.NONE,
      baseTable: null,
      table: null,
      homeDelta: null,
      awayDelta: null,
      linkedMatch: null,
      disclaimer: SANDBOX_DISCLAIMER
    };
  }

  const baseTable = computeStandings(match.l, fixtures, { asOfTs: nowTs, excludeIds });
  const virtualScore = scoreForOutcome(outcome);
  const isUcl = match.l === 'UCL';

  if (!virtualScore || !baseTable.supported) {
    return {
      supported: baseTable.supported,
      outcome: SANDBOX_OUTCOME.NONE,
      baseTable,
      table: baseTable,
      homeDelta: summarizeTeamDelta(match.h, baseTable.rows, baseTable.rows, isUcl),
      awayDelta: summarizeTeamDelta(match.a, baseTable.rows, baseTable.rows, isUcl),
      linkedMatch: findLinkedCompetitors(match, baseTable, fixtures, { nowTs }),
      disclaimer: SANDBOX_DISCLAIMER
    };
  }

  // 只保留截至 nowTs 已真实完赛的同联赛场次，再额外加入虚拟完赛的当前场，
  // 从而避免未来其他未赛场次因抬高 asOfTs 而泄漏进沙盘。
  const baseEligible = (fixtures || []).filter(item => {
    if (!item || item.id === match.id || item.l !== match.l) return false;
    if (!isFinished(item) || !item.sc) return false;
    const kick = ts(item.t);
    return Number.isFinite(kick) && kick + MATCH_DURATION_MS <= nowTs;
  });

  const matchKick = ts(match.t);
  const simAsOf = Number.isFinite(matchKick)
    ? Math.max(nowTs, matchKick + MATCH_DURATION_MS + 1)
    : nowTs;

  const simMatch = {
    ...match,
    t: Number.isFinite(matchKick) ? match.t : '2026-08-01T00:00',
    st: 'done',
    sc: virtualScore
  };

  const simExcludeIds = excludeIds && excludeIds.size ? new Set(excludeIds) : null;
  if (simExcludeIds) simExcludeIds.delete(match.id);

  const table = computeStandings(match.l, [...baseEligible, simMatch], {
    asOfTs: simAsOf,
    excludeIds: simExcludeIds
  });

  return {
    supported: true,
    outcome,
    baseTable,
    table,
    homeDelta: summarizeTeamDelta(match.h, baseTable.rows, table.rows, isUcl),
    awayDelta: summarizeTeamDelta(match.a, baseTable.rows, table.rows, isUcl),
    linkedMatch: findLinkedCompetitors(match, baseTable, fixtures, { nowTs }),
    disclaimer: SANDBOX_DISCLAIMER
  };
}
