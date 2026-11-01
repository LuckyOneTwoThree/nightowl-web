/**
 * 比分同步请求层测试（离线，fetch 注入）
 *
 * 回归：同一个「同步」动作有两个调用方（App 自动同步 / 设置抽屉手动同步），
 * 此前各自解析响应，409（已有同步在跑）一处等待、一处报「同步失败」——
 * 界面会按你从哪个入口点而给出相反结论。
 *
 * 运行：node tools/test-score-sync.mjs
 */

import { requestScoreSync, SYNC_STATUS_BUSY } from '../src/api/score-sync.js';

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

/** 造一个只回一次响应的假 fetch；同时把调用参数记下来供断言 */
function fakeFetch({ status = 200, body = {}, throws = null }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw throws;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
  fn.calls = calls;
  return fn;
}

console.log('比分同步请求层测试');
console.log('');
console.log('一、请求形态');

{
  const f = fakeFetch({ body: { summary: { written: { ok: true, changed: 1 } } } });
  await requestScoreSync({ fetchImpl: f });
  ok('打到 /api/scores/sync（POST）',
    f.calls.length === 1 && f.calls[0].url === '/api/scores/sync' && f.calls[0].init.method === 'POST',
    JSON.stringify(f.calls[0]?.init));
  ok('默认 apply=true（要写盘）', JSON.parse(f.calls[0].init.body).apply === true);
}

{
  const f = fakeFetch({ body: {} });
  await requestScoreSync({ fetchImpl: f, apply: false });
  ok('apply 可关闭（预览模式）', JSON.parse(f.calls[0].init.body).apply === false);
}
{
  const f = fakeFetch({ body: {} });
  await requestScoreSync({ fetchImpl: f, matchId: 'PL-9-ARS-MCI' });
  ok('★ 单场重查把 matchId 带给服务端', JSON.parse(f.calls[0].init.body).matchId === 'PL-9-ARS-MCI');
}
{
  const f = fakeFetch({ body: {} });
  await requestScoreSync({ fetchImpl: f });
  ok('整轮同步不携带 matchId', !('matchId' in JSON.parse(f.calls[0].init.body)));
}

console.log('');
console.log('二、409 = 忙，不是失败');
{
  const f = fakeFetch({ status: 409, body: { error: '已有同步任务进行中' } });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('★ 409 归为 busy 且 ok=true', r.status === SYNC_STATUS_BUSY && r.ok === true, JSON.stringify(r));
  ok('★ 409 文案不说「失败」', !r.text.includes('失败'), r.text);
  ok('409 不解析业务载荷（payload 为 null）', r.payload === null);
}

console.log('');
console.log('三、服务端失败');
{
  const f = fakeFetch({ status: 503, body: { error: '保鲜模块已禁用' } });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('5xx 带上服务端原因', r.ok === false && r.status === 'failed' && r.text.includes('保鲜模块已禁用'), r.text);
}
{
  const f = fakeFetch({ status: 500, body: null });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('5xx 无 body 时有兜底文案', r.ok === false && r.text.includes('HTTP 500'), r.text);
}
{
  const f = fakeFetch({ throws: new Error('ECONNREFUSED') });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('网络异常归为 failed 并保留原因', r.ok === false && r.status === 'failed' && r.text.includes('ECONNREFUSED'), r.text);
  ok('网络异常的 httpStatus=0（调用方据此重置防抖）', r.httpStatus === 0);
}

console.log('');
console.log('四、HTTP 200 不等于写盘成功');
{
  const f = fakeFetch({ body: { summary: { written: { ok: false, reason: '磁盘只读' } } } });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('★ 写盘失败时 ok=false', r.ok === false && r.status === 'failed', JSON.stringify(r));
  ok('★ 写盘失败不报「已经是最新」', r.text === '磁盘只读', r.text);
}

console.log('');
console.log('五、成功路径沿用唯一判据');
{
  const fixtures = [{ id: 'PL-1-ARS-MCI' }];
  const f = fakeFetch({ body: { summary: { written: { ok: true, changed: 2 } }, fixtures } });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('有变更 → updated', r.ok === true && r.status === 'updated', r.text);
  ok('回传新 fixtures 供调用方热替换', Array.isArray(r.payload?.fixtures) && r.payload.fixtures.length === 1);
}
{
  const f = fakeFetch({ body: { summary: { written: { ok: true, changed: 0 } } } });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('无变更 → up_to_date', r.status === 'up_to_date' && r.text === '已经是最新', r.text);
}
{
  const f = fakeFetch({ body: { summary: { patches: 0, errors: 0, attempted: false, written: { ok: true, changed: 0 } } } });
  const r = await requestScoreSync({ fetchImpl: f });
  ok('attempted=false → not_needed（不是「最新」）', r.status === 'not_needed', r.text);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
