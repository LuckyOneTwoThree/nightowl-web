/**
 * 赛前动态背景提取（桌面 / 手机共用纯函数）
 *
 * 从本地真实积分榜（standings.js）与近期战绩（stats.js）提炼高价值赛前看点：
 *   - 榜首争冠直接对话（#1/#2 或前 3 且分差 ≤3）
 *   - 欧冠区 / 欧冠前八直通卡位战
 *   - 欧冠晋级线（第 8 / 第 24 名线附近）卡位战
 *   - 国内联赛保级六分战（后 4 名且分差 ≤4）
 *   - 双方近期势头火热 / 连胜检验（近 5 场高胜率或 4+ 连胜对前 6）
 *
 * 铁律：只用本地真实已完成赛果，受开球时点与 excludeIds 防剧透截断；
 * 赛季初样本不足（国内 <5 场、欧冠 <3 场）时不制造虚高标签。
 */

import { getFixtures, teamName } from '../data/index.js';
import { computeStandings, STANDINGS_LEAGUES, standingsCutoff, UCL_LEAGUE_PHASE_MAX_ROUND } from './standings.js';
import { computeTeamForm } from './stats.js';

function summarizeForm(entries) {
  let wins = 0;
  let points = 0;
  let winStreak = 0;
  let streakOpen = true;
  for (const item of entries || []) {
    if (item.result === 'W') {
      wins += 1;
      points += 3;
      if (streakOpen) winStreak += 1;
    } else if (item.result === 'D') {
      points += 1;
      streakOpen = false;
    } else {
      streakOpen = false;
    }
  }
  return { count: (entries || []).length, wins, points, winStreak };
}

function getLeagueTable(match, fixtures, opts) {
  if (!match || !STANDINGS_LEAGUES.includes(match.l)) return null;
  if (match.l === 'UCL' && Number(match.r) > UCL_LEAGUE_PHASE_MAX_ROUND) return null;

  const asOfTs = standingsCutoff(match, opts.nowTs);
  const excludeIds = opts.excludeIds || null;
  const cache = opts.standingsCache;
  if (cache && !excludeIds?.size) {
    const key = `${match.l}|${asOfTs}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = computeStandings(match.l, fixtures, { asOfTs });
      cache.set(key, hit);
    }
    return hit;
  }
  return computeStandings(match.l, fixtures, { asOfTs, excludeIds });
}

/**
 * 计算单场比赛的动态积分/状态背景；样本不足或无明显看点返回 null。
 *
 * @param {object} match
 * @param {Array|null} [allFixtures]
 * @param {{nowTs?: number, excludeIds?: Set<string>, standingsCache?: Map}} [opts]
 */
export function computeMatchStakes(match, allFixtures = null, opts = {}) {
  if (!match || !match.h || !match.a) return null;
  const fixtures = allFixtures || getFixtures();
  if (!Array.isArray(fixtures) || fixtures.length === 0) return null;

  const table = getLeagueTable(match, fixtures, opts);
  if (!table || !table.supported || !table.rows.length) return null;

  const homeRow = table.rows.find(r => r.teamId === match.h) || null;
  const awayRow = table.rows.find(r => r.teamId === match.a) || null;
  if (!homeRow || !awayRow) return null;

  const homePos = homeRow.rank;
  const awayPos = awayRow.rank;
  const totalTeams = table.rows.length;
  const minPlayed = match.l === 'UCL' ? 3 : 5;
  const hasTableSample = homeRow.played >= minPlayed && awayRow.played >= minPlayed;
  if (!hasTableSample) return null;

  const ptsDiff = Math.abs(homeRow.points - awayRow.points);

  // 1. 榜首争冠直接对话（国内联赛）
  if (match.l !== 'UCL' && ((homePos <= 2 && awayPos <= 2) || (homePos <= 3 && awayPos <= 3 && ptsDiff <= 3))) {
    return {
      kind: 'title-clash',
      label: '榜首卡位',
      headline: `积分榜 #${homePos} 与 #${awayPos} 直接对话（差 ${ptsDiff} 分）`,
      driverLabel: '榜首争冠直接对话',
      starFloor: 3,
      pointsDelta: ptsDiff,
      homePos,
      awayPos
    };
  }

  // 2. 前四 / 欧冠区 / 欧冠前八直通区直接对话
  if (
    (match.l !== 'UCL' && homePos <= 5 && awayPos <= 5) ||
    (match.l === 'UCL' && homePos <= 8 && awayPos <= 8)
  ) {
    return {
      kind: 'top-zone-clash',
      label: match.l === 'UCL' ? '前八直通卡位' : '欧冠区卡位',
      headline:
        match.l === 'UCL'
          ? `欧冠前八直通区直接对话（#${homePos} vs #${awayPos}）`
          : `积分榜前五卡位战（#${homePos} vs #${awayPos}，差 ${ptsDiff} 分）`,
      driverLabel: match.l === 'UCL' ? '欧冠前八卡位' : '前四欧冠区卡位',
      starFloor: 2,
      pointsDelta: ptsDiff,
      homePos,
      awayPos
    };
  }

  // 3. 欧冠晋级线（第 8 名 / 第 24 名线附近）卡位
  if (
    match.l === 'UCL' &&
    ptsDiff <= 3 &&
    ((homePos >= 6 && homePos <= 12 && awayPos >= 6 && awayPos <= 12) ||
      (homePos >= 20 && homePos <= 26 && awayPos >= 20 && awayPos <= 26))
  ) {
    return {
      kind: 'ucl-cutoff-clash',
      label: '晋级线卡位',
      headline: `欧冠晋级线卡位战（#${homePos} vs #${awayPos}，差 ${ptsDiff} 分）`,
      driverLabel: '欧冠晋级线卡位',
      starFloor: 2,
      pointsDelta: ptsDiff,
      homePos,
      awayPos
    };
  }

  // 4. 保级六分战（国内联赛后期样本 ≥8 场）
  if (
    match.l !== 'UCL' &&
    totalTeams >= 18 &&
    homeRow.played >= 8 &&
    awayRow.played >= 8 &&
    homePos >= totalTeams - 3 &&
    awayPos >= totalTeams - 3 &&
    ptsDiff <= 4
  ) {
    return {
      kind: 'relegation-clash',
      label: '保级六分战',
      headline: `保级区直接对话（#${homePos} vs #${awayPos}，差 ${ptsDiff} 分）`,
      driverLabel: '保级区直接对话',
      starFloor: 2,
      pointsDelta: ptsDiff,
      homePos,
      awayPos
    };
  }

  // 5. 近期连胜 / 火热状态碰撞
  const homeForm = summarizeForm(
    computeTeamForm(match.h, match, fixtures, 5, { excludeIds: opts.excludeIds })
  );
  const awayForm = summarizeForm(
    computeTeamForm(match.a, match, fixtures, 5, { excludeIds: opts.excludeIds })
  );

  if (
    homeForm.count >= 4 &&
    awayForm.count >= 4 &&
    ((homeForm.points >= 10 && awayForm.points >= 10) ||
      (homeForm.winStreak >= 4 && awayPos <= 6) ||
      (awayForm.winStreak >= 4 && homePos <= 6))
  ) {
    const bothHot = homeForm.points >= 10 && awayForm.points >= 10;
    return {
      kind: 'hot-form-clash',
      label: '近期势头正盛',
      headline: bothHot
        ? `双方近 5 场状态火热（${teamName(match.h)} ${homeForm.wins}胜 / ${teamName(match.a)} ${awayForm.wins}胜）`
        : `近期连胜势头检验（#${homePos} vs #${awayPos}）`,
      driverLabel: '近期势头火热',
      starFloor: 2,
      pointsDelta: ptsDiff,
      homePos,
      awayPos
    };
  }

  return null;
}
