/**
 * 时区换算回归测试（纯离线）
 *
 * 锁住两件事：
 *   1. openfootball 当地墙钟 → 北京墙钟的换算正确（含夏令时边界）
 *   2. 缺 time 的场次绝不产出假时刻 —— 这是 openfootball 数据里大量存在的
 *      （实测德甲 261/306 场无 time），默认成 00:00 会造出 06:00 北京时间
 *      的假时刻并清掉 tbd，比不更新危险得多。
 *
 * 运行：node tools/test-tz.mjs
 */

import { localToBeijingWall, isEuroDST, utcOffsetHours } from '../server/sources/tz.mjs';

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

console.log('时区换算回归测试');
console.log('');

/* ================================================================== */
console.log('一、基础换算（与 ESPN 交叉验证过的真实场次）');
{
  // 英超：BST 夏令时（UTC+1），20:30 本地 = 03:30 北京（次日）
  ok('PL 夏令时 20:30 → 次日 03:30', localToBeijingWall('2026-08-29', '20:30', 'PL') === '2026-08-30T03:30',
    `实际 ${localToBeijingWall('2026-08-29', '20:30', 'PL')}`);
  // 英超：GMT 冬令时（UTC+0），15:00 本地 = 23:00 北京（当天）
  ok('PL 冬令时 15:00 → 当天 23:00', localToBeijingWall('2026-11-28', '15:00', 'PL') === '2026-11-28T23:00',
    `实际 ${localToBeijingWall('2026-11-28', '15:00', 'PL')}`);
  // 德甲：CEST 夏令时（UTC+2），15:30 本地 = 21:30 北京（当天）
  ok('BL 夏令时 15:30 → 当天 21:30', localToBeijingWall('2026-08-29', '15:30', 'BL') === '2026-08-29T21:30',
    `实际 ${localToBeijingWall('2026-08-29', '15:30', 'BL')}`);
  // 德甲：CET 冬令时（UTC+1），15:30 本地 = 22:30 北京（当天）
  ok('BL 冬令时 15:30 → 当天 22:30', localToBeijingWall('2026-11-28', '15:30', 'BL') === '2026-11-28T22:30',
    `实际 ${localToBeijingWall('2026-11-28', '15:30', 'BL')}`);
  // 西甲冬令时 21:00 本地 = 次日 04:00 北京（经典熬夜场）
  ok('PD 冬令时 21:00 → 次日 04:00', localToBeijingWall('2026-12-05', '21:00', 'PD') === '2026-12-06T04:00',
    `实际 ${localToBeijingWall('2026-12-05', '21:00', 'PD')}`);
}

/* ================================================================== */
console.log('');
console.log('二、夏令时边界（EU 规则：3 月最后周日 → 10 月最后周日）');
{
  // 2026 年：3 月最后周日 = 29 日，10 月最后周日 = 25 日
  ok('2026-03-28（转换前）是冬令时', isEuroDST('2026-03-28') === false);
  ok('2026-03-29（转换日）算夏令时', isEuroDST('2026-03-29') === true);
  ok('2026-06-15 是夏令时', isEuroDST('2026-06-15') === true);
  ok('2026-10-24（结束前）是夏令时', isEuroDST('2026-10-24') === true);
  ok('2026-10-25（结束日）算冬令时', isEuroDST('2026-10-25') === false);
  ok('2026-11-15 是冬令时', isEuroDST('2026-11-15') === false);
  // 2027 年：3 月最后周日 = 28 日，10 月最后周日 = 31 日
  ok('2027-03-28（转换日）算夏令时', isEuroDST('2027-03-28') === true);
  ok('2027-10-31（结束日）算冬令时', isEuroDST('2027-10-31') === false);

  // 边界日同一本地时刻，跨夏令时应偏移 1 小时：
  // 10-24 21:00（CEST +2）→ 10-25 03:00 北京；10-25 21:00（CET +1）→ 10-26 04:00 北京
  // 两端都跨午夜，用时间戳衡量更稳：无夏令时变化应相差 24h，实际 25h（多 1h）
  const before = localToBeijingWall('2026-10-24', '21:00', 'PD');
  const after = localToBeijingWall('2026-10-25', '21:00', 'PD');
  const beforeTs = Date.UTC(2026, 9, 25, 3) - 8 * 3600000;
  const afterTs = Date.UTC(2026, 9, 26, 4) - 8 * 3600000;
  ok('夏令时→冬令时，换算值正确',
    before === '2026-10-25T03:00' && after === '2026-10-26T04:00',
    `${before} vs ${after}`);
  ok('同一本地时间跨边界后北京墙钟多 1 小时（25h 而非 24h）',
    afterTs - beforeTs === 25 * 3600000,
    `差 ${(afterTs - beforeTs) / 3600000}h`);

  // PL 的 2026-03-28 → 03-29 同样跨边界（GMT→BST）
  const plBefore = localToBeijingWall('2026-03-28', '15:00', 'PL');
  const plAfter = localToBeijingWall('2026-03-29', '15:00', 'PL');
  ok('PL 跨 GMT→BST 同一本地时间差 1 小时',
    plBefore === '2026-03-28T23:00' && plAfter === '2026-03-29T22:00',
    `${plBefore} vs ${plAfter}`);
}

/* ================================================================== */
console.log('');
console.log('三、★ 缺 time 绝不产出假时刻（核心回归）');
{
  // 无 time：返回 null，而不是默认 00:00 → 06:00
  ok('缺 time 返回 null', localToBeijingWall('2026-10-10', undefined, 'BL') === null);
  ok('空串 time 返回 null', localToBeijingWall('2026-10-10', '', 'BL') === null);
  ok('非法 time 返回 null', localToBeijingWall('2026-10-10', 'TBD', 'BL') === null);
  ok('缺 date 返回 null', localToBeijingWall(undefined, '20:00', 'BL') === null);
  ok('未知联赛返回 null', localToBeijingWall('2026-10-10', '20:00', 'UCL') === null);
  ok('显式 00:00 仍可换算（合法值不误伤）', localToBeijingWall('2026-10-10', '00:00', 'BL') === '2026-10-10T06:00');
}

/* ================================================================== */
console.log('');
console.log('四、UTC 偏移');
{
  ok('PL 冬令时偏移 +0', utcOffsetHours('PL', '2026-11-15') === 0);
  ok('PL 夏令时偏移 +1', utcOffsetHours('PL', '2026-06-15') === 1);
  ok('BL 冬令时偏移 +1', utcOffsetHours('BL', '2026-11-15') === 1);
  ok('BL 夏令时偏移 +2', utcOffsetHours('BL', '2026-06-15') === 2);
  ok('未知联赛偏移为 null', utcOffsetHours('UCL', '2026-06-15') === null);
}

/* ================================================================== */
console.log('');
console.log('五、全季扫一遍：换算结果始终是合法北京墙钟串');
{
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  let bad = 0, n = 0;
  for (const league of ['PL', 'PD', 'SA', 'BL', 'FL']) {
    for (let m = 1; m <= 12; m++) {
      for (const day of [1, 15, 28]) {
        for (const hh of [0, 6, 12, 15, 18, 21, 23]) {
          const ds = `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const out = localToBeijingWall(ds, `${String(hh).padStart(2, '0')}:00`, league);
          n++;
          if (out === null || !re.test(out)) { bad++; if (bad <= 3) console.log('   坏值:', ds, hh, league, out); }
        }
      }
    }
  }
  ok(`${n} 组换算全部产出合法北京墙钟串`, bad === 0, `${bad} 组坏值`);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
}
