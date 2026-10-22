/**
 * 联赛积分榜纯函数检验
 *
 * 设计原则与 test-stats.mjs 一致：**不硬编码具体场次 ID**。
 * 确定性规则用合成赛程验证；真实数据只断言规模、分区与截止口径等不变量。
 *
 * 运行：node tools/test-standings.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  computeStandings,
  computeMatchStandings,
  standingsCutoff,
  TIEBREAKER_NOTE,
  UCL_ZONES,
  DOMESTIC_ZONES
} from '../src/core/standings.js';
import { ts } from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../src/data/fixtures.json'), 'utf8'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

const synthetic = [
  { id: 'S1', l: 'PL', r: 1, t: '2026-08-01T20:00', st: 'done', h: 'A', a: 'B', sc: '2-0' },
  { id: 'S2', l: 'PL', r: 1, t: '2026-08-01T22:00', st: 'done', h: 'C', a: 'D', sc: '1-1' },
  { id: 'S3', l: 'PL', r: 2, t: '2026-08-08T20:00', st: 'done', h: 'A', a: 'C', sc: '0-1' },
  { id: 'S4', l: 'PL', r: 2, t: '2026-08-08T22:00', st: 'done', h: 'B', a: 'D', sc: '3-2' },
  { id: 'S5', l: 'PL', r: 3, t: '2026-08-15T20:00', st: 'sched', h: 'A', a: 'D' }
];

console.log('联赛积分榜测试');

console.log('\n一、积分、净胜球与排序');
const all = computeStandings('PL', synthetic);
ok('四支球队全部入表', all.rows.length === 4, `实际 ${all.rows.length}`);
ok('完赛场次计数正确', all.doneCount === 4, `实际 ${all.doneCount}`);
ok('C 两战 4 分第一', all.rows[0].teamId === 'C' && all.rows[0].points === 4);
ok('同分先比净胜球', all.rows[1].teamId === 'A' && all.rows[2].teamId === 'B');
ok('A 的净胜球正确', all.rows[1].gd === 1, `实际 ${all.rows[1].gd}`);
ok('B 的净胜球正确', all.rows[2].gd === -1, `实际 ${all.rows[2].gd}`);
ok('D 的净胜球正确', all.rows[3].gd === -1, `实际 ${all.rows[3].gd}`);
ok('排名连续', all.rows.every((row, index) => row.rank === index + 1));

// 同分、同净胜球时再比进球数：
// E 2-0 F，G 3-1 H → E/G 都是 3 分、+2，G 进球更多应在前。
const gfBreak = [
  { id: 'GF1', l: 'PL', r: 1, t: '2026-08-01T20:00', st: 'done', h: 'E', a: 'F', sc: '2-0' },
  { id: 'GF2', l: 'PL', r: 1, t: '2026-08-01T22:00', st: 'done', h: 'G', a: 'H', sc: '3-1' }
];
const gfTable = computeStandings('PL', gfBreak);
ok('同分同净胜球再比进球数', gfTable.rows[0].teamId === 'G' && gfTable.rows[1].teamId === 'E');

console.log('\n二、截止点：已完赛按开球时点');
const beforeS3 = computeStandings('PL', synthetic, { asOfTs: ts('2026-08-08T20:00') });
ok('截止在 S3 开球时只算前两场', beforeS3.doneCount === 2, `实际 ${beforeS3.doneCount}`);
ok('S3 本身不进入截止点之前的榜', !beforeS3.rows.some(row => row.teamId === 'C' && row.played > 1));
ok('截止前 A 仍为第一', beforeS3.rows[0].teamId === 'A' && beforeS3.rows[0].points === 3);
ok('截止前最后赛果时间正确', beforeS3.lastResultAt === ts('2026-08-01T22:00'));

const afterS3 = computeStandings('PL', synthetic, { asOfTs: ts('2026-08-08T20:00') + 1 });
ok('截止点后 1ms 才纳入 S3', afterS3.doneCount === 3, `实际 ${afterS3.doneCount}`);
ok('纳入 S3 后 C 升到第一', afterS3.rows[0].teamId === 'C');

const historical = computeMatchStandings(synthetic[2], synthetic, {
  nowTs: ts('2026-08-08T22:00') + 1
});
ok('已完赛场次标记为 historical', historical.historical === true);
ok('已完赛场次截止到本场开球', historical.asOfTs === ts('2026-08-08T20:00'));
ok('已完赛场次不含本场结果', historical.home.played === 1 && historical.away.played === 1);
ok('已完赛场次主队排名按截止前计算', historical.home.rank === 1, `实际第 ${historical.home.rank}`);

const future = computeMatchStandings(synthetic[4], synthetic, {
  nowTs: ts('2026-08-08T22:00') + 1
});
ok('未赛按当前时间截止', future.historical === false && future.doneCount === 4);
ok('未赛主队排名正确', future.home.rank === 2, `实际第 ${future.home.rank}`);
ok('未赛客队排名正确', future.away.rank === 4, `实际第 ${future.away.rank}`);

const liveMatch = {
  id: 'LIVE',
  l: 'PL',
  r: 3,
  t: '2026-08-08T20:30',
  st: 'sched',
  h: 'A',
  a: 'B'
};
const liveTable = computeMatchStandings(liveMatch, synthetic, {
  nowTs: ts('2026-08-08T22:00') + 1
});
ok('进行中按当前时间截止', liveTable.historical === false && liveTable.doneCount === 4);

const tbdMatch = { ...liveMatch, id: 'TBD', tbd: true, t: '2026-08-09T04:00' };
const tbdTable = computeMatchStandings(tbdMatch, synthetic, {
  nowTs: ts('2026-08-08T22:00') + 1
});
ok('tbd 按当前时间截止', tbdTable.historical === false && tbdTable.doneCount === 4);

console.log('\n三、边界与防御');
const snapshot = JSON.stringify(synthetic);
computeStandings('PL', synthetic);
ok('计算不修改输入数据', JSON.stringify(synthetic) === snapshot);

const empty = computeStandings('PL', []);
ok('空数据返回空表', empty.supported === true && empty.rows.length === 0);
ok('空数据不虚构最后赛果', empty.lastResultAt === null);
ok('空数据给出明确提示', typeof empty.note === 'string' && empty.note.includes('暂无'));

const scg = fixtures.find(match => match.l === 'SCG');
ok('真实数据中存在 SCG 样本', !!scg);
if (scg) {
  const scgTable = computeMatchStandings(scg, fixtures);
  ok('SCG 不提供积分榜', scgTable.supported === false && scgTable.rows.length === 0);
}

const missingTeam = {
  id: 'FAKE',
  l: 'PL',
  r: 1,
  t: '2026-08-20T20:00',
  st: 'sched',
  h: 'ZZZ',
  a: 'A'
};
const missing = computeMatchStandings(missingTeam, synthetic, { nowTs: ts(missingTeam.t) });
ok('未知球队不会被虚构排名', missing.supported === true && missing.home === null);
ok('对手仍能拿到真实排名', !!missing.away && missing.away.teamId === 'A');

const badScore = computeStandings('PL', [{ ...synthetic[0], sc: 'x-y' }]);
ok('无效比分不进入积分榜', badScore.doneCount === 0 && badScore.rows.length === 0);

const none = computeMatchStandings(null, synthetic);
ok('空比赛返回空表', none.supported === false && none.home === null && none.away === null);

const ko = {
  id: 'UCL-KO',
  l: 'UCL',
  r: 9,
  t: '2027-02-01T04:00',
  st: 'done',
  h: 'RMA',
  a: 'MCI',
  sc: '1-0'
};
const koTable = computeStandings('UCL', [ko]);
ok('UCL 淘汰赛不进入联赛阶段积分榜', koTable.doneCount === 0 && koTable.rows.length === 0);

const koView = computeMatchStandings({ ...ko, st: 'sched', sc: null }, fixtures);
ok('UCL 淘汰赛视图不显示联赛榜', koView.supported === false);

const round8 = computeStandings('UCL', [{ ...ko, id: 'UCL-R8', r: 8 }]);
ok('UCL 第 8 轮仍属于联赛阶段', round8.doneCount === 1);

console.log('\n四、截止函数');
const doneMatch = synthetic[2];
const schedMatch = synthetic[4];
ok('已完赛截止点 = 开球时间', standingsCutoff(doneMatch, 999) === ts(doneMatch.t));
ok('未赛截止点 = 当前时间', standingsCutoff(schedMatch, 999) === 999);
ok('空比赛截止点 = 当前时间', standingsCutoff(null, 999) === 999);

console.log('\n五、真实联赛分区');
const pl = computeStandings('PL', fixtures);
ok('英超表为 20 队', pl.rows.length === 20, `实际 ${pl.rows.length}`);
ok('前四为参考区', pl.rows[0].zoneKey === 'top' && pl.rows[3].zoneKey === 'top');
ok('第 5 名为中游', pl.rows[4].zoneKey === 'mid');
ok('最后三名为风险区', pl.rows[17].zoneKey === 'bottom' && pl.rows[19].zoneKey === 'bottom');
ok('榜首 chip 正确', pl.rows[0].zoneLabel === '榜首');
ok('前四 chip 正确', pl.rows[3].zoneLabel === '前四参考线');
ok('后三名 chip 正确', pl.rows[19].zoneLabel === '后三名风险区');
ok('榜首上下文只讲分差', pl.rows[0].context.primary.includes('第2名'));
ok('前四上下文只讲分差', pl.rows[3].context.primary.includes('第5名'));
ok('后三名上下文只讲分差', pl.rows[19].context.primary.includes('安全区'));
ok('中游同时给出两条分差线', pl.rows[4].context.secondary.includes('后三名'));

const ucl = computeStandings('UCL', fixtures);
ok('欧冠表为 36 队', ucl.rows.length === 36, `实际 ${ucl.rows.length}`);
ok('欧冠只算联赛阶段（每队 ≤ 8 场）', ucl.rows.every(row => row.played <= 8));
ok('欧冠有已同步赛果', ucl.doneCount > 0);
ok('第 8 名直通', ucl.rows[7].zoneKey === 'ucl-direct');
ok('第 9 名进入附加赛区', ucl.rows[8].zoneKey === 'ucl-playoff');
ok('第 24 名仍在附加赛区', ucl.rows[23].zoneKey === 'ucl-playoff');
ok('第 25 名落入出局区', ucl.rows[24].zoneKey === 'ucl-out');
ok('欧冠直通 chip 正确', ucl.rows[7].zoneLabel === '前8直通');
ok('欧冠附加赛 chip 正确', ucl.rows[8].zoneLabel === '附加赛区');
ok('欧冠出局 chip 正确', ucl.rows[24].zoneLabel === '出局区');
ok('欧冠直通上下文只讲分差', ucl.rows[7].context.primary.includes('第9名'));
ok('欧冠附加赛上下文只讲分差', ucl.rows[8].context.primary.includes('前8'));
ok('欧冠出局上下文只讲分差', ucl.rows[24].context.primary.includes('附加赛区'));

const bl = computeStandings('BL', fixtures);
ok('德甲表为 18 队', bl.rows.length === 18, `实际 ${bl.rows.length}`);
ok('18 队联赛第 15 名为中游', bl.rows[14].zoneKey === 'mid');
ok(
  '18 队联赛最后三名为风险区',
  bl.rows[15].zoneKey === 'bottom' && bl.rows[17].zoneKey === 'bottom'
);

console.log('\n六、常量口径');
ok('国内分区为前四/后三', DOMESTIC_ZONES.top === 4 && DOMESTIC_ZONES.bottom === 3);
ok('欧冠分区为 8/24/36', UCL_ZONES.direct === 8 && UCL_ZONES.playoff === 24);
ok('同分排序有明确说明', TIEBREAKER_NOTE.includes('同分') && TIEBREAKER_NOTE.includes('净胜球'));

console.log('\n' + '─'.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败项：');
  failures.forEach(item => console.log(' - ' + item));
  process.exitCode = 1;
}
