/**
 * 比分源适配器 · ESPN（主源）
 *
 * 特点：字段最全（含真实开球时间、状态、比分），覆盖五大联赛 + 欧冠。
 * 问题：**通道不稳定** —— 同一时段可连续成功数十次请求，随后完全不可达。
 *       故必须配合 `fetchJSON` 的重试 + curl 兜底，且不能作为唯一来源。
 *
 * 域名说明：`site.api.espn.com` 可用；`site.web.api.espn.com` 在本机被网络策略拦截（返回 000）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { utcToBeijingWall, fetchJSON } from './normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALIAS_PATH = resolve(__dirname, '../espn-alias.json');

export const id = 'espn';
export const label = 'ESPN';
export const priority = 1; // 数字越小优先级越高

export const LEAGUES = {
  PL: 'eng.1',
  PD: 'esp.1',
  SA: 'ita.1',
  BL: 'ger.1',
  FL: 'fra.1',
  UCL: 'uefa.champions'
};

let aliasCache = null;
function loadAlias() {
  if (!aliasCache) {
    try {
      aliasCache = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
    } catch {
      aliasCache = { byLeague: {} };
    }
  }
  return aliasCache;
}

/** ESPN 缩写 → 本项目球队 id（走别名表；表里没有则原样返回） */
export function toTeamId(league, abbr) {
  const alias = loadAlias();
  return alias?.byLeague?.[league]?.[abbr] || abbr;
}

/** ESPN 状态 → 统一 state（'in' 归为 live，由上层决定不落库） */
export function mapState(type) {
  const n = String(type?.name || '').toUpperCase();
  if (n.includes('POSTPONED') || n.includes('CANCELED') || n.includes('CANCELLED')) return 'pp';
  const s = String(type?.state || '');
  if (s === 'post' || type?.completed === true) return 'done';
  if (s === 'in') return 'live';
  return 'sched';
}

/** 拉取单个联赛某日期区间的比分板，返回统一事件数组 */
export async function fetchLeague(league, dates, opts = {}) {
  const espnCode = LEAGUES[league];
  if (!espnCode) return [];

  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnCode}/scoreboard?dates=${dates}&limit=300`;
  const j = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 25000, log: opts.log });

  const out = [];
  for (const e of j.events || []) {
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const kickoff = utcToBeijingWall(e.date);
    if (!kickoff) continue;

    const state = mapState(e.status?.type);
    const ok = v => (v != null && v !== '' ? String(v) : null);

    out.push({
      league,
      homeId: toTeamId(league, home.team?.abbreviation),
      awayId: toTeamId(league, away.team?.abbreviation),
      kickoff,
      kickoffTrusted: true, // ESPN 的 date 含时区，已换算为北京墙钟，可信
      state,
      homeScore: state === 'done' ? ok(home.score) : null,
      awayScore: state === 'done' ? ok(away.score) : null,
      source: id,
      raw: { id: e.id, name: e.name }
    });
  }
  return out;
}

/** 该源支持的联赛 + 建议的日期分块（ESPN 单次查询有上限） */
export function monthRange(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return `${y}${mm}01-${y}${mm}${last}`;
}
