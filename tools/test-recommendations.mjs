/**
 * L1 推荐池（C9）测试
 *
 * 这个池子直接决定「今晚焦点」说些什么，所以断言分两类：
 *   1. **内容诚实**：只用有源头的事实，不出现任何无数据源字段（xG/控球/阵型…）；
 *   2. **不注水**：星级不得高于底座星级、每周有上限、条目必须指向真实且未开赛的场次。
 *
 * 另外与 A3 的不变式同批验收：生成的条目必须真的能产出 L1（否则「补了供给」是假的）。
 *
 * 运行：node tools/test-recommendations.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getFixtures, rivalries, storylines, REC_MAP, leagueName } from '../src/data/index.js';
import { narrativeOf, LEVEL } from '../src/core/narrative.js';
import * as E from '../src/core/engine.js';
import { buildPool, buildEntry, focusScore, WEEKLY_CAP } from './build-recommendations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recommendations = JSON.parse(readFileSync(resolve(ROOT, 'src/data/recommendations.json'), 'utf8'));
const fixtures = getFixtures();

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

/** 数据里根本不存在的字段：写出来就是编造（《数据可达性对账表》口径） */
const FORBIDDEN = [
  'xG', 'xg', '预期进球', '控球率', '控球', '阵型', '传球成功率', '射正次数',
  '跑动距离', '码率', '补觉分钟', '心率', '最大摄氧量'
];

const gen = recommendations.filter(r => r.src === 'generated');
const manual = recommendations.filter(r => r.src !== 'generated');

console.log('L1 推荐池测试');
console.log('');

/* ================================================================== */
console.log('一、条目的基本真实性与稀缺性');
{
  const ids = new Set(fixtures.map(m => m.id));

  ok('生成条目全部指向真实场次', gen.every(r => ids.has(r.m)),
    gen.filter(r => !ids.has(r.m)).map(r => r.m).join('、'));
  ok('生成条目无重复 id', new Set(gen.map(r => r.m)).size === gen.length, `${gen.length} 条`);
  ok('★ 生成条目不与人工条目撞车',
    gen.every(r => !manual.some(x => x.m === r.m)),
    gen.filter(r => manual.some(x => x.m === r.m)).map(r => r.m).join('、'));

  const byId = new Map(fixtures.map(m => [m.id, m]));
  const badState = gen.filter(r => {
    const m = byId.get(r.m);
    return !m || m.st !== 'sched' || m.tbd === true;
  });
  ok('★ 生成条目只落在「未开赛且时间已定」的场次上', badState.length === 0,
    badState.map(r => r.m).join('、'));

  // 稀缺性：同一自然周不超过上限
  const perWeek = new Map();
  for (const r of gen) {
    const m = byId.get(r.m);
    if (!m) continue;
    const week = E.mondayOfWall(E.owlDay(m.t));
    perWeek.set(week, (perWeek.get(week) || 0) + 1);
  }
  const over = [...perWeek.entries()].filter(([, n]) => n > WEEKLY_CAP);
  ok(`★ 每周不超过 ${WEEKLY_CAP} 条（L1 是稀缺档，不是全量列表）`, over.length === 0,
    over.map(([w, n]) => `${w}=${n}`).join('、'));

  console.log(`     （生成 ${gen.length} 条 · 人工 ${manual.length} 条 · 覆盖 ${perWeek.size} 周）`);
}

/* ================================================================== */
console.log('');
console.log('二、内容诚实：只用有源头的事实');
{
  const offenders = [];
  for (const r of recommendations) {
    const text = [r.points || [], r.trivia || ''].flat().join(' ');
    for (const word of FORBIDDEN) {
      if (text.includes(word)) offenders.push(`${r.m}: ${word}`);
    }
  }
  ok('★ 全量条目不含任何无数据源字段（xG/控球/阵型…）', offenders.length === 0,
    offenders.slice(0, 5).join('；'));

  ok('生成条目都有一句以上正文', gen.every(r => Array.isArray(r.points) && r.points.length > 0),
    gen.filter(r => !r.points?.length).map(r => r.m).join('、'));
  ok('生成条目正文不超过 3 行（Hero 卡片放得下）',
    gen.every(r => r.points.length <= 3),
    gen.filter(r => r.points.length > 3).map(r => r.m).join('、'));
  ok('★ 生成条目不编 trivia（点睛句留给人工）', gen.every(r => r.trivia === null),
    gen.filter(r => r.trivia).map(r => r.m).join('、'));
  ok('生成条目自带来源标记与生成日期',
    gen.every(r => r.src === 'generated' && /^\d{4}-\d{2}-\d{2}$/.test(r.genAt || '')));

  // 正文里的每个「事实」都要能指回字段：故事线名 / 德比名 / 联赛轮次 / 档位
  const unknown = [];
  for (const r of gen) {
    const m = fixtures.find(x => x.id === r.m);
    if (!m) continue;
    const allowed = [
      leagueName(m.l),
      `第 ${m.r} 轮`,
      ...(storylines || []).map(s => s.name),
      ...(rivalries || []).map(x => x.zh),
      '六强内战', '关键节点', '档', '睡眠成本'
    ];
    for (const p of r.points) {
      if (!allowed.some(a => p.includes(a))) unknown.push(`${r.m}: ${p}`);
    }
  }
  ok('★ 每行正文都能指回一个数据字段', unknown.length === 0, unknown.slice(0, 5).join('；'));
}

/* ================================================================== */
console.log('');
console.log('三、不注水：星级不得高于底座规则');
{
  const inflated = [];
  for (const r of gen) {
    const m = fixtures.find(x => x.id === r.m);
    if (!m) continue;
    const base = E.evaluate(m, {}, rivalries, storylines, [], []).star;
    if (r.star > Math.max(2, base)) inflated.push(`${r.m}: rec★${r.star} > base★${base}`);
  }
  ok('★ 生成条目的星级不高于底座星级（不靠推荐自我抬高）', inflated.length === 0,
    inflated.slice(0, 5).join('；'));

  const tooLow = gen.filter(r => r.star < 2);
  ok('生成条目至少 2 星（否则不该进 L1）', tooLow.length === 0, tooLow.map(r => r.m).join('、'));
}

/* ================================================================== */
console.log('');
console.log('四、与 A3 同批验收：生成条目必须真的产出 L1（且 star>=2 不得 L3）');
{
  const badLevel = [];
  const l3 = [];
  for (const r of gen) {
    const m = fixtures.find(x => x.id === r.m);
    if (!m) continue;
    const ev = E.evaluate(m, REC_MAP, rivalries, storylines, [], ['PL']);
    const n = narrativeOf(m, ev, storylines);
    if (n.level !== LEVEL.L1) badLevel.push(`${r.m}=${n.level}`);
    if (ev.star >= 2 && n.level === LEVEL.L3) l3.push(r.m);
  }
  ok('★ 生成条目在界面上走 L1 分支', badLevel.length === 0, badLevel.join('、'));
  ok('★ 生成条目 star>=2 时不会落 L3', l3.length === 0, l3.join('、'));

  // 供给不再断粮：未来可行动场次里至少有一条 L1
  const now = Date.now();
  const actionable = fixtures.filter(m => m.st === 'sched' && !m.tbd && E.ts(m.t) > now);
  const futureL1 = actionable.filter(m => REC_MAP[m.id]);
  ok('★ 未来可行动场次存在 L1 条目（此前为 0）', futureL1.length > 0, `${futureL1.length} 场`);
  console.log(`     （未来可行动 ${actionable.length} 场 · 其中 L1 ${futureL1.length} 场）`);
}

/* ================================================================== */
console.log('');
console.log('五、生成器本身：确定性、上限与选池规则');
{
  // 固定时钟，两次生成必须完全一致（否则每跑一次推荐就变一次）
  const NOW = E.ts('2026-11-05T12:00');
  const a = buildPool({ fixtures, now: NOW });
  const b = buildPool({ fixtures, now: NOW });
  ok('★ 同输入同输出（可复现）', JSON.stringify(a.entries) === JSON.stringify(b.entries));

  ok('生成条数不超过「周数 × 上限」',
    a.entries.length <= WEEKLY_CAP * 6, `${a.entries.length} 条`);

  // 选池规则：没有规则依据的普通场次不进 L1
  const plain = { id: 'X-PLAIN', l: 'PL', t: '2026-11-08T23:00', st: 'sched', h: 'ARS', a: 'TOT', r: 11 };
  ok('无规则依据的普通场次不进 L1', buildPool({ fixtures: [{ ...plain, id: 'X1', h: 'BCN', a: 'EVE' }], now: NOW }).entries.length === 0);

  // 焦点分排序：关键节点 > 德比 > 六强 > 普通故事线
  const keyMatch = fixtures.find(m => storylines.some(s => (s.keyNodes || []).includes(m.id)));
  if (keyMatch) {
    const ev = E.evaluate(keyMatch, {}, rivalries, storylines, [], []);
    ok('关键节点场次的焦点分最高', focusScore(keyMatch, ev) === 5, String(focusScore(keyMatch, ev)));
  }

  // tbd 场次一律跳过：占位时间写进 L1 会指向一个不存在的时刻
  const tbdMatch = fixtures.find(m => m.tbd && m.st === 'sched');
  if (tbdMatch) {
    const pool = buildPool({ fixtures: [tbdMatch], now: E.ts('2026-11-01T12:00') });
    ok('★ tbd 场次不进 L1', pool.entries.length === 0, `${pool.entries.length} 条`);
  }

  // 单条构造：正文必须有内容，且不写 trivia
  const sample = fixtures.find(m => m.st === 'sched' && !m.tbd && E.ts(m.t) > NOW);
  if (sample) {
    const e = buildEntry(sample, E.evaluate(sample, {}, rivalries, storylines, [], []));
    ok('buildEntry 至少产出一行正文', e.points.length > 0, JSON.stringify(e.points));
    ok('buildEntry 不带 trivia', e.trivia === null);
    ok('buildEntry 星级落在 2–3', e.star >= 2 && e.star <= 3, String(e.star));
  }
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
