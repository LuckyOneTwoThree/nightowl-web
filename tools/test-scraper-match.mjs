/**
 * 抓取匹配逻辑单元测试（**纯离线**，进 test:all）
 *
 * 为什么单独成文件：
 *   原来 check-scraper.mjs 的「P0 回归」自己重写了一遍匹配规则，
 *   用的是和被测代码同样的写法 —— 结构上不可能发现匹配本身的缺陷
 *   （比如「多候选时永远取第一条」这类问题，自己抄自己无论如何都测不出来）。
 *   现在改为直接调用 scraper 导出的真实函数 findRoomFor。
 *
 * 运行：node tools/test-scraper-match.mjs
 */

import { findRoomFor } from '../server/scraper.js';

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

/** 构造一个房间条目 */
const R = (gameId, homeId, awayId, time, homeRaw, awayRaw) => ({
  gameId,
  homeId,
  awayId,
  time,
  homeRaw: homeRaw || homeId,
  awayRaw: awayRaw || awayId,
  statusText: '',
  isLive: false
});

console.log('抓取匹配逻辑单元测试');
console.log('');

/* ================================================================== */
console.log('一、双方全等（禁止单队兜底 —— P0 铁律）');

{
  const sched = [R('1', 'MUN', 'MCI', '23:30')];

  ok('双方全等命中', findRoomFor(sched, { h: 'MUN', a: 'MCI', t: '2026-09-13T23:30' }).room?.gameId === '1');
  ok('主客互换同样命中（同一场的两种呈现）',
    findRoomFor(sched, { h: 'MCI', a: 'MUN', t: '2026-09-13T23:30' }).room?.gameId === '1');

  // 这是曾经造成 329/329 全错的形态：只要有一边对得上就命中
  const r = findRoomFor(sched, { h: 'MUN', a: 'SAB', t: '2026-09-13T23:30' });
  ok('★ 单队相同但对手不同 → 不匹配（否则会播成曼联 vs 曼城）', r.room === null, JSON.stringify(r));

  const r2 = findRoomFor(sched, { h: 'FCB', a: 'MCI', t: '2026-09-13T23:30' });
  ok('★ 客队相同但主队不同 → 不匹配', r2.room === null);

  ok('完全没有对阵 → 返回 null', findRoomFor(sched, { h: 'ARS', a: 'CHE' }).room === null);
  ok('空赛程不抛错', findRoomFor([], { h: 'ARS', a: 'CHE' }).room === null);
  ok('赛程为 null 不抛错', findRoomFor(null, { h: 'ARS', a: 'CHE' }).room === null);
}

/* ================================================================== */
console.log('');
console.log('二、多候选时按开球时刻做邻近度选择（P2-1）');

{
  // 真实形态：同一对阵同时挂着两个房间（实测「科莫 vs 帕尔马」= 21:00 与 00:30）
  const sched = [
    R('126025', 'COM', 'PAR', '21:00'),
    R('127688', 'COM', 'PAR', '00:30')
  ];

  const pickLate = findRoomFor(sched, { h: 'COM', a: 'PAR', t: '2026-09-13T21:00' });
  ok('★ 本场是 21:00 → 选中 21:00 的房间（而非列表第一条碰巧）',
    pickLate.room?.gameId === '126025', `实际 ${pickLate.room?.gameId}`);
  ok('此时不算歧义（两个候选距离不同）', pickLate.ambiguous === false);
  ok('记录了候选数与选择依据', pickLate.candidates === 2 && pickLate.pickedBy === 'time-proximity');

  const pickEarly = findRoomFor(sched, { h: 'COM', a: 'PAR', t: '2026-09-14T00:30' });
  ok('★ 本场是 00:30 → 选中 00:30 的房间（这是原实现必然选错的情形）',
    pickEarly.room?.gameId === '127688', `实际 ${pickEarly.room?.gameId}`);

  // 候选顺序颠倒也要给出同样结论（证明不是靠"取第一条"蒙对）
  const reversed = [sched[1], sched[0]];
  ok('候选顺序颠倒后结论一致（依赖排序而非顺序）',
    findRoomFor(reversed, { h: 'COM', a: 'PAR', t: '2026-09-14T00:30' }).room?.gameId === '127688');
}

/* ================================================================== */
console.log('');
console.log('三、无法判定时的行为');

{
  const sched = [R('a', 'ATM', 'FCB', '04:00'), R('b', 'ATM', 'FCB', '04:00')];

  const noT = findRoomFor(sched, { h: 'ATM', a: 'FCB' });
  ok('缺少本场时刻时退回第一条', noT.room?.gameId === 'a');
  ok('★ 但显式标记 ambiguous，供界面提示用户确认', noT.ambiguous === true);
  ok('标记选择依据为 first', noT.pickedBy === 'first');

  const sameTime = findRoomFor(sched, { h: 'ATM', a: 'FCB', t: '2026-11-04T04:00' });
  ok('两个候选时刻相同 → 同样标记 ambiguous', sameTime.ambiguous === true);

  const sched2 = [R('x', 'AAA', 'BBB', '待定'), R('y', 'AAA', 'BBB', '21:00')];
  const badTime = findRoomFor(sched2, { h: 'AAA', a: 'BBB', t: '2026-09-13T21:00' });
  ok('无法解析时刻的候选被排到最后', badTime.room?.gameId === 'y', `实际 ${badTime.room?.gameId}`);
}

/* ================================================================== */
console.log('');
console.log('四、跨零点环绕（凌晨场次必须正确）');

{
  // 本场 00:10；候选 23:50（前一日深夜，差 20 分钟）与 12:00（差 11 小时 50 分）
  const sched = [R('noon', 'AAA', 'BBB', '12:00'), R('midnight', 'AAA', 'BBB', '23:50')];
  const r = findRoomFor(sched, { h: 'AAA', a: 'BBB', t: '2026-09-14T00:10' });
  ok('★ 00:10 本场应选中 23:50（差 20 分钟）而不是 12:00（差 11h50m）',
    r.room?.gameId === 'midnight', `实际 ${r.room?.gameId}`);
}

/* ================================================================== */
console.log('');
console.log('五、脏数据健壮性');

{
  const sched = [
    { gameId: 'noIds', homeId: null, awayId: 'MCI', time: '23:30' },
    R('ok', 'MUN', 'MCI', '23:30')
  ];
  const r = findRoomFor(sched, { h: 'MUN', a: 'MCI', t: '2026-09-13T23:30' });
  ok('缺少球队 id 的条目被跳过', r.room?.gameId === 'ok');
  ok('候选数只计有效条目', r.candidates === 1);
}

/* ================================================================== */
console.log('');
console.log('六、全量真实数据交叉核对（用本地 fixtures 的球队组合，确认零误配）');

{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const fixtures = JSON.parse(readFileSync(resolve(ROOT, 'src/data/fixtures.json'), 'utf8'));

  // 用「所有出现过的对阵」造一个合成赛程，逐一验证匹配结果必定是同一对阵
  const seen = new Map();
  for (const m of fixtures) {
    const k = [m.h, m.a].sort().join('|');
    if (!seen.has(k)) seen.set(k, R(`g${seen.size}`, m.h, m.a, m.t.split('T')[1]));
  }
  const synthetic = [...seen.values()];

  let tested = 0;
  let mismatched = 0;
  for (const m of fixtures.slice(0, 600)) {
    const r = findRoomFor(synthetic, { h: m.h, a: m.a, t: m.t });
    if (!r.room) continue;
    tested++;
    const good =
      (r.room.homeId === m.h && r.room.awayId === m.a) ||
      (r.room.homeId === m.a && r.room.awayId === m.h);
    if (!good) mismatched++;
  }
  ok(`在 ${tested} 场抽样中零误配`, mismatched === 0, `${mismatched} 场误配`);
  ok('抽样量足够（>300）', tested > 300, `仅 ${tested} 场`);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
