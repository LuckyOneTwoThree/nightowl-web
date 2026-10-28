import { getFixtures } from '../data/index.js';
import { isFinished, MATCH_DURATION_MS, ts } from './engine.js';

/**
 * 解析比赛时间为时间戳
 * 北京墙钟串必须走 ts()（纯 UTC 算术，见 engine.js 时区铁律）；
 * Date.parse 会按本机时区解释无后缀串，在非 UTC+8 / 夏令时设备上偏差最多 8 小时
 */
function parseTime(t) {
  return t ? ts(t) : 0;
}

/**
 * 查看一场已完赛比赛时，只有「在该场开球前已经结束」的赛果才算已知。
 *
 * 只看开球时间不够：20:00 开球、20:30 查看时，那场其实还在踢，
 * 终场比分不能在 20:30 的视图里出现。用开球 + 120min 作为完赛近似。
 * 未赛/进行中/时间待定的当前比赛，所有 done 赛果都已经是已知历史。
 */
function knownByTs(currentMatch) {
  if (!currentMatch?.t) return Infinity;
  if (!isFinished(currentMatch)) return Infinity;
  const kick = parseTime(currentMatch.t);
  return Number.isFinite(kick) ? kick : Infinity;
}

/**
 * 计算某支球队在指定比赛时间节点前的近 N 场战绩走势（Form Guide）
 * 严格依据 fixtures.json 中的已完赛场次，杜绝虚构数据
 *
 * @param {string} teamId - 球队三字码（如 MCI, RMA）
 * @param {object} currentMatch - 当前选中的比赛对象
 * @param {Array} allFixtures - 全量赛程数据
 * @param {number} limit - 返回的最大场次数（默认 5）
 * @returns {Array} 近期走势列表
 */
export function computeTeamForm(teamId, currentMatch, allFixtures = null, limit = 5, opts = {}) {
  allFixtures = allFixtures || getFixtures();
  if (!teamId) return [];
  const excludeIds = opts.excludeIds || null;

  const knownTs = knownByTs(currentMatch);

  // 只取「当前比赛开球时已经结束」的场次：开球早但还没终场的比赛不能算已知
  const teamDoneMatches = allFixtures.filter(
    m =>
      (m.h === teamId || m.a === teamId) &&
      m.st === 'done' &&
      m.sc &&
      m.id !== currentMatch?.id &&
      !(excludeIds && excludeIds.has(m.id)) &&
      parseTime(m.t) + MATCH_DURATION_MS <= knownTs
  );

  // 按时间倒序排序（最近的在最前）
  teamDoneMatches.sort((a, b) => parseTime(b.t) - parseTime(a.t));

  return teamDoneMatches.slice(0, limit).map(m => {
    const parts = m.sc.split('-').map(s => parseInt(s.trim(), 10));
    const hScore = isNaN(parts[0]) ? 0 : parts[0];
    const aScore = isNaN(parts[1]) ? 0 : parts[1];

    const isHome = m.h === teamId;
    const opponent = isHome ? m.a : m.h;
    const teamScore = isHome ? hScore : aScore;
    const oppScore = isHome ? aScore : hScore;

    let result = 'D'; // 平
    if (teamScore > oppScore) result = 'W'; // 胜
    else if (teamScore < oppScore) result = 'L'; // 负

    return {
      matchId: m.id,
      league: m.l,
      round: m.r,
      date: m.t,
      opponent,
      isHome,
      teamScore,
      oppScore,
      score: m.sc,
      result
    };
  });
}

/**
 * 计算球队在某项赛事（联赛）中的赛季真实攻防统计
 *
 * @param {string} teamId - 球队 ID
 * @param {string} leagueCode - 联赛编码（如 PL, PD）
 * @param {Array} allFixtures - 全量赛程
 */
export function computeSeasonStats(teamId, leagueCode, allFixtures = null, cutoffTs = Infinity, opts = {}) {
  allFixtures = allFixtures || getFixtures();
  const excludeIds = opts.excludeIds || null;
  if (!teamId) {
    return {
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      cleanSheets: 0,
      avgGoalsFor: '0.0',
      avgGoalsAgainst: '0.0',
      winRate: 0,
      home: { played: 0, wins: 0, draws: 0, losses: 0 },
      away: { played: 0, wins: 0, draws: 0, losses: 0 }
    };
  }

  const leagueMatches = allFixtures.filter(
    m =>
      (m.h === teamId || m.a === teamId) &&
      m.l === leagueCode &&
      m.st === 'done' &&
      m.sc &&
      !(excludeIds && excludeIds.has(m.id)) &&
      parseTime(m.t) + MATCH_DURATION_MS <= cutoffTs
  );

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let cleanSheets = 0;

  const home = { played: 0, wins: 0, draws: 0, losses: 0 };
  const away = { played: 0, wins: 0, draws: 0, losses: 0 };

  for (const m of leagueMatches) {
    const parts = m.sc.split('-').map(s => parseInt(s.trim(), 10));
    const hSc = isNaN(parts[0]) ? 0 : parts[0];
    const aSc = isNaN(parts[1]) ? 0 : parts[1];

    const isHome = m.h === teamId;
    const teamSc = isHome ? hSc : aSc;
    const oppSc = isHome ? aSc : hSc;

    goalsFor += teamSc;
    goalsAgainst += oppSc;
    if (oppSc === 0) cleanSheets += 1;

    const sub = isHome ? home : away;
    sub.played += 1;

    if (teamSc > oppSc) {
      wins += 1;
      sub.wins += 1;
    } else if (teamSc === oppSc) {
      draws += 1;
      sub.draws += 1;
    } else {
      losses += 1;
      sub.losses += 1;
    }
  }

  const played = leagueMatches.length;
  const goalDiff = goalsFor - goalsAgainst;
  const avgGoalsFor = played > 0 ? (goalsFor / played).toFixed(1) : '0.0';
  const avgGoalsAgainst = played > 0 ? (goalsAgainst / played).toFixed(1) : '0.0';
  const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;

  return {
    played,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDiff,
    cleanSheets,
    avgGoalsFor,
    avgGoalsAgainst,
    winRate,
    home,
    away
  };
}

/**
 * 计算两队在数据集中的直接交手记录（Head to Head）
 *
 * 口径与 computeTeamForm 一致：传入 currentMatch 时，只算在它**开球前已经结束**、
 * 且不含它自身的交手。只看开球时间会把「先开球、后终场」的赛果提前透出来。
 *
 * @param {object|null} currentMatch 当前查看的比赛；为空表示不限时间
 * @param {number} limit 最多返回几场（按时间倒序）
 */
export function computeHeadToHead(team1, team2, allFixtures = null, currentMatch = null, limit = 5, opts = {}) {
  allFixtures = allFixtures || getFixtures();
  const excludeIds = opts.excludeIds || null;
  if (!team1 || !team2) return { meetings: [], summary: { t1Wins: 0, draws: 0, t2Wins: 0, total: 0 } };

  const cutoff = knownByTs(currentMatch);

  const meetings = allFixtures
    .filter(
      m =>
        ((m.h === team1 && m.a === team2) || (m.h === team2 && m.a === team1)) &&
        m.st === 'done' &&
        m.sc &&
        m.id !== currentMatch?.id &&
        !(excludeIds && excludeIds.has(m.id)) &&
        parseTime(m.t) + MATCH_DURATION_MS <= cutoff
    )
    .sort((a, b) => parseTime(b.t) - parseTime(a.t));

  let t1Wins = 0;
  let draws = 0;
  let t2Wins = 0;

  const list = meetings.slice(0, limit).map(m => {
    const parts = m.sc.split('-').map(s => parseInt(s.trim(), 10));
    const hSc = isNaN(parts[0]) ? 0 : parts[0];
    const aSc = isNaN(parts[1]) ? 0 : parts[1];

    const team1IsHome = m.h === team1;
    const t1Score = team1IsHome ? hSc : aSc;
    const t2Score = team1IsHome ? aSc : hSc;

    if (t1Score > t2Score) t1Wins += 1;
    else if (t1Score === t2Score) draws += 1;
    else t2Wins += 1;

    return {
      id: m.id,
      date: m.t,
      league: m.l,
      round: m.r,
      home: m.h,
      away: m.a,
      score: m.sc,
      t1Score,
      t2Score
    };
  });

  return {
    meetings: list,
    summary: {
      t1Wins,
      draws,
      t2Wins,
      total: list.length
    }
  };
}

/**
 * 整合当前比赛双方的全部真实数据
 */
export function computeMatchStats(match, allFixtures = null, opts = {}) {
  allFixtures = allFixtures || getFixtures();
  if (!match) return null;

  const excludeIds = opts.excludeIds || null;
  const cutoff = knownByTs(match);
  return {
    home: {
      id: match.h,
      form: computeTeamForm(match.h, match, allFixtures, 5, { excludeIds }),
      season: computeSeasonStats(match.h, match.l, allFixtures, cutoff, { excludeIds })
    },
    away: {
      id: match.a,
      form: computeTeamForm(match.a, match, allFixtures, 5, { excludeIds }),
      season: computeSeasonStats(match.a, match.l, allFixtures, cutoff, { excludeIds })
    },
    h2h: computeHeadToHead(match.h, match.a, allFixtures, match, 5, { excludeIds })
  };
}
