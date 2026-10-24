/**
 * 联赛积分榜（只读）
 *
 * 唯一数据源：本地 fixtures 的已完赛场次，不请求外部接口，不做概率推断。
 *
 * 口径：
 *   · 已完赛场次按**本场开球时点**截止，避免查看旧比赛时把之后的结果透出来
 *   · UCL 只算联赛阶段 r1–8；SCG 是一次性超级杯，不提供积分榜
 *   · 同分按积分 → 净胜球 → 进球数 → 球队 ID 简化排序，UI 必须标注
 *   · 国内前四/后三名是参考线，不代表官方资格规则
 */

import { getFixtures } from '../data/index.js';
import { isFinished, MATCH_DURATION_MS, ts } from './engine.js';

export const STANDINGS_LEAGUES = ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL'];

export const UCL_LEAGUE_PHASE_MAX_ROUND = 8;

export const UCL_ZONES = { direct: 8, playoff: 24, total: 36 };

export const DOMESTIC_ZONES = { top: 4, bottom: 3 };

export const TIEBREAKER_NOTE =
  '同分按净胜球、进球数排序；未实现各国联赛/欧足联的完整同分规则。';

function parseScore(sc) {
  if (typeof sc !== 'string') return null;
  const parts = sc.split('-').map(s => parseInt(s.trim(), 10));
  if (parts.length !== 2 || parts.some(n => !Number.isFinite(n))) return null;
  return { h: parts[0], a: parts[1] };
}

function ensureRow(map, teamId) {
  let row = map.get(teamId);
  if (!row) {
    row = {
      teamId,
      rank: 0,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0
    };
    map.set(teamId, row);
  }
  return row;
}

function zoneFor(league, rank, total) {
  if (league === 'UCL') {
    if (rank <= UCL_ZONES.direct) {
      return { zoneKey: 'ucl-direct', zoneLabel: '前8直通', zoneTone: 'neutral' };
    }
    if (rank <= UCL_ZONES.playoff) {
      return { zoneKey: 'ucl-playoff', zoneLabel: '附加赛区', zoneTone: 'warn' };
    }
    return { zoneKey: 'ucl-out', zoneLabel: '出局区', zoneTone: 'warn' };
  }

  if (rank === 1) {
    return { zoneKey: 'top', zoneLabel: '榜首', zoneTone: 'neutral' };
  }
  if (rank <= DOMESTIC_ZONES.top) {
    return { zoneKey: 'top', zoneLabel: '前四参考线', zoneTone: 'neutral' };
  }
  if (rank > total - DOMESTIC_ZONES.bottom) {
    return { zoneKey: 'bottom', zoneLabel: '后三名风险区', zoneTone: 'warn' };
  }
  return { zoneKey: 'mid', zoneLabel: '中游', zoneTone: 'neutral' };
}

/** 领先/落后文案：0 分时必须写“同分”，不能写“0 分领先” */
function aheadText(gap, label) {
  return gap === 0 ? `与${label}同分` : `领先${label} ${gap} 分`;
}

function behindText(gap, label) {
  return gap === 0 ? `与${label}同分` : `距${label} ${gap} 分`;
}

function contextFor(row, rows, league) {
  if (!row || rows.length === 0) return null;
  const total = rows.length;
  const rank = row.rank;

  if (league === 'UCL') {
    if (rank <= UCL_ZONES.direct) {
      const firstOutside = rows[UCL_ZONES.direct]; // 第 9 名
      const gap = firstOutside ? Math.max(0, row.points - firstOutside.points) : 0;
      return {
        primary: firstOutside ? aheadText(gap, '第9名') : '联赛阶段',
        secondary: ''
      };
    }
    if (rank <= UCL_ZONES.playoff) {
      const eighth = rows[UCL_ZONES.direct - 1];
      const firstOut = rows[UCL_ZONES.playoff]; // 第 25 名
      const topGap = eighth ? Math.max(0, eighth.points - row.points) : 0;
      const bottomGap = firstOut ? Math.max(0, row.points - firstOut.points) : 0;
      return {
        primary: topGap > 0 ? behindText(topGap, '前8') : '与前8同分',
        // 与出局区同分也必须提示，否则“附加赛区”会掩盖保级边缘风险
        secondary: firstOut
          ? bottomGap > 0
            ? aheadText(bottomGap, '出局区')
            : '与出局区同分'
          : ''
      };
    }
    const lastPlayoff = rows[UCL_ZONES.playoff - 1]; // 第 24 名
    const gap = lastPlayoff ? Math.max(0, lastPlayoff.points - row.points) : 0;
    return {
      primary: lastPlayoff ? behindText(gap, '附加赛区') : '联赛阶段',
      secondary: ''
    };
  }

  if (rank === 1) {
    const second = rows[1];
    const gap = second ? Math.max(0, row.points - second.points) : 0;
    return {
      primary: second ? aheadText(gap, '第2名') : '联赛榜首',
      secondary: ''
    };
  }

  if (rank <= DOMESTIC_ZONES.top) {
    const fifth = rows[DOMESTIC_ZONES.top]; // 第 5 名
    const gap = fifth ? Math.max(0, row.points - fifth.points) : 0;
    return {
      primary: fifth ? aheadText(gap, '第5名') : '前四',
      secondary: ''
    };
  }

  if (rank > total - DOMESTIC_ZONES.bottom) {
    const lastSafe = rows[total - DOMESTIC_ZONES.bottom - 1]; // 最后一名安全区球队
    const gap = lastSafe ? Math.max(0, lastSafe.points - row.points) : 0;
    return {
      primary: lastSafe ? behindText(gap, '安全区') : '后三名',
      secondary: ''
    };
  }

  const fourth = rows[DOMESTIC_ZONES.top - 1];
  const firstBottom = rows[total - DOMESTIC_ZONES.bottom];
  const topGap = fourth ? Math.max(0, fourth.points - row.points) : 0;
  const bottomGap = firstBottom ? Math.max(0, row.points - firstBottom.points) : 0;
  return {
    primary: fourth ? behindText(topGap, '前四') : '中游',
    // 中游同时给出“距前四”和“距后三名”两条分差线；后者只描述距离，不写成“领先”
    secondary: firstBottom ? behindText(bottomGap, '后三名') : ''
  };
}

function emptyTable(league, asOfTs, note) {
  return {
    supported: false,
    league,
    asOfTs,
    doneCount: 0,
    excludedCount: 0,
    lastResultAt: null,
    rows: [],
    zones: null,
    tiebreakerNote: TIEBREAKER_NOTE,
    note
  };
}

/**
 * 计算某联赛在 asOfTs 之前的积分榜
 *
 * @param {string} league 联赛编码
 * @param {Array|null} allFixtures 全量赛程；为空时读取运行期 fixtures
 * @param {{asOfTs?: number, excludeIds?: Set<string>}} opts
 *   asOfTs 缺省表示包含全部已完赛；
 *   excludeIds 排除指定场次（防剧透：今晚已完赛但未「揭晓」的场次不得把
 *   积分/净胜球变化透进积分榜）。被排除且本会计入 doneCount 的场次数记入
 *   excludedCount，由 UI 如实标注「已排除 N 场未揭晓」。
 */
export function computeStandings(league, allFixtures = null, opts = {}) {
  const fixtures = allFixtures || getFixtures();
  const supported = STANDINGS_LEAGUES.includes(league);
  const asOfTs = Number.isFinite(opts.asOfTs) ? opts.asOfTs : Infinity;
  const excludeIds = opts.excludeIds || null;
  if (!supported) {
    return emptyTable(league, asOfTs, '该赛事不提供积分榜');
  }

  const rowsById = new Map();
  let doneCount = 0;
  let lastResultAt = null;
  let excludedCount = 0;

  for (const match of fixtures) {
    if (!match || match.l !== league) continue;
    if (!match.h || !match.a) continue;
    if (!isFinished(match) || !match.sc) continue;
    if (
      league === 'UCL' &&
      !(Number(match.r) >= 1 && Number(match.r) <= UCL_LEAGUE_PHASE_MAX_ROUND)
    ) {
      continue;
    }

    const kick = ts(match.t);
    if (!Number.isFinite(kick)) continue;
    // 只有「截止点之前已经结束」的赛果才算已知；先开球、后终场的比赛
    // 不能在旧比赛视图里提前出现。联赛赛制无加时，120min 是保守完赛近似。
    if (kick + MATCH_DURATION_MS > asOfTs) continue;

    // 防剧透排除放在所有「本会计入」过滤之后：excludedCount 只统计
    // 真正影响积分却被隐藏的场次，UI 的「已排除 N 场」才不说谎。
    if (excludeIds && excludeIds.has(match.id)) {
      excludedCount += 1;
      continue;
    }

    const score = parseScore(match.sc);
    if (!score) continue;

    doneCount += 1;
    if (lastResultAt == null || kick > lastResultAt) lastResultAt = kick;

    const home = ensureRow(rowsById, match.h);
    const away = ensureRow(rowsById, match.a);

    home.played += 1;
    away.played += 1;
    home.gf += score.h;
    home.ga += score.a;
    away.gf += score.a;
    away.ga += score.h;

    if (score.h > score.a) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (score.h < score.a) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const rows = [...rowsById.values()]
    .map(row => ({ ...row, gd: row.gf - row.ga }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      const aid = String(a.teamId);
      const bid = String(b.teamId);
      return aid < bid ? -1 : aid > bid ? 1 : 0;
    });

  rows.forEach((row, index) => {
    row.rank = index + 1;
    Object.assign(row, zoneFor(league, row.rank, rows.length));
    row.context = contextFor(row, rows, league);
  });

  return {
    supported: true,
    league,
    asOfTs,
    doneCount,
    excludedCount,
    lastResultAt,
    rows,
    zones: league === 'UCL' ? { ...UCL_ZONES } : { ...DOMESTIC_ZONES },
    tiebreakerNote: TIEBREAKER_NOTE,
    note: rows.length === 0 ? '本联赛暂无已同步赛果' : null
  };
}

/**
 * 截止点：已完赛按开球时点，其余按当前时间
 *
 * 已完赛用开球时点，是为了让「点开一场旧比赛」看到的是当时的榜；
 * computeStandings 再要求赛果在该时点前已经结束，避免把当时仍在进行的比分算进来。
 */
export function standingsCutoff(match, nowTs = Date.now()) {
  const now = Number.isFinite(nowTs) ? nowTs : Date.now();
  if (!match) return now;
  if (isFinished(match)) {
    const kick = ts(match.t);
    if (Number.isFinite(kick)) return kick;
  }
  return now;
}

/**
 * 面向单场比赛的积分榜视图
 *
 * @param {object} match 当前选中的比赛
 * @param {Array|null} allFixtures 全量赛程
 * @param {{nowTs?: number}} opts 当前时间（用于未赛/进行中/时间待定）
 */
export function computeMatchStandings(match, allFixtures = null, opts = {}) {
  const nowTs = Number.isFinite(opts.nowTs) ? opts.nowTs : Date.now();
  if (!match) {
    return {
      ...emptyTable(null, nowTs, '没有选中的比赛'),
      historical: false,
      home: null,
      away: null
    };
  }

  const historical = isFinished(match);
  const asOfTs = standingsCutoff(match, nowTs);
  const supported =
    STANDINGS_LEAGUES.includes(match.l) &&
    !(match.l === 'UCL' && Number(match.r) > UCL_LEAGUE_PHASE_MAX_ROUND);

  if (!supported) {
    return {
      ...emptyTable(
        match.l,
        asOfTs,
        match.l === 'SCG' ? '单场赛事不适用积分榜' : '该阶段暂不提供积分榜'
      ),
      historical,
      home: null,
      away: null
    };
  }

  const table = computeStandings(match.l, allFixtures, { asOfTs });
  const home = table.rows.find(row => row.teamId === match.h) || null;
  const away = table.rows.find(row => row.teamId === match.a) || null;

  return {
    ...table,
    historical,
    home,
    away,
    note: table.rows.length === 0 ? '本联赛暂无已同步赛果' : null
  };
}
