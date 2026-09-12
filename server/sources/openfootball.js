/**
 * 比分源适配器 · openfootball/football.json（副源）
 *
 * 特点：完全免费、无需密钥、托管在 GitHub raw，**实测稳定**（不受 ESPN 那条通道影响）。
 *       覆盖五大联赛，且场次数与本项目 fixtures 完全吻合
 *       （en.1 380 / es.1 380 / it.1 380 / de.1 306 / fr.1 306）。
 *
 * 局限（必须显式处理，否则会引入静默错误）：
 *   1. **只给本地开球时间，不带时区**（`date` + `time` 是当地墙钟）。
 *      本项目的时间口径是「北京墙钟」，直接拿它当开球时间去写，会整体偏移。
 *      → 因此本适配器标记 `kickoffTrusted: false`，**合并时只取比分、不取时间**。
 *   2. 更新有滞后（社区维护），比分不如 ESPN 及时。
 *   3. 无欧冠。
 *
 * 数据形状：
 *   { name, matches: [ { round, date:'2026-08-21', time:'20:00',
 *                        team1:'Arsenal FC', team2:'Coventry City FC',
 *                        score:{ ht:[2,0], ft:[3,0] } } ] }
 */

import { buildNameIndex, loadTeams, resolveByName, localPartsToWall, fetchJSON } from './normalize.js';

export const id = 'openfootball';
export const label = 'openfootball';
export const priority = 2;

/** openfootball 的文件名 ↔ 我们的联赛码 */
export const LEAGUES = {
  PL: 'en.1',
  PD: 'es.1',
  SA: 'it.1',
  BL: 'de.1',
  FL: 'fr.1'
};

const RAW_BASE = 'https://raw.githubusercontent.com/openfootball/football.json/master';

let idxCache = null;
function indexes() {
  if (!idxCache) idxCache = { nameIndex: buildNameIndex(loadTeams()) };
  return idxCache;
}

/** 记录未能解析的名称，供健康检查报告（不猜，暴露出来） */
export const unresolvedNames = new Map();

export async function fetchLeague(league, season = '2026-27', opts = {}) {
  const file = LEAGUES[league];
  if (!file) return [];

  const url = `${RAW_BASE}/${season}/${file}.json`;
  const j = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 20000, log: opts.log });
  const { nameIndex } = indexes();

  const out = [];
  for (const m of j.matches || []) {
    const homeId = resolveByName(m.team1, league, nameIndex);
    const awayId = resolveByName(m.team2, league, nameIndex);

    if (!homeId) unresolvedNames.set(`${league}|${m.team1}`, m.team1);
    if (!awayId) unresolvedNames.set(`${league}|${m.team2}`, m.team2);
    if (!homeId || !awayId) continue;

    const ft = m.score?.ft;
    const done = Array.isArray(ft) && ft.length === 2;

    out.push({
      league,
      homeId,
      awayId,
      // ⚠️ 本地墙钟、非北京墙钟 —— kickoffTrusted=false，合并时不会用它覆盖开球时间
      kickoff: localPartsToWall(m.date, m.time),
      kickoffTrusted: false,
      state: done ? 'done' : 'sched',
      homeScore: done ? String(ft[0]) : null,
      awayScore: done ? String(ft[1]) : null,
      source: id,
      raw: { round: m.round, date: m.date, time: m.time }
    });
  }
  return out;
}
