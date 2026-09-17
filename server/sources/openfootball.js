/**
 * 比分源适配器 · openfootball/football.json（副源）
 *
 * 特点：完全免费、无需密钥、托管在 GitHub raw，**实测稳定**（不受 ESPN 那条通道影响）。
 *       覆盖五大联赛，且场次数与本项目 fixtures 完全吻合
 *       （en.1 380 / es.1 380 / it.1 380 / de.1 306 / fr.1 306）。
 *       **整季一个文件** —— 这是它相对 ESPN（按日分块）的核心优势：
 *       tbd 占位轮次整轮共用一个占位日，ESPN 按日查询会漏掉非占位日的场次，
 *       而本源一次请求拿全季，能补齐那些被漏掉的真实开球时间。
 *
 * 时间口径（已修正）：
 *   数据给的是**联赛所在地的当地墙钟**（date + time 不带时区）。此前直接当北京墙钟用
 *   会偏移 6~7 小时，于是被标为 kickoffTrusted: false，开球时间从未被采信。
 *   现在经 tz.mjs 的「联赛偏移 + 欧洲夏令时」换算为北京墙钟，并**升级为可信时间源**
 *   （与 ESPN 交叉验证 0 偏差，见 tools/verify-openfootball-tz.mjs）。
 *
 * 剩余局限：
 *   1. 更新有滞后（社区维护），比分不如 ESPN 及时。
 *   2. 无欧冠。
 *
 * 数据形状：
 *   { name, matches: [ { round, date:'2026-08-21', time:'20:00',
 *                        team1:'Arsenal FC', team2:'Coventry City FC',
 *                        score:{ ht:[2,0], ft:[3,0] } } ] }
 */

import { buildNameIndex, loadTeams, resolveByName, fetchJSON } from './normalize.js';
import { localToBeijingWall } from './tz.mjs';

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

    // openfootball 对未公布时间的场次只给 date、不给 time（实测德甲 261/306 场如此）。
    // 此时 kickoff 为 null、不可信 —— 宁可保持 tbd，也不造一个假时刻（见 tz.mjs 注释）。
    const hasTime = typeof m.time === 'string' && /^\d{1,2}:\d{2}/.test(m.time);

    out.push({
      league,
      homeId,
      awayId,
      // 当地墙钟 → 北京墙钟（联赛偏移 + 欧洲夏令时）。
      // 换算正确性已与 ESPN 交叉验证（tools/verify-openfootball-tz.mjs），
      // 有 time 的场次升级为可信时间源 —— 这是清除 tbd 占位的关键一环。
      kickoff: hasTime ? localToBeijingWall(m.date, m.time, league) : null,
      kickoffTrusted: hasTime,
      state: done ? 'done' : 'sched',
      homeScore: done ? String(ft[0]) : null,
      awayScore: done ? String(ft[1]) : null,
      source: id,
      raw: { round: m.round, date: m.date, time: m.time }
    });
  }
  return out;
}
