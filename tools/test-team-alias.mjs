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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildNameIndex, normName, loadTeams, resolveByName, fetchJSON } from '../server/sources/normalize.js';
import { LEAGUES as OF_LEAGUES } from '../server/sources/openfootball.js';
import { LEAGUES as ESPN_LEAGUES, toTeamId } from '../server/sources/espn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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
      if (!byId.has(id)) bad.push(`${lg} ${abbr} → ${id}（id 不存在）`);
    }
  }
  ok('ESPN 别名表的每个目标 id 都存在', bad.length === 0, bad.slice(0, 6).join('; '));
  ok('ESPN 别名表无未解析项', (espnAlias.unresolved || []).length === 0,
    `未解析 ${(espnAlias.unresolved || []).length} 条`);
}

/* ================================================================== */
console.log('');
console.log('二、openfootball 全量名字映射（需联网）');

const unresolved = new Set();
const nameToId = new Map(); // league → Map(name, id)
let mentionTotal = 0;

for (const [league, file] of Object.entries(OF_LEAGUES)) {
  let j;
  try {
    j = await fetchJSON(`${RAW_BASE}/${file}.json`, { timeoutMs: 20000, retries: 3 });
  } catch (err) {
    ok(`${league} 拉取`, false, err.message);
    continue;
  }

  const seen = nameToId.get(league) || new Map();
  nameToId.set(league, seen);

  for (const m of j.matches || []) {
    for (const nm of [m.team1, m.team2]) {
      mentionTotal++;
      if (seen.has(nm)) continue;
      const id = resolveByName(nm, league, nameIndex);
      if (id) seen.set(nm, id);
      else unresolved.add(`${league}|${nm}`);
    }
  }
  console.log(`  ${league.padEnd(4)} 场次 ${String((j.matches || []).length).padStart(4)} · 已解析队名 ${seen.size}`);
}

ok('openfootball 所有队名均可解析（无漏配）', unresolved.size === 0,
  [...unresolved].slice(0, 10).join('; '));

{
  // 关键：同联赛内不同队名不得解析到同一 id（误配检测）
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
  // 映射到的球队联赛归属是否正确
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

/* ================================================================== */
console.log('');
console.log('三、覆盖度');

{
  const rows = [];
  for (const [league, m] of nameToId) {
    const own = teams.filter(t => t.league === league).length;
    rows.push({ league, mapped: m.size, own });
  }
  console.log('  | 联赛 | 来源队名 | 本地球队 |');
  console.log('  | :--- | ---: | ---: |');
  rows.forEach(r => console.log(`  | ${r.league} | ${r.mapped} | ${r.own} |`));

  const mismatch = rows.filter(r => r.mapped !== r.own);
  ok('各联赛映射队数与本地球队数一致', mismatch.length === 0,
    mismatch.map(r => `${r.league} 来源 ${r.mapped} vs 本地 ${r.own}`).join('; '));
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
