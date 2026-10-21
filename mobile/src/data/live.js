/**
 * 进行中比赛的实时比分与关键事件
 *
 * 数据源：ESPN scoreboard（比分/状态/时钟）+ summary（keyEvents 进球/红黄牌）
 *
 * 边界：
 *   · 只读视图，不写 fixtures —— st 仍只有 sched/done/pp，进行中由时间推导
 *   · 缓存 20 秒（终场 60 秒），避免 UI 轮询把上游打爆
 *   · summary 失败时降级为 scoreboard 的比分/时钟，事件为空，不编造
 */

import { ts } from '../shared/core/engine.js';
import { liveMinute } from '../shared/core/format.js';
import { fetchJSON } from './sync/normalize.js';
import { LEAGUES, fetchLeague, toTeamId } from './sync/espn.js';

export const LIVE_CACHE_TTL_MS = 20000;
export const FINISHED_CACHE_TTL_MS = 60000;

/** 北京墙钟串 → ESPN 查询用的 UTC 日期（凌晨场次会落到前一天） */
export function utcDateOf(t) {
  const n = ts(t);
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString().slice(0, 10).replace(/-/g, '');
}

/** ESPN 状态 → 界面状态与分钟标签 */
export function mapEspnStatus(type, extra = {}) {
  const name = String(type?.name || '').toUpperCase();
  const stateRaw = String(type?.state || extra.state || '');
  const displayClock = extra.displayClock || type?.displayClock || '';

  if (/POSTPONED|CANCELED|CANCELLED/.test(name)) {
    return { state: 'postponed', statusText: '延期', minuteLabel: '延期' };
  }
  if (/HALFTIME|HALF_TIME|HALF-TIME/.test(name)) {
    return { state: 'halftime', statusText: '中场', minuteLabel: 'HT' };
  }
  if (/FULL_TIME|FINAL|\bFT\b/.test(name) || stateRaw === 'post' || extra.completed || type?.completed) {
    return { state: 'finished', statusText: '已终场', minuteLabel: 'FT' };
  }
  if (stateRaw === 'in') {
    return { state: 'live', statusText: '进行中', minuteLabel: displayClock || '' };
  }
  return { state: 'scheduled', statusText: '未开始', minuteLabel: '--' };
}

function scoreOf(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 在 ESPN 当日赛事里找出本场；时间差超窗口或并列最近都返回 null（不猜） */
export function pickEspnEvent(match, events, maxHours = 12) {
  const target = ts(match?.t);
  if (!Number.isFinite(target)) return null;

  const cands = (events || []).filter(e => {
    if (!e?.raw?.id) return false;
    const same =
      (e.homeId === match.h && e.awayId === match.a) ||
      (e.homeId === match.a && e.awayId === match.h);
    if (!same) return false;
    const kick = ts(e.kickoff);
    return Number.isFinite(kick) && Math.abs(kick - target) <= maxHours * 3600000;
  });

  if (!cands.length) return null;
  cands.sort((a, b) => Math.abs(ts(a.kickoff) - target) - Math.abs(ts(b.kickoff) - target));
  if (
    cands.length > 1 &&
    Math.abs(ts(cands[0].kickoff) - target) === Math.abs(ts(cands[1].kickoff) - target)
  ) {
    return null;
  }
  return cands[0];
}

function classifyEvent(typeText, scoringPlay) {
  const t = String(typeText || '').toLowerCase();
  if (/red card/.test(t)) return 'red';
  if (/yellow card/.test(t)) return 'yellow';
  if (/own goal/.test(t)) return 'own';
  if (/\bvar\b/.test(t)) return 'var';
  if (scoringPlay || /goal/.test(t)) return 'goal';
  // 点球未进/判罚本身不能显示成“进球”
  if (/penalty/.test(t)) return 'penalty';
  return 'other';
}

function orientationOf(homeId, awayId, match) {
  if (homeId === match.h && awayId === match.a) return 'normal';
  if (homeId === match.a && awayId === match.h) return 'swapped';
  return null;
}

/** scoreboard 事件 → 最低限度实时视图（summary 不可用时的降级） */
export function extractLiveFromScoreboard(ev, match, league, now = Date.now()) {
  const orientation = orientationOf(ev.homeId, ev.awayId, match);
  if (!orientation) return { ok: false, reason: 'team-mismatch' };

  const mapped = mapEspnStatus(
    {
      name: ev.raw?.status,
      state: ev.state === 'live' ? 'in' : ev.state === 'done' ? 'post' : 'pre',
      completed: ev.raw?.completed === true
    },
    { displayClock: ev.raw?.displayClock }
  );

  const h = orientation === 'normal' ? ev.homeScore : ev.awayScore;
  const a = orientation === 'normal' ? ev.awayScore : ev.homeScore;

  return {
    ok: true,
    matchId: match.id,
    state: mapped.state,
    statusText: mapped.statusText,
    minuteLabel:
      mapped.state === 'live' && !mapped.minuteLabel
        ? `${liveMinute(ts(match.t), now)}'`
        : mapped.minuteLabel,
    score: { h: scoreOf(h), a: scoreOf(a) },
    events: [],
    eventId: ev.raw?.id || null,
    source: 'espn',
    updatedAt: new Date(now).toISOString(),
    warning: 'events-unavailable'
  };
}

/** ESPN summary → 实时比分/分钟/关键事件 */
export function extractLiveFromSummary(summary, match, league, now = Date.now(), fallback = {}) {
  const comp = summary?.header?.competitions?.[0] || null;
  if (!comp) return { ok: false, reason: 'summary-empty' };

  const status = comp.status || {};
  const mapped = mapEspnStatus(status.type, {
    state: status.type?.state,
    displayClock: status.displayClock || fallback.displayClock,
    completed: status.type?.completed
  });

  const competitors = comp.competitors || [];
  const homeComp = competitors.find(c => c.homeAway === 'home');
  const awayComp = competitors.find(c => c.homeAway === 'away');
  if (!homeComp || !awayComp) return { ok: false, reason: 'competitors-missing' };

  const homeId = toTeamId(league, homeComp.team?.abbreviation);
  const awayId = toTeamId(league, awayComp.team?.abbreviation);
  const orientation = orientationOf(homeId, awayId, match);
  if (!orientation) return { ok: false, reason: 'team-mismatch' };

  const espnTeamToLocal = new Map();
  for (const c of competitors) {
    const local = toTeamId(league, c.team?.abbreviation);
    if (c.team?.id != null) espnTeamToLocal.set(String(c.team.id), local);
  }

  const events = [];
  for (const ev of summary.keyEvents || []) {
    const typeText = ev.type?.text || '';
    const kind = classifyEvent(typeText, ev.scoringPlay);
    if (kind === 'other') continue;
    const localTeam = ev.team?.id != null ? espnTeamToLocal.get(String(ev.team.id)) : null;
    events.push({
      clock: ev.clock?.displayValue || '',
      type: kind,
      typeText,
      text: ev.text || '',
      side: localTeam === match.h ? 'h' : localTeam === match.a ? 'a' : null
    });
  }

  const h = orientation === 'normal' ? homeComp.score : awayComp.score;
  const a = orientation === 'normal' ? awayComp.score : homeComp.score;

  return {
    ok: true,
    matchId: match.id,
    state: mapped.state,
    statusText: mapped.statusText,
    minuteLabel:
      mapped.state === 'live' && !mapped.minuteLabel
        ? `${liveMinute(ts(match.t), now)}'`
        : mapped.minuteLabel,
    score: { h: scoreOf(h), a: scoreOf(a) },
    events: events.slice(-12),
    eventId: fallback.eventId || summary.header?.id || null,
    source: 'espn',
    updatedAt: new Date(now).toISOString()
  };
}

/* ------------------------------------------------------------------ */
/* 缓存与主入口                                                        */
/* ------------------------------------------------------------------ */

const liveCache = new Map();
const inFlight = new Map();

/** 测试用：清空实时缓存 */
export function resetLiveCache() {
  liveCache.clear();
  inFlight.clear();
}

function cacheFresh(entry, nowTs, cfg) {
  if (!entry || !Number.isFinite(entry.at)) return false;
  const ttl =
    entry.data?.state === 'finished'
      ? cfg.finishedCacheTtlMs ?? FINISHED_CACHE_TTL_MS
      : cfg.cacheTtlMs ?? LIVE_CACHE_TTL_MS;
  return nowTs - entry.at < ttl;
}

/**
 * 解析某场比赛的实时数据
 *
 * @param {object} match fixtures 中的一条
 * @param {object} opts rules / now / fetchLeague / fetchSummary / log
 */
export async function resolveLive(match, opts = {}) {
  const cfg = opts.rules?.live || {};
  if (cfg.enabled === false) return { ok: false, reason: 'disabled' };

  const espnCode = LEAGUES[match?.l];
  if (!espnCode) return { ok: false, reason: 'unsupported-league' };

  const date = utcDateOf(match.t);
  if (!date) return { ok: false, reason: 'invalid-time' };

  const now = opts.now ?? Date.now();
  const force = opts.force === true;
  const cached = liveCache.get(match.id);
  if (!force && cacheFresh(cached, now, cfg)) return { ...cached.data, cached: true };

  if (inFlight.has(match.id)) return inFlight.get(match.id);

  const task = (async () => {
    const fetchLeagueImpl = opts.fetchLeague || fetchLeague;
    const fetchSummaryImpl = opts.fetchSummary || fetchJSON;
    const log = opts.log || console;

    let events;
    try {
      events = await fetchLeagueImpl(match.l, date, {
        timeoutMs: cfg.timeoutMs ?? 12000,
        log
      });
    } catch (err) {
      return { ok: false, reason: 'upstream-error', message: String(err?.message || err) };
    }

    const ev = pickEspnEvent(match, events);
    if (!ev) return { ok: false, reason: 'event-not-found' };

    const baseUrl = String(
      cfg.baseUrl || 'https://site.api.espn.com/apis/site/v2/sports/soccer'
    ).replace(/\/+$/, '');
    const summaryUrl = `${baseUrl}/${espnCode}/summary?event=${encodeURIComponent(ev.raw.id)}`;

    let summary = null;
    try {
      summary = await fetchSummaryImpl(summaryUrl, {
        timeoutMs: cfg.timeoutMs ?? 12000,
        retries: 1,
        log
      });
    } catch {
      const fallback = extractLiveFromScoreboard(ev, match, match.l, now);
      if (fallback.ok) liveCache.set(match.id, { at: now, data: fallback });
      return fallback;
    }

    const data = extractLiveFromSummary(summary, match, match.l, now, {
      displayClock: ev.raw?.displayClock,
      eventId: ev.raw?.id
    });

    if (!data.ok) {
      const fallback = extractLiveFromScoreboard(ev, match, match.l, now);
      if (fallback.ok) liveCache.set(match.id, { at: now, data: fallback });
      return fallback;
    }

    liveCache.set(match.id, { at: now, data });
    return { ...data, cached: false };
  })();

  inFlight.set(match.id, task);
  try {
    return await task;
  } finally {
    inFlight.delete(match.id);
  }
}
