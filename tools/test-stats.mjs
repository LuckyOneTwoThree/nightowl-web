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
import { computeMatchStats } from '../src/core/stats.js';

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

console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
