/**
 * 比分源适配层的公共约定
 *
 * 为什么要有这一层：比分源会挂（实测 ESPN 间歇性完全不可达），
 * 所以设计成**多源 + 优先级合并**，而不是绑定单一源。
 *
 * 统一事件形状（所有适配器都必须产出这个形状）：
 *   {
 *     league:   'PL',                       // 我们的联赛码
 *     homeId:   'ARS',                      // 已解析为我们的球队 id
 *     awayId:   'COV',
 *     kickoff:  '2026-08-21T20:00',         // 北京墙钟串（无时区后缀）
 *     state:    'sched' | 'done' | 'pp' | 'live',
 *     homeScore: '3' | null,
 *     awayScore: '0' | null,
 *     source:   'espn',
 *     raw:      { ... }                     // 调试用，不外传
 *   }
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/** 名称归一化：去变音符号 → 去标点 → 去常见俱乐部后缀 */
export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/\b(fc|cf|sc|ac|afc|cd|ud|sv|vfb|vfl|tsg|bsc|as|ss|ssc|us|rc|rcd|club|calcio)\b/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

/** 从 teams.json 建「归一化英文名 → id」索引，供名称型数据源使用 */
export function buildNameIndex(teams) {
  const idx = new Map();
  for (const t of teams) {
    const k = normName(t.en);
    if (k && !idx.has(k)) idx.set(k, t.id);
  }
  return idx;
}

/** 按联赛分组的球队池（仅供别名表生成器与校验脚本使用，**不用于运行时匹配**） */
export function buildLeaguePool(teams) {
  const pool = new Map();
  for (const t of teams) {
    if (!pool.has(t.league)) pool.set(t.league, []);
    pool.get(t.league).push(t);
  }
  return pool;
}

/* ------------------------------------------------------------------ */
/* openfootball 别名表                                                  */
/* ------------------------------------------------------------------ */

let ofAliasCache = null;

export function loadOpenfootballAlias() {
  if (!ofAliasCache) {
    try {
      ofAliasCache = JSON.parse(readFileSync(resolve(ROOT, 'server/openfootball-alias.json'), 'utf8'));
    } catch {
      ofAliasCache = { byLeague: {} };
    }
  }
  return ofAliasCache;
}

/**
 * 名称 → 球队 id
 *
 * ⚠️ 只做**两级精确匹配**：归一化全等 → 显式别名表。**不做「名称包含」兜底。**
 *
 * 教训：曾用包含匹配自动兜底，把 openfootball 的 `RCD Espanyol de Barcelona`
 * 匹配成了巴萨（BAR）——因为 "espanyoldbarcelona".includes("barcelona")。
 * 静默错配比匹配失败危险得多：错误比分会一路写进数据且无人察觉。
 * 宁可返回 null 并在健康检查里暴露，也不猜。
 */
export function resolveByName(name, league, nameIndex) {
  const k = normName(name);
  if (!k) return null;

  if (nameIndex.has(k)) return nameIndex.get(k);

  const alias = loadOpenfootballAlias();
  const hit = alias?.byLeague?.[league]?.[String(name).trim()];
  if (hit) return hit;

  return null;
}

/** 读取数据层的 teams.json（适配器共用） */
export function loadTeams() {
  return JSON.parse(readFileSync(resolve(ROOT, 'src/data/teams.json'), 'utf8'));
}

/** UTC ISO（含 Z 或 +00:00）→ 北京墙钟串 */
export function utcToBeijingWall(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const b = new Date(d.getTime() + 8 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}T${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD' + 'HH:mm'（当地区域时间，按北京时间理解）→ 墙钟串 */
export function localPartsToWall(dateStr, timeStr) {
  if (!dateStr) return null;
  const t = (timeStr && /^\d{1,2}:\d{2}/.test(timeStr) ? timeStr.slice(0, 5) : '00:00').padStart(5, '0');
  const [h, m] = t.split(':');
  return `${dateStr}T${String(h).padStart(2, '0')}:${m}`;
}

/** 带退避的 JSON 拉取（多通道：Node fetch → curl 兜底） */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchJSON(url, { timeoutMs = 20000, retries = 3, baseDelayMs = 500, log = console, viaCurl = false } = {}) {
  if (viaCurl) {
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise((res, rej) => {
      execFile('curl', ['-s', '--max-time', String(Math.ceil(timeoutMs / 1000)), '--compressed', url],
        { maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err ? rej(err) : res(out)));
    });
    return JSON.parse(stdout);
  }

  let lastErr;
  for (let i = 0; i < retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await sleep(baseDelayMs * Math.pow(2, i));
    } finally {
      clearTimeout(timer);
    }
  }

  // Node 通道失败 → curl 兜底（TLS 指纹不同，短线场景常能过）
  try {
    const j = await fetchJSON(url, { timeoutMs, log, viaCurl: true });
    log.warn?.(`[sources] Node 直连失败（${lastErr?.cause?.code || lastErr?.message}），已用 curl 兜底：${url.slice(0, 70)}`);
    return j;
  } catch (err2) {
    throw new Error(`Node(${lastErr?.cause?.code || lastErr?.message}) 与 curl(${err2?.message}) 均失败`);
  }
}
