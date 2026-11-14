/**
 * 14 天跨周「魔鬼赛程预警」雷达（桌面 / 手机共用纯函数）
 *
 * 逻辑说明：
 *   - 在 [nowTs, nowTs + 14 天] 内，按关注球队扫描尚未开赛且时间确定的场次；
 *   - 以 10 天连续滑动窗口寻找赛程最密集区段：当窗口内比赛数 >= 2 且至少包含 1 场 S3/S4 或星级 >= 2 时预警；
 *   - 同时诚实统计被排除在算法外的 tbd 待定场次数量（tbdSkipped），绝不拿占位时间充数。
 */

import { evaluate, tierOf, ts } from './engine.js';
import { REC_MAP, rivalries, storylines } from '../data/index.js';

export const CRUNCH_LOOKAHEAD_DAYS = 14;
export const CRUNCH_WINDOW_DAYS = 10;

const DAY_MS = 86400000;
const BJ_OFFSET_MS = 8 * 3600000;

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function dateStrOfTs(ms) {
  const d = new Date(ms + BJ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 扫描未来 14 天关注球队的魔鬼赛程拥堵段
 *
 * @param {string[]} followedTeams
 * @param {Array<object>} fixtures
 * @param {number} [nowTs=Date.now()]
 * @param {{recMap?: object, rivalries?: Array, storylines?: Array, followedLeagues?: string[]}} [opts]
 */
export function detectCrunchPeriods(followedTeams = [], fixtures = [], nowTs = Date.now(), opts = {}) {
  const teams = [...new Set((Array.isArray(followedTeams) ? followedTeams : []).filter(Boolean))];
  if (teams.length === 0 || !Array.isArray(fixtures) || fixtures.length === 0) {
    return { alerts: [], totalTbdSkipped: 0 };
  }

  const endHorizonTs = nowTs + CRUNCH_LOOKAHEAD_DAYS * DAY_MS;
  const windowMs = CRUNCH_WINDOW_DAYS * DAY_MS;
  const recMap = opts.recMap || REC_MAP;
  const rivList = opts.rivalries || rivalries;
  const storyList = opts.storylines || storylines;
  const followedLeagues = Array.isArray(opts.followedLeagues) ? opts.followedLeagues : [];

  const alerts = [];
  let totalTbdSkipped = 0;

  for (const teamId of teams) {
    const confirmed = [];
    let tbdSkipped = 0;

    for (const m of fixtures) {
      if (!m || m.st !== 'sched') continue;
      if (m.h !== teamId && m.a !== teamId) continue;

      const kickTs = ts(m.t);
      if (m.tbd) {
        if (!Number.isFinite(kickTs) || (kickTs >= nowTs && kickTs <= endHorizonTs)) {
          tbdSkipped += 1;
        }
        continue;
      }

      if (!Number.isFinite(kickTs) || kickTs < nowTs || kickTs > endHorizonTs) continue;
      confirmed.push({ match: m, kickTs });
    }

    totalTbdSkipped += tbdSkipped;
    if (confirmed.length < 2) continue;

    confirmed.sort((a, b) => a.kickTs - b.kickTs);

    // 10 天滑动窗口：寻找（重头戏+夜猫档位最强、总场次最多）的最佳预警窗口
    let bestWindow = null;
    for (let i = 0; i < confirmed.length; i += 1) {
      const startTs = confirmed[i].kickTs;
      const slice = [];
      for (let j = i; j < confirmed.length; j += 1) {
        if (confirmed[j].kickTs - startTs <= windowMs) {
          slice.push(confirmed[j]);
        } else {
          break;
        }
      }
      if (slice.length < 2) continue;

      let nightCount = 0;
      let maxTierNum = 0;
      let maxTier = 'S0';
      let hasStar = false;

      for (const item of slice) {
        const tier = tierOf(item.match);
        if (tier.tier >= 3) nightCount += 1;
        if (tier.tier > maxTierNum) {
          maxTierNum = tier.tier;
          maxTier = tier.label;
        }
        const ev = evaluate(item.match, recMap, rivList, storyList, teams, followedLeagues);
        if ((ev?.star || 0) >= 2) hasStar = true;
      }

      const qualifies = nightCount >= 1 || hasStar;
      if (!qualifies) continue;

      if (
        !bestWindow ||
        slice.length > bestWindow.matchCount ||
        (slice.length === bestWindow.matchCount && nightCount > bestWindow.nightCount) ||
        (slice.length === bestWindow.matchCount &&
          nightCount === bestWindow.nightCount &&
          maxTierNum > bestWindow.maxTierNum)
      ) {
        bestWindow = {
          teamId,
          windowDays: CRUNCH_WINDOW_DAYS,
          startDate: dateStrOfTs(slice[0].kickTs),
          endDate: dateStrOfTs(slice[slice.length - 1].kickTs),
          matchCount: slice.length,
          nightCount,
          maxTier,
          maxTierNum,
          highlightedIds: slice.map(s => s.match.id),
          tbdSkipped
        };
      }
    }

    if (bestWindow) {
      const { maxTierNum: _ignored, ...cleanAlert } = bestWindow;
      alerts.push(cleanAlert);
    }
  }

  alerts.sort((a, b) => b.matchCount - a.matchCount || b.nightCount - a.nightCount);
  return { alerts, totalTbdSkipped };
}
