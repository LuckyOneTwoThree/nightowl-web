import openfootballAlias from '../../shared/server/openfootball-alias.json';
import teamsData from '../../shared/data/teams.json';

/** 名称归一化：去变音符号 → 去标点 → 去常见俱乐部后缀 */
export function normName(s) {
  const lower = String(s || '').toLowerCase();
  const normalized = typeof lower.normalize === 'function' ? lower.normalize('NFD') : lower;
  return normalized
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

/** 按联赛分组的球队池（仅供别名表生成器与校验脚本使用，不用于运行时匹配） */
export function buildLeaguePool(teams) {
  const pool = new Map();
  for (const t of teams) {
    if (!pool.has(t.league)) pool.set(t.league, []);
    pool.get(t.league).push(t);
  }
  return pool;
}

export function loadOpenfootballAlias() {
  return openfootballAlias;
}

/**
 * 名称 → 球队 id
 *
 * 只做两级精确匹配：归一化全等 → 显式别名表。不做「名称包含」兜底。
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

export function loadTeams() {
  return teamsData;
}

/** UTC ISO（含 Z 或 +00:00）→ 北京墙钟串 */
export function utcToBeijingWall(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const b = new Date(d.getTime() + 8 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}T${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 带退避的 JSON 拉取。
 *
 * 移动端没有 curl 兜底，也不应该把 Node 的进程能力带进来；
 * 失败就交给上层显示「同步失败，沿用本地数据」。
 */
export async function fetchJSON(url, { timeoutMs = 20000, retries = 3, baseDelayMs = 500, log = console } = {}) {
  const startedAt = Date.now();
  // timeoutMs 是整次拉取的总预算（含重试与退避），不是单请求上限：
  // 否则 retries×timeoutMs 会击穿调用方的总 deadline（90s 完整同步被拖到 ~180s）
  const remainingMs = () => Math.max(0, timeoutMs - (Date.now() - startedAt));
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const left = remainingMs();
    if (left <= 0) break;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), left);
    let r;
    try {
      r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      // 非 2xx / 解析失败显式取消 body，避免重试期间连接资源滞留
      try {
        await r?.body?.cancel();
      } catch {
        /* body 已消费或连接已断 */
      }
      lastErr = err;
      const delayLeft = remainingMs();
      const delay = Math.min(baseDelayMs * Math.pow(2, i), delayLeft);
      if (i < retries - 1 && delay > 0) await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  log.warn?.(`[sources] 请求失败：${url.slice(0, 80)} · ${lastErr?.message || lastErr}`);
  throw new Error(`请求失败：${lastErr?.message || lastErr}`);
}
