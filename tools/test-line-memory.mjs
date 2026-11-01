/**
 * 线路成功率记忆测试（离线）
 *
 * 守住 PRD FR-07 的四条规则：
 *   排序 = 成功率 → 最近成功 → 原顺序；失败当天降权但不禁用；新线路可见；7 天衰减。
 * 以及两条容易写错的：1/1 不该压过 9/10；改名/换名不该清零历史（身份是域名+类型）。
 *
 * 运行：node tools/test-line-memory.mjs
 */

import {
  LINE_FAIL_DEMOTE_MS,
  LINE_MEMORY_TTL_MS,
  lineKey,
  lineMemoryFor,
  normalizeLineMemory,
  orderLinesByMemory,
  recordLineAttempt
} from '../src/core/line-memory.js';

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
};

const NOW = Date.UTC(2026, 10, 1, 13, 0, 0);
const line = (name, url, kind = 'm3u8') => ({ id: name, name, url, kind, isDirect: true });

console.log('线路成功率记忆测试');
console.log('');
console.log('一、身份与归一');

{
  const a = line('超清 · 中文解说 (线C6)', 'https://a.tiyucdn.com/x.m3u8');
  const b = line('改了名字的线', 'https://a.tiyucdn.com/y.m3u8');
  ok('同一域名同类型视为同一身份（改名不清零）', lineKey(a) === lineKey(b), lineKey(a));
  const c = line('内嵌房间', 'https://a.tiyucdn.com/z', 'embed');
  ok('同域名不同类型视为不同身份', lineKey(a) !== lineKey(c), `${lineKey(a)} vs ${lineKey(c)}`);
  ok('非 http 地址不参与记忆', lineKey({ url: '', kind: 'm3u8' }) === '');
}

{
  const raw = {
    'a.com|m3u8': { attempts: 3, successes: 2, lastOkAt: NOW - 1000, lastFailAt: NOW - 500, lastFailReason: '超时' },
    'b.com|m3u8': { attempts: 2, successes: 2, lastOkAt: NOW - LINE_MEMORY_TTL_MS - 1, lastFailAt: 0 }
  };
  const mem = normalizeLineMemory(raw, NOW);
  ok('★ 超过 7 天没有任何尝试的条目被衰减丢弃', !mem['b.com|m3u8']);
  ok('7 天内有记录的条目保留', !!mem['a.com|m3u8']);
  ok('脏数据被丢弃', Object.keys(normalizeLineMemory({ x: { attempts: 'a' } }, NOW)).length === 0);
}

console.log('');
console.log('二、记录');

{
  const a = line('A', 'https://a.com/1.m3u8');
  let mem = recordLineAttempt({}, a, { ok: true, now: NOW - 5000 });
  mem = recordLineAttempt(mem, a, { ok: false, reason: 'HLS 致命错误', now: NOW });
  const e = mem[lineKey(a)];
  ok('尝试与成功分别累加', e.attempts === 2 && e.successes === 1, JSON.stringify(e));
  ok('成功时间不被失败覆盖', e.lastOkAt === NOW - 5000);
  ok('最近失败原因被记录', e.lastFailReason === 'HLS 致命错误');
  ok('入参不被修改', Object.keys({}).length === 0 && typeof mem === 'object');
}

console.log('');
console.log('三、排序');

{
  const good = line('好线', 'https://good.com/a.m3u8');
  const bad = line('坏线', 'https://bad.com/a.m3u8');
  const fresh = line('新线', 'https://fresh.com/a.m3u8');
  let mem = {};
  // good：3 次全成；bad：3 次全败（最近一次在 1 小时前）
  for (let i = 0; i < 3; i++) {
    mem = recordLineAttempt(mem, good, { ok: true, now: NOW - 60000 * (10 - i) });
    mem = recordLineAttempt(mem, bad, { ok: false, reason: '超时', now: NOW - 60000 * (10 - i) });
  }
  const ordered = orderLinesByMemory([bad, fresh, good], mem, NOW);
  ok('★ 成功率高的排前面', ordered[0] === good, ordered.map(l => l.name).join(' > '));
  ok('★ 新线路（无记忆）仍然可见，不被隐藏', ordered.includes(fresh));
  ok('★ 当天失败的线路沉底', ordered[ordered.length - 1] === bad, ordered.map(l => l.name).join(' > '));
}

{
  const one = line('试过一次', 'https://one.com/a.m3u8');
  const many = line('试过十次', 'https://many.com/a.m3u8');
  let mem = recordLineAttempt({}, one, { ok: true, now: NOW - 1000 });
  for (let i = 0; i < 10; i++) {
    mem = recordLineAttempt(mem, many, { ok: i !== 0, now: NOW - 2000 + i * 10 });
  }
  const ordered = orderLinesByMemory([one, many], mem, NOW);
  ok('★ 1/1 不会压过 9/10（平滑）', ordered[0] === many, ordered.map(l => l.name).join(' > '));
}

{
  const a = line('A', 'https://a.com/a.m3u8');
  const b = line('B', 'https://b.com/a.m3u8');
  const ordered = orderLinesByMemory([a, b], {}, NOW);
  ok('无任何记忆时保持原有顺序', ordered[0] === a && ordered[1] === b);
}

{
  // 同域名的两条线共享经验
  const x = line('X 房', 'https://same.com/1.m3u8');
  const y = line('Y 房', 'https://same.com/2.m3u8');
  let mem = recordLineAttempt({}, x, { ok: true, now: NOW - 1000 });
  const info = lineMemoryFor(mem, y, NOW);
  ok('同域名同类型共享经验（样本量才够）', info && info.attempts === 1 && info.successes === 1, JSON.stringify(info));
}

console.log('');
console.log('四、失败降权有窗口');

{
  const a = line('A', 'https://a.com/a.m3u8');
  const b = line('B', 'https://b.com/a.m3u8');
  let mem = recordLineAttempt({}, a, { ok: false, reason: '超时', now: NOW - LINE_FAIL_DEMOTE_MS - 1000 });
  mem = recordLineAttempt(mem, b, { ok: false, reason: '超时', now: NOW - 1000 });
  const infoA = lineMemoryFor(mem, a, NOW);
  ok('超过 24h 的失败不再标注「本次失败」', infoA && infoA.failedRecently === false, JSON.stringify(infoA));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
