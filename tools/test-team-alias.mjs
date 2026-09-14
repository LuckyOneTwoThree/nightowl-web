/**
 * 队名别名表校验
 *
 * 为什么单独做一个校验脚本：提取规则与别名表是**唯一的外部依赖契约**，
 * 手改一个字母就可能让整条保鲜链路静默错配。
 *
 * 这个脚本能抓到的错误类型：
 *   · 名字没被映射（漏配）
 *   · 两个不同的名字映射到同一支球队（**误配** —— 曾把 Espanyol 映射成 Barcelona）
 *   · 映射到的 id 不存在，或与来源联赛不匹配
 *   · 一支球队从没被映射到（本地有、来源没有 → 需确认是否升/降级）
 *
 * 运行：node tools/test-team-alias.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildNameIndex, normName, loadTeams, resolveByName, fetchJSON } from '../server/sources/normalize.js';
import { LEAGUES as OF_LEAGUES } from '../server/sources/openfootball.js';
import { LEAGUES as ESPN_LEAGUES, toTeamId } from '../server/sources/espn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE_PATH = resolve(ROOT, 'server/cache/openfootball-fixtures.json');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
}

const teams = loadTeams();
const byId = new Map(teams.map(t => [t.id, t]));
const nameIndex = buildNameIndex(teams);
const RAW_BASE = 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27';

/* ================================================================== */
console.log('一、别名表自身结构校验（离线）');

const ofAlias = JSON.parse(readFileSync(resolve(ROOT, 'server/openfootball-alias.json'), 'utf8'));
const espnAlias = JSON.parse(readFileSync(resolve(ROOT, 'server/espn-alias.json'), 'utf8'));

{
  const bad = [];
  for (const [lg, map] of Object.entries(ofAlias.byLeague || {})) {
    for (const [name, id] of Object.entries(map)) {
      const t = byId.get(id);
      if (!t) bad.push(`${lg} "${name}" → ${id}（id 不存在）`);
      else if (t.league !== lg) bad.push(`${lg} "${name}" → ${id}（该队属于 ${t.league}）`);
    }
  }
  ok('openfootball 别名表的每个目标 id 都存在且联赛一致', bad.length === 0, bad.slice(0, 6).join('; '));
}

{
  // 同一联赛内，不同名字不得映射到同一支球队
  const dup = [];
  for (const [lg, map] of Object.entries(ofAlias.byLeague || {})) {
    const seen = new Map();
    for (const [name, id] of Object.entries(map)) {
      if (seen.has(id)) dup.push(`${lg}: "${seen.get(id)}" 与 "${name}" 都映射到 ${id}`);
      seen.set(id, name);
    }
  }
  ok('openfootball 别名表内部无重复映射', dup.length === 0, dup.join('; '));
}

{
  // 别名表里的名字不应与「精确归一化可命中」的名字冲突
  const conflict = [];
  for (const [lg, map] of Object.entries(ofAlias.byLeague || {})) {
    for (const [name, id] of Object.entries(map)) {
      const auto = nameIndex.get(normName(name));
      if (auto && auto !== id) conflict.push(`${lg} "${name}"：别名表=${id} 但归一化命中=${auto}`);
    }
  }
  ok('别名表不与自动归一化结果冲突', conflict.length === 0, conflict.join('; '));
}

{
  const bad = [];
  for (const [lg, map] of Object.entries(espnAlias.byLeague || {})) {
    for (const [abbr, id] of Object.entries(map)) {
      const t = byId.get(id);
      if (!t) bad.push(`${lg} ${abbr} → ${id}（id 不存在）`);
      else if (lg !== 'UCL' && t.league !== lg) bad.push(`${lg} ${abbr} → ${id}（该队属于 ${t.league}）`);
    }
  }
  ok('ESPN 别名表的每个目标 id 都存在且联赛一致', bad.length === 0, bad.slice(0, 6).join('; '));
  ok('ESPN 别名表无未解析项', (espnAlias.unresolved || []).length === 0,
    `未解析 ${(espnAlias.unresolved || []).length} 条`);
}

/* ================================================================== */
console.log('');
console.log('二、openfootball 全量名字映射（在线优先，失败回退缓存）');

/**
 * 该部分依赖外网。为避免「网络不通 → 测试挂死/误报」：
 *   ① 先在线拉取，成功则刷新缓存 server/cache/openfootball-fixtures.json
 *   ② 在线失败但缓存存在 → 用缓存，并明确标注
 *   ③ 两者皆无 → 跳过该部分（不计为失败），并说明如何补
 */
let ofMatches = null;
let sourceLabel = '';
let mentionTotal = 0; // openfootball 队名出现总次数（第二部分可能跳过，故置于外层）

/* 快速探测（3s）：raw.githubusercontent 不通时直接走缓存，避免逐个请求等到天荒地老 */
async function probeGitHubRaw() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  try {
    await fetch('https://raw.githubusercontent.com/openfootball/football.json/master/README.md', {
      signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const online = await probeGitHubRaw();

async function fetchAllOnline() {
  const fetched = {};
  let any = false;
  for (const [league, file] of Object.entries(OF_LEAGUES)) {
    try {
      const j = await fetchJSON(`${RAW_BASE}/${file}.json`, { timeoutMs: 8000, retries: 1, baseDelayMs: 200 });
      fetched[league] = (j.matches || []).map(m => ({ team1: m.team1, team2: m.team2 }));
      any = true;
    } catch {
      /* 该联赛失败，留给缓存兜底 */
    }
  }
  return any ? fetched : null;
}

if (online) {
  // 总预算 25s：网络抖动时宁可用缓存，也不让测试挂死
  const budgetMs = 25000;
  const fetched = await Promise.race([
    fetchAllOnline(),
    new Promise(res => setTimeout(() => res(null), budgetMs))
  ]);
  if (fetched) {
    mkdirSync(resolve(ROOT, 'server/cache'), { recursive: true });
    writeFileSync(
      CACHE_PATH,
      JSON.stringify({ _generatedAt: new Date().toISOString(), leagues: fetched }),
      'utf8'
    );
    ofMatches = fetched;
    sourceLabel = '在线拉取（缓存已刷新）';
  }
}

if (!ofMatches && existsSync(CACHE_PATH)) {
  try {
    const c = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    // 空缓存等同于无数据 —— 否则会对空集合做校验，得到「假通过」
    const nonEmpty = c.leagues && Object.values(c.leagues).some(a => Array.isArray(a) && a.length > 0);
    if (nonEmpty) {
      ofMatches = c.leagues;
      sourceLabel = `本地缓存（生成于 ${c._generatedAt || '未知时间'}）`;
    }
  } catch {
    ofMatches = null;
  }
}

const hasData = !!ofMatches && Object.values(ofMatches).some(a => Array.isArray(a) && a.length > 0);

if (!hasData) {
  console.log('  ⏭️  跳过：无法访问 openfootball，且本地缓存为空或不存在。');
  console.log('      （不做校验 —— 对空集合校验等于假通过，没有意义）');
  console.log('      补齐方式：网络恢复后重跑本测试（会自动生成缓存）。');
} else {
  console.log(`  数据来源：${sourceLabel}`);
  const unresolved = new Set();
  const nameToId = new Map();

  for (const [league, matches] of Object.entries(ofMatches)) {
    const seen = nameToId.get(league) || new Map();
    nameToId.set(league, seen);
    for (const m of matches) {
      for (const nm of [m.team1, m.team2]) {
        if (!nm) continue;
        mentionTotal++;
        if (seen.has(nm)) continue;
        const id = resolveByName(nm, league, nameIndex);
        if (id) seen.set(nm, id);
        else unresolved.add(`${league}|${nm}`);
      }
    }
    console.log(`  ${league.padEnd(4)} 场次 ${String(matches.length).padStart(4)} · 已解析队名 ${seen.size}`);
  }

  ok('openfootball 数据非空（防止对空集合假通过）', mentionTotal > 0, `mentionTotal=${mentionTotal}`);
  ok('openfootball 所有队名均可解析（无漏配）', mentionTotal > 0 && unresolved.size === 0,
    [...unresolved].slice(0, 10).join('; '));

  {
    const collisions = [];
    for (const [league, m] of nameToId) {
      const byIdSeen = new Map();
      for (const [nm, id] of m) {
        if (byIdSeen.has(id)) collisions.push(`${league}: "${byIdSeen.get(id)}" 与 "${nm}" → ${id}`);
        byIdSeen.set(id, nm);
      }
    }
    ok('无「两个队名映射到同一支球队」的误配', collisions.length === 0, collisions.join('; '));
  }

  {
    const wrong = [];
    for (const [league, m] of nameToId) {
      for (const [nm, id] of m) {
        const t = byId.get(id);
        if (!t) wrong.push(`${league} "${nm}" → ${id}（不存在）`);
        else if (t.league !== league) wrong.push(`${league} "${nm}" → ${id}（属于 ${t.league}）`);
      }
    }
    ok('映射结果的联赛归属正确', wrong.length === 0, wrong.slice(0, 8).join('; '));
  }

  {
    const rows = [];
    for (const [league, m] of nameToId) {
      rows.push({ league, mapped: m.size, own: teams.filter(t => t.league === league).length });
    }
    const mismatch = rows.filter(r => r.mapped !== r.own);
    ok('各联赛映射队数与本地球队数一致', mismatch.length === 0,
      mismatch.map(r => `${r.league} 来源 ${r.mapped} vs 本地 ${r.own}`).join('; '));
  }
}

/* ================================================================== */
console.log('');
console.log('四、ESPN 别名表抽样（离线，与上轮生成结果比对）');

{
  // 几个历史上容易出错的缩写，必须指向正确球队
  const expect = [
    ['PL', 'MNC', 'MCI'], ['PL', 'MAN', 'MUN'],
    ['BL', 'DOR', 'BVB'], ['BL', 'M05', 'MAI'],
    ['FL', 'OLM', 'OM'], ['FL', 'RCL', 'LEN'],
    ['SA', 'ROMA', 'ROM'], ['SA', 'COMO', 'COM'],
    ['PD', 'MCF', 'MAL'],
    ['UCL', 'SLB', 'SLO'], ['UCL', 'SLP', 'SLA']
  ];
  const wrong = expect.filter(([lg, abbr, id]) => toTeamId(lg, abbr) !== id)
    .map(([lg, abbr, id]) => `${lg} ${abbr} → ${toTeamId(lg, abbr)}（期望 ${id}）`);
  ok('易错缩写映射正确（含 SLB=Slovan Bratislava 这类反直觉项）', wrong.length === 0, wrong.join('; '));
}

/* ================================================================== */
console.log('');
console.log('─'.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项（队名出现总次数 ${mentionTotal}）`);
if (fail) {
  console.log('');
  console.log('失败明细：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
