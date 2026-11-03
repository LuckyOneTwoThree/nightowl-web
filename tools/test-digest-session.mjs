/**
 * 晨间连续补看 · 游标状态机测试（离线）
 *
 * 守的是三条产品承诺：
 *   1. 顺序不丢 —— 会话列表是固定快照，标记已看不会让编号跳（第 2/3 场不会变成第 2/2 场）
 *   2. 两端不越界 —— 最后一场按「下一场」停在原地，而不是绕回第一场
 *   3. 标记已看并看下一场 —— 一次跨过所有已看项，不会连着停在几条看过的比赛上
 */
import { createDigestSession, digestPosition, stepDigest } from '../src/core/digest-session.js';

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
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('连续补看会话测试');
console.log('');
console.log('一、建立会话');

ok('空列表 → null', createDigestSession([]) === null);
ok('非数组 → null', createDigestSession(null) === null);
ok('全是空串 → null', createDigestSession(['', null, undefined]) === null);

const s3 = createDigestSession(['a', 'b', 'c']);
ok('1/3 起于第一条', s3.cursor === 0 && s3.ids.length === 3);
ok('重复 id 只留一份', createDigestSession(['a', 'a', 'b']).ids.join(',') === 'a,b');
ok('startId 命中则落在该条', createDigestSession(['a', 'b', 'c'], 'b').cursor === 1);
ok('startId 不在列表 → 回到第一条', createDigestSession(['a', 'b'], 'zzz').cursor === 0);
ok('startId 为空 → 第一条', createDigestSession(['a', 'b'], null).cursor === 0);

console.log('');
console.log('二、位置与计数');

const p0 = digestPosition(s3);
ok('首场位置', p0.id === 'a' && p0.index === 0 && p0.total === 3, JSON.stringify(p0));
ok('首场没有上一场', p0.hasPrev === false);
ok('首场有下一场', p0.hasNext === true);
ok('未启用队列时 watchedCount 为 0', p0.watchedCount === 0 && p0.remaining === 3);

const watchedB = new Set(['b']);
const pB = digestPosition({ ids: s3.ids, cursor: 1 }, watchedB);
ok('已看计入 watchedCount', pB.watchedCount === 1, JSON.stringify(pB));
ok('剩余场次 = 总数 - 已看', pB.remaining === 2, String(pB.remaining));

ok('空会话位置安全', digestPosition(null).id === null && digestPosition(null).index === -1);
ok('游标越界被夹住', digestPosition({ ids: ['a', 'b'], cursor: 9 }).id === 'b');
ok('负游标被夹住', digestPosition({ ids: ['a', 'b'], cursor: -3 }).id === 'a');

console.log('');
console.log('三、移动游标');

const s1 = stepDigest(s3, 1);
ok('下一场', digestPosition(s1).id === 'b');
ok('上一场回到首场', digestPosition(stepDigest(s1, -1)).id === 'a');
ok('首场按上一场停在原地', digestPosition(stepDigest(s3, -1)).id === 'a');
const sLast = { ids: s3.ids, cursor: 2 };
ok('末场按下一场停在原地', digestPosition(stepDigest(sLast, 1)).id === 'c');
ok('末场 hasNext 为 false', digestPosition(sLast).hasNext === false);
ok('不修改原会话（纯函数）', s3.cursor === 0);
ok('空会话移动后仍是空会话', stepDigest(null, 1) === null);

console.log('');
console.log('四、标记已看并看下一场（skip）');

const sA = { ids: ['a', 'b', 'c', 'd'], cursor: 0 };
const skipBC = new Set(['b', 'c']);
ok('跨过连续已看项', digestPosition(stepDigest(sA, 1, skipBC)).id === 'd');
ok('没有可跳过的项时就是下一场', digestPosition(stepDigest(sA, 1, new Set(['d']))).id === 'b');
ok('向后也要跨过已看项', digestPosition(stepDigest({ ids: sA.ids, cursor: 3 }, -1, skipBC)).id === 'a');
ok('后面全是已看 → 停在末场', digestPosition(stepDigest(sA, 1, new Set(['b', 'c', 'd']))).id === 'd');
ok('skip 为 null 时等价普通前进', digestPosition(stepDigest(sA, 1, null)).id === 'b');

console.log('');
console.log('五、快照稳定性（编号不跳）');

let session = createDigestSession(['a', 'b', 'c']);
session = stepDigest(session, 1);
ok('标记已看后列表长度不变', session.ids.length === 3, String(session.ids.length));
ok('标记已看后编号仍是第 2 场', digestPosition(session).index === 1);
ok('同一会话重复前进不会丢条目', stepDigest(stepDigest(session, 1), -1).ids.length === 3);

console.log('');
if (fail === 0) {
  console.log(`通过 ${pass} 项，失败 0 项`);
} else {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exitCode = 1;
}
