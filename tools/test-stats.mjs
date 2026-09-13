/**
 * 真实数据统计检验
 *
 * 设计原则：**不硬编码具体场次 ID**。
 * 数据层会被保鲜模块持续更新，写死 `PL-4-MUN-MCI` 这类 ID 后，数据一变测试就假失败，
 * 而那时分辨不出「数据变了」还是「代码坏了」。
 * 这里改为按「双方都有已完赛记录」动态选样，断言只针对不变量。
 *
 * 运行：node tools/test-stats.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { computeMatchStats, computeHeadToHead } from '../src/core/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../src/data/fixtures.json'), 'utf8'));

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
    console.log(`  ❌ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

/** 北京墙钟串 → 时间戳（与 engine.ts 同口径的纯 UTC 算术） */
function ts(t) {
  const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 8 * 3600000;
}

console.log('一、动态选样');

const playedTeams = new Set();
for (const m of fixtures) {
  if (m.st === 'done' && m.sc) {
    playedTeams.add(m.h);
    playedTeams.add(m.a);
  }
}
ok('数据中存在已完赛场次', playedTeams.size > 0, `已赛球队 ${playedTeams.size} 支`);

const sample =
  fixtures.find(f => f.st !== 'done' && playedTeams.has(f.h) && playedTeams.has(f.a)) ||
  fixtures.find(f => f.st === 'done' && f.sc);
ok('选到可统计的样本场次', !!sample, sample ? sample.id : '无');

console.log('');
console.log('二、统计结果的不变量');

const stats = computeMatchStats(sample, fixtures);
ok('成功计算对战统计', !!stats);
ok('主客队与样本一致', stats.home.id === sample.h && stats.away.id === sample.a);

const homeForm = stats.home.form;
ok('近况不超过 5 场', Array.isArray(homeForm) && homeForm.length <= 5, `实际 ${homeForm.length} 场`);
ok('近况结果均为 W/D/L', homeForm.every(f => ['W', 'D', 'L'].includes(f.result)));
ok('近况不含当前场次自身', homeForm.every(f => f.matchId !== sample.id));

// 铁律：近况只能取「开球时间早于当前比赛」的已完赛场次。
// 若混入未来场次，不会报错，只会静默给出错误的历史走势 —— 必须守住。
const sampleTs = ts(sample.t);
ok(
  '近况不含未来场次',
  homeForm.every(f => ts(f.date) <= sampleTs),
  homeForm.map(f => f.date).join(' ')
);

const season = stats.away.season;
ok('赛季统计数值类型正确', typeof season.played === 'number' && typeof season.winRate === 'number');
ok('净胜球符合算术守恒', season.goalDiff === season.goalsFor - season.goalsAgainst);
ok(
  '胜平负之和等于已赛场次',
  season.wins + season.draws + season.losses === season.played,
  `${season.wins}+${season.draws}+${season.losses} ≠ ${season.played}`
);
ok(
  '主客场之和等于总场次',
  season.home.played + season.away.played === season.played,
  `${season.home.played}+${season.away.played} ≠ ${season.played}`
);

const h2h = stats.h2h;
ok('历史交锋返回格式正确', Array.isArray(h2h.meetings) && typeof h2h.summary.t1Wins === 'number');
ok(
  '交锋胜负平之和等于总场次',
  h2h.summary.t1Wins + h2h.summary.draws + h2h.summary.t2Wins === h2h.summary.total,
  `${h2h.summary.t1Wins}+${h2h.summary.draws}+${h2h.summary.t2Wins} ≠ ${h2h.summary.total}`
);

/* ================================================================== */
console.log('');
console.log('六、历史交锋的时间边界（防剧透：不能出现当前场次之后的比赛）');
{
  // 传 currentMatch 时，交锋只应包含「开球更早且不含自身」的场次。
  // 否则查看一场已完赛的比赛，会把之后才踢的那场结果当历史交锋显示出来。
  // 沿用上面的动态样本（不硬编码场次 ID，数据会被保鲜模块更新）
  const cur = sample;
  const bounded = computeHeadToHead(cur.h, cur.a, fixtures, cur);
  const later = bounded.meetings.filter(m => E.ts(m.t) >= E.ts(cur.t));
  ok('★ 不含当前场次自身', !bounded.meetings.some(m => m.id === cur.id));
  ok('★ 不含开球时间不早于当前场次的交锋', later.length === 0, later.map(m => `${m.id} ${m.t}`).join('、'));
  ok('交锋场次按时间倒序', bounded.meetings.every((m, i) => i === 0 || E.ts(bounded.meetings[i - 1].t) >= E.ts(m.t)));

  // 对照：不传 currentMatch 时是「全量」口径（历史视图），应 >= 受限口径
  const unbounded = computeHeadToHead(cur.h, cur.a, fixtures);
  ok('不限时间时应多于或等于限时间的结果', unbounded.summary.total >= bounded.summary.total,
    `${unbounded.summary.total} vs ${bounded.summary.total}`);
  ok('限时间后仍是合法的交锋结构', typeof bounded.summary.total === 'number' && bounded.summary.total >= 0);
}

console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
