/**
 * ESPN 别名表生成器（T4-5 的前置）
 *
 * 为什么需要：ESPN 的球队缩略码与本项目的 111 支 id **存在系统性偏差**。
 *   实测（2026-09 单月，五大联赛）就有 17 个对不上：
 *     PL:MNC/MAN、BL:DOR/M05、FL:LILL/LYON/RCL/NICE/TRY/OLM、SA:COMO/ROMA/MON …
 *   直接拿 abbr 当 id 用，保鲜会大面积静默失配（比分永远补不上，且不报错）。
 *
 * 做法：**从真实数据反推**，而不是手拍一张表：
 *   ① 逐联赛逐月拉 scoreboard，收集出现过的球队（abbr / displayName / name）
 *   ② 三级匹配：abbr 精确 → displayName 归一化对齐 `teams.en` → 名称包含
 *   ③ 输出别名表 + **未解析清单**（供人工确认，这才是可校验的契约）
 *
 * 运行：node tools/build-espn-alias.mjs [--months=202608,202609,...]
 * 产出：server/espn-alias.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const rules = JSON.parse(readFileSync(resolve(ROOT, 'server/rules.json'), 'utf8'));
const teams = JSON.parse(readFileSync(resolve(ROOT, 'src/data/teams.json'), 'utf8'));

const LEAGUES = rules.scores.leagues;
const BASE = rules.scores.baseUrl;

const argMonths = process.argv.find(a => a.startsWith('--months='));
const MONTHS = argMonths
  ? argMonths.split('=')[1].split(',')
  : ['202608', '202609', '202610', '202611', '202612', '202701', '202702', '202703', '202704', '202705'];

const ourById = new Map(teams.map(t => [t.id, t]));
const ourByLeague = new Map();
for (const t of teams) {
  if (!ourByLeague.has(t.league)) ourByLeague.set(t.league, []);
  ourByLeague.get(t.league).push(t);
}

/** 名称归一化：先去变音符号，再去标点/空格/常见俱乐部后缀，便于跨源比对 */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Málaga → malaga；München → munchen
    .replace(/&/g, 'and')
    .replace(/\b(fc|cf|sc|ac|afc|cd|ud|sv|vfb|vfl|tsg|bsc|as|ss|ssc|us|rc|rcd|club)\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

const ourByName = new Map();
for (const t of teams) {
  ourByName.set(norm(t.en), t.id);
}

function monthRange(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return `${y}${mm}01-${y}${mm}${last}`;
}

async function fetchBoard(espnCode, dates) {
  const url = `${BASE}/${espnCode}/scoreboard?dates=${dates}&limit=300`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const collected = []; // {league, abbr, displayName, name}
const errors = [];

for (const [code, espnCode] of Object.entries(LEAGUES)) {
  for (const ym of MONTHS) {
    try {
      const j = await fetchBoard(espnCode, monthRange(ym));
      for (const e of j.events || []) {
        for (const c of e.competitions?.[0]?.competitors || []) {
          collected.push({
            league: code,
            abbr: c.team?.abbreviation,
            displayName: c.team?.displayName,
            name: c.team?.name,
            shortName: c.team?.shortDisplayName
          });
        }
      }
    } catch (err) {
      errors.push(`${code} ${ym}: ${err.message}`);
    }
    process.stdout.write(`\r拉取中… ${code} ${ym}   `);
    await sleep(rules.scores.requestDelayMs || 400);
  }
}
console.log('');

/* ---- 去重 ---- */
const uniq = new Map();
for (const c of collected) {
  if (!c.abbr) continue;
  uniq.set(`${c.league}|${c.abbr}`, c);
}
console.log(`采集到 ${collected.length} 条球队记录，去重后 ${uniq.size} 个 (联赛,缩写) 组合`);

/* ---- 三级匹配 ---- */
const byLeague = {};
const matched = [];
const unresolved = [];

for (const [key, c] of uniq) {
  const { league, abbr } = c;
  let ourId = null;
  let how = '';

  // ① abbr 精确命中我们的 id
  if (ourById.has(abbr) && ourById.get(abbr).league === league) {
    ourId = abbr;
    how = 'abbr';
  } else if (league === 'UCL' && ourById.has(abbr)) {
    ourId = abbr;
    how = 'abbr-跨联赛(UCL)';
  } else {
    // ② displayName 归一化对齐 teams.en
    const cand = ourByName.get(norm(c.displayName)) || ourByName.get(norm(c.name)) || ourByName.get(norm(c.shortName));
    if (cand) {
      ourId = cand;
      how = 'name';
    } else {
      // ③ 名称包含（限定同联赛，避免误配）
      const pool = ourByLeague.get(league) || [];
      const hit = pool.find(t => {
        const a = norm(t.en);
        const b = norm(c.displayName);
        return a && b && (a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 5;
      });
      if (hit) {
        ourId = hit.id;
        how = 'name-包含';
      }
    }
  }

  if (ourId) {
    byLeague[league] = byLeague[league] || {};
    byLeague[league][abbr] = ourId;
    matched.push({ league, abbr, ourId, how, displayName: c.displayName });
  } else {
    unresolved.push({ league, abbr, displayName: c.displayName, name: c.name });
  }
}

/* ---- 输出 ---- */
const out = {
  _readme:
    'ESPN 缩略码 → 本项目球队 id 的别名表。由 tools/build-espn-alias.mjs 从真实数据生成。' +
    'unresolved 中的条目需人工确认后再补进 byLeague，不要猜。',
  _generatedAt: new Date().toISOString(),
  _coverage: {
    total: uniq.size,
    matched: matched.length,
    unresolved: unresolved.length
  },
  byLeague,
  unresolved
};

writeFileSync(resolve(ROOT, 'server/espn-alias.json'), JSON.stringify(out, null, 2), 'utf8');

const byHow = matched.reduce((o, m) => {
  o[m.how] = (o[m.how] || 0) + 1;
  return o;
}, {});

console.log('');
console.log('匹配结果：');
console.log(`  ✅ 已匹配 ${matched.length} / ${uniq.size}` + `（${Object.entries(byHow).map(([k, v]) => `${k}:${v}`).join(', ')}）`);
console.log(`  ⚠️  未解析 ${unresolved.length}`);
if (unresolved.length) {
  console.log('');
  console.log('未解析清单（需人工确认，勿猜）：');
  unresolved.slice(0, 40).forEach(u => console.log(`  ${u.league}  ${u.abbr}  ${u.displayName}`));
  if (unresolved.length > 40) console.log(`  … 另有 ${unresolved.length - 40} 条`);
}
if (errors.length) {
  console.log('');
  console.log(`拉取失败 ${errors.length} 次：`);
  errors.slice(0, 5).forEach(e => console.log(`  · ${e}`));
}
console.log('');
console.log('已写入 server/espn-alias.json');
