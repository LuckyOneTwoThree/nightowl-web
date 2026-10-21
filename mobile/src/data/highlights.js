/**
 * 赛后集锦解析
 *
 * 数据源：TheSportsDB 的 `strVideo` 字段（第三方索引，指向官方 YouTube 频道）
 *
 * 边界（与直播抓取刻意区分）：
 *   · 只接受 youtube.com / youtu.be 的规范视频地址，其他 URL 一律丢弃
 *   · 不下载、不代理、不转码；播放交给系统浏览器
 *   · 结果写用户数据目录的 highlights.json（本地开发回落 server/cache/user-data；
 *     缓存文件不进安装包、不写 fixtures）
 *
 * 匹配纪律：宁缺勿错。轮次内按「双方队名 + 日期邻近」匹配；
 * 多个候选同样接近时返回空，不猜 —— 错配一个集锦比没有集锦更伤信任。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { normName, fetchJSON } from './sync/normalize.js';
import teamsData from '../shared/data/teams.json';
import openfootballAlias from '../shared/server/openfootball-alias.json';
import highlightsAlias from '../shared/server/highlights-alias.json';

export const DEFAULT_LEAGUES = {
  PL: 4328,
  PD: 4335,
  SA: 4332,
  BL: 4331,
  FL: 4334
};

export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
export const DEFAULT_MISS_TTL_MS = 3600 * 1000;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * 原始 URL → 规范 YouTube watch 地址；非 YouTube / 非法 ID 返回 null。
 * 用 URL 解析而不是子串正则：`notyoutube.com` 不能被当成 YouTube。
 */
export function youtubeUrl(raw) {
  const input = String(raw || '');
  let u;
  try {
    u = new URL(input);
  } catch {
    const m = input.match(
      /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[/?&#]|$)/i
    );
    return m ? `https://www.youtube.com/watch?v=${m[1]}` : null;
  }

  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/').filter(Boolean)[0] || null;
  } else if (host === 'youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/);
      if (m) id = m[1];
    }
  }

  return id && YOUTUBE_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** '2026-27' / '2026-2027' → TheSportsDB 的 '2026-2027'；非法或不连续返回 null */
export function seasonToTheSportsDb(season) {
  const s = String(season || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const start = Number(m[1]);
    return Number(m[2]) === (start + 1) % 100 ? `${start}-${start + 1}` : null;
  }
  m = s.match(/^(\d{4})-(\d{4})$/);
  if (m) {
    const start = Number(m[1]);
    return Number(m[2]) === start + 1 ? s : null;
  }
  return null;
}

function loadTeams() {
  return teamsData;
}

/**
 * 合并两份别名表：
 *   · openfootball-alias.json 是历史上为副源维护的官方全称 → 队 id
 *   · highlights-alias.json 只补 TheSportsDB 特有、归一化后仍对不上的名称
 */
function loadAliases() {
  const out = {};
  for (const j of [openfootballAlias, highlightsAlias]) {
    for (const [league, map] of Object.entries(j.byLeague || {})) {
      out[league] = { ...(out[league] || {}), ...(map || {}) };
    }
  }
  return out;
}

/**
 * 付费 key 的本地覆盖（server/*.local.json 不入库、不打包）。
 * 免费 key 123 可直接写进 rules.json；付费 key 不要，否则会随安装包分发。
 */
function loadLocalKey() {
  return null;
}

/**
 * 构建队名解析器
 *
 * 三级：归一化全等 → 显式别名 → 同联赛内唯一包含。
 * 第三级只用于 "Brighton and Hove Albion" / "Hull" 这类全称/简称差异，
 * 且要求短名 ≥5 字符、同联赛唯一；Manchester 这种会命中两支球队，必须失败。
 */
export function buildTeamResolver(teams = loadTeams(), aliases = loadAliases()) {
  const exactByLeague = new Map();
  const pools = new Map();

  for (const t of teams) {
    const keys = [t.en, t.zh].map(normName).filter(Boolean);
    if (!exactByLeague.has(t.league)) exactByLeague.set(t.league, new Map());
    const exact = exactByLeague.get(t.league);
    for (const k of keys) if (!exact.has(k)) exact.set(k, t.id);

    if (!pools.has(t.league)) pools.set(t.league, []);
    pools.get(t.league).push({ id: t.id, key: normName(t.en) });
  }

  const aliasNorm = new Map();
  for (const [league, map] of Object.entries(aliases || {})) {
    if (!aliasNorm.has(league)) aliasNorm.set(league, new Map());
    for (const [name, id] of Object.entries(map || {})) {
      const k = normName(name);
      if (k) aliasNorm.get(league).set(k, id);
    }
  }

  return function resolve(name, league) {
    const key = normName(name);
    if (!key) return null;

    const exact = exactByLeague.get(league);
    if (exact?.has(key)) return exact.get(key);

    const rawAlias = aliases?.[league]?.[String(name || '').trim()];
    if (rawAlias) return rawAlias;
    const normalizedAlias = aliasNorm.get(league)?.get(key);
    if (normalizedAlias) return normalizedAlias;

    const pool = pools.get(league) || [];
    const hits = pool.filter(
      t => t.key.length >= 5 && (t.key.includes(key) || key.includes(t.key))
    );
    return hits.length === 1 ? hits[0].id : null;
  };
}

function daysBetween(a, b) {
  const pa = String(a || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const pb = String(b || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!pa || !pb) return Infinity;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.abs(ta - tb) / 86400000;
}

/**
 * 在轮次事件里找出本场
 *
 * @returns {{event:object, video:string|null, dateDiff:number}|null}
 */
export function pickHighlightEvent(match, events, resolveTeam, maxDays = 2) {
  const matchDate = String(match.t || '').slice(0, 10);
  if (!matchDate) return null;

  const candidates = [];
  for (const ev of events || []) {
    const dateDiff = daysBetween(ev.dateEvent, matchDate);
    if (!(dateDiff <= maxDays)) continue;

    const h = resolveTeam(ev.strHomeTeam, match.l);
    const a = resolveTeam(ev.strAwayTeam, match.l);
    if (!h || !a) continue;

    let swapped = 0;
    if (h === match.h && a === match.a) swapped = 0;
    else if (h === match.a && a === match.h) swapped = 1;
    else continue;

    candidates.push({
      event: ev,
      video: youtubeUrl(ev.strVideo),
      dateDiff,
      swapped
    });
  }

  if (!candidates.length) return null;

  // 先按日期/主客方向排序；同分时优先有视频的。仍并列则视为歧义，不猜。
  candidates.sort(
    (x, y) =>
      x.dateDiff - y.dateDiff ||
      x.swapped - y.swapped ||
      Number(Boolean(y.video)) - Number(Boolean(x.video))
  );

  const top = candidates[0];
  const second = candidates[1];
  const ambiguous =
    second &&
    second.dateDiff === top.dateDiff &&
    second.swapped === top.swapped &&
    Boolean(second.video) === Boolean(top.video);

  return ambiguous ? null : top;
}

/** 缓存条目是否仍新鲜：有视频 7 天，无视频 1 小时（集锦常在赛后数小时才上传） */
export function cacheEntryFresh(entry, nowTs, cfg = {}) {
  if (!entry || !Number.isFinite(entry.at)) return false;
  const ttl = entry.videos?.length
    ? cfg.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    : cfg.missTtlMs ?? DEFAULT_MISS_TTL_MS;
  return nowTs - entry.at < ttl;
}

/* ------------------------------------------------------------------ */
/* 缓存（磁盘 + 内存）                                                 */
/* ------------------------------------------------------------------ */

const CACHE_KEY = 'nightowl:highlights-cache:v1';
let memoryCache = null;

async function readDiskCache() {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    memoryCache =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function writeDiskCache(cache, persist = true) {
  if (!persist) return;
  try {
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      keys
        .sort((a, b) => (cache[a]?.at || 0) - (cache[b]?.at || 0))
        .slice(0, keys.length - 500)
        .forEach(key => delete cache[key]);
    }
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 缓存写失败不影响本次结果
  }
}

/** 测试用：清空内存缓存 */
export function resetHighlightsCache() {
  memoryCache = null;
}

/* ------------------------------------------------------------------ */
/* 限流                                                                */
/* ------------------------------------------------------------------ */

let lastFetchAt = 0;
async function waitForSlot(minIntervalMs) {
  if (!(minIntervalMs > 0)) return;
  const wait = lastFetchAt + minIntervalMs - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * 解析某场已完赛比赛的官方集锦
 *
 * @param {object} match fixtures 中的一条（需要 id/l/r/t/h/a/st）
 * @param {object} opts  rules / fetchJSON / now / cache / persist / teams / aliases
 * @returns {Promise<{ok:boolean, videos:Array, reason?:string, cached?:boolean, fetchedAt?:string}>}
 */
export async function resolveHighlights(match, opts = {}) {
  const cfg = opts.rules?.highlights || {};
  if (cfg.enabled === false) {
    return { ok: false, videos: [], reason: 'disabled' };
  }

  const leagueId = (cfg.leagues || DEFAULT_LEAGUES)[match?.l];
  if (!leagueId) {
    return { ok: false, videos: [], reason: 'unsupported-league' };
  }

  const season = seasonToTheSportsDb(
    opts.season || cfg.season || opts.rules?.scores?.season || '2026-27'
  );
  if (!season) {
    return { ok: false, videos: [], reason: 'invalid-season' };
  }

  const nowTs = opts.now ?? Date.now();
  const persist = opts.persist !== false;
  const force = opts.force === true;
  const cache = opts.cache || (await readDiskCache());
  const cached = cache[match.id];
  if (!force && cacheEntryFresh(cached, nowTs, cfg)) {
    return {
      ok: true,
      videos: cached.videos || [],
      cached: true,
      fetchedAt: new Date(cached.at).toISOString(),
      source: 'thesportsdb'
    };
  }

  const baseUrl = String(cfg.baseUrl || 'https://www.thesportsdb.com/api/v1/json').replace(/\/+$/, '');
  const apiKey = loadLocalKey() || cfg.apiKey || '123';
  const url =
    `${baseUrl}/${encodeURIComponent(apiKey)}/eventsround.php` +
    `?id=${leagueId}&r=${encodeURIComponent(match.r)}&s=${encodeURIComponent(season)}`;

  let json;
  try {
    await waitForSlot(cfg.minRequestIntervalMs ?? 2200);
    const fetchImpl = opts.fetchJSON || fetchJSON;
    json = await fetchImpl(url, {
      timeoutMs: cfg.timeoutMs ?? 8000,
      retries: 1,
      log: opts.log || console
    });
  } catch (err) {
    return {
      ok: false,
      videos: [],
      reason: 'upstream-error',
      message: String(err?.message || err)
    };
  }

  const events = Array.isArray(json?.events) ? json.events : [];
  const resolveTeam =
    opts.resolveTeam ||
    buildTeamResolver(opts.teams || loadTeams(), opts.aliases || loadAliases());
  const picked = pickHighlightEvent(match, events, resolveTeam);
  const videos = picked?.video
    ? [
        {
          id: picked.video.split('v=')[1],
          title: '官方集锦',
          eventName: picked.event.strEvent || '',
          url: picked.video,
          provider: 'youtube'
        }
      ]
    : [];

  cache[match.id] = { at: nowTs, videos };
  await writeDiskCache(cache, persist);

  return {
    ok: true,
    videos,
    cached: false,
    fetchedAt: new Date(nowTs).toISOString(),
    source: 'thesportsdb',
    ...(videos.length ? {} : { reason: events.length ? 'no-video' : 'upstream-empty' })
  };
}
