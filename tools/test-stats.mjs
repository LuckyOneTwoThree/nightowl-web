import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { computeTeamForm, computeSeasonStats, computeHeadToHead, computeMatchStats } from '../src/core/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../src/data/fixtures.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('一、比赛数据统计真实性检验');
const sampleMatch = fixtures.find(f => f.id === 'PL-4-MUN-MCI');
ok('测试场次存在 (PL-4-MUN-MCI)', !!sampleMatch);

const stats = computeMatchStats(sampleMatch, fixtures);
ok('成功计算对战统计', !!stats);
ok('包含主队与客队', stats.home.id === 'MUN' && stats.away.id === 'MCI');

const munForm = stats.home.form;
ok('主队近况返回非空且不超过 5 场', Array.isArray(munForm) && munForm.length > 0 && munForm.length <= 5);
ok('近况结果均为 W/D/L 之一', munForm.every(f => ['W', 'D', 'L'].includes(f.result)));

const mciSeason = stats.away.season;
ok('客队赛季场次统计正确', mciSeason.played >= 0 && typeof mciSeason.winRate === 'number');
ok('进球/失球符合算术守恒', mciSeason.goalDiff === (mciSeason.goalsFor - mciSeason.goalsAgainst));

const h2h = stats.h2h;
ok('历史交战记录返回格式正确', Array.isArray(h2h.meetings) && typeof h2h.summary.t1Wins === 'number');

console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exit(1);
