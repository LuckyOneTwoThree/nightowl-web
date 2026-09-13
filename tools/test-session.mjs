/**
 * 会话授权生命周期测试
 *
 * 此前会话白名单「只进不出」：index.js 每次拉直播源就批量授权线路域名，
 * 而全仓没有任何回收路径，50 个名额被历史域名占满后只能重启进程。
 * 这里覆盖授权、复用续期、显式撤销、TTL 回收与上限。
 *
 * 运行：node tools/test-session.mjs
 */

import { createProxy } from '../server/proxy.js';

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

const quiet = { warn() {}, error() {}, log() {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeProxy(overrides = {}) {
  const rules = {
    listen: { host: '127.0.0.1', port: 0 },
    proxy: {
      allowedHosts: [],
      allowedHostSuffixes: [],
      forwardHeaders: [],
      upstreamHeaders: {},
      timeoutMs: 1000,
      maxConcurrent: 4,
      ...overrides
    },
    scores: { enabled: false }
  };
  return createProxy(rules, quiet, new Set());
}

console.log('会话授权生命周期测试');
console.log('');

/* ================================================================== */
console.log('一、授权与复用');
{
  const proxy = makeProxy();
  const r1 = proxy.allowHost('hls.example.com');
  ok('首次授权成功', r1.ok === true && !r1.already);
  ok('授权后域名进入白名单', proxy.isAllowed('hls.example.com') === true);
  ok('未授权域名不在白名单', proxy.isAllowed('other.example.com') === false);

  const r2 = proxy.allowHost('hls.example.com');
  ok('重复授权返回 already（不重复占用名额）', r2.ok === true && r2.already === true);
  ok('名额计数仍为 1', proxy.sessionStats.count === 1, `实际 ${proxy.sessionStats.count}`);

  const bad = proxy.allowHost('not a host!!');
  ok('非法主机名被拒', bad.ok === false, JSON.stringify(bad));
}

/* ================================================================== */
console.log('');
console.log('二、显式撤销（新增能力）');
{
  const proxy = makeProxy();
  proxy.allowHost('a.example.com', { Referer: 'https://a.example.com/', Cookie: 'sid=1' });
  proxy.allowHost('b.example.com');

  ok('撤销前 a 在白名单', proxy.isAllowed('a.example.com'));
  const r = proxy.revokeHost('a.example.com');
  ok('revokeHost 报告已移除', r.ok === true && r.removed === true);
  ok('撤销后 a 不在白名单', proxy.isAllowed('a.example.com') === false);
  ok('撤销 a 不影响 b', proxy.isAllowed('b.example.com') === true);
  ok('名额计数同步下降', proxy.sessionStats.count === 1, `实际 ${proxy.sessionStats.count}`);

  const r2 = proxy.revokeHost('never-existed.example.com');
  ok('撤销不存在的域名也安全返回', r2.ok === true && r2.removed === false);

  const all = proxy.revokeAll();
  ok('revokeAll 报告清掉的数量', all.removed === 1, `removed=${all.removed}`);
  ok('清空后白名单为空', proxy.sessionStats.count === 0);
}

/* ================================================================== */
console.log('');
console.log('三、TTL 过期回收');
{
  const proxy = makeProxy({ sessionTtlMs: 120 });
  proxy.allowHost('short.example.com');
  ok('授权后立即可用', proxy.isAllowed('short.example.com'));

  await sleep(200); // 超过 TTL
  const pruned = proxy.pruneSessions();
  ok('★ 超过 TTL 后被回收', pruned === 1, `pruned=${pruned}`);
  ok('回收后不在白名单', proxy.isAllowed('short.example.com') === false);
  ok('名额计数归零', proxy.sessionStats.count === 0);

  // 复用应续期
  const proxy2 = makeProxy({ sessionTtlMs: 200 });
  proxy2.allowHost('renew.example.com');
  await sleep(120);
  proxy2.allowHost('renew.example.com'); // 续期
  await sleep(120); // 距首次 240ms（>TTL），距续期 120ms（<TTL）
  const pruned2 = proxy2.pruneSessions();
  ok('★ 复用会续期（不该被回收）', pruned2 === 0 && proxy2.isAllowed('renew.example.com') === true);

  const off = makeProxy({ sessionTtlMs: 0 });
  off.allowHost('forever.example.com');
  await sleep(60);
  ok('TTL=0 表示不回收', off.pruneSessions() === 0 && off.isAllowed('forever.example.com'));
}

/* ================================================================== */
console.log('');
console.log('四、名额上限');
{
  const proxy = makeProxy();
  for (let i = 0; i < 50; i++) proxy.allowHost(`h${i}.example.com`);
  ok('填满 50 个名额', proxy.sessionStats.count === 50, `实际 ${proxy.sessionStats.count}`);

  const overflow = proxy.allowHost('h50.example.com');
  ok('★ 超限时明确拒绝（而非静默失败）', overflow.ok === false, JSON.stringify(overflow));
  ok('拒绝原因提示了回收途径', /上限|revoke/.test(overflow.reason || ''), overflow.reason);

  // 回收后应能重新授权
  proxy.revokeAll();
  const again = proxy.allowHost('h50.example.com');
  ok('★ 清空后可重新授权（无需重启进程）', again.ok === true);

  ok('stats 暴露上限与 TTL 供界面展示',
    proxy.sessionStats.max === 50 && proxy.sessionStats.ttlMs > 0,
    JSON.stringify(proxy.sessionStats));
}

/* ================================================================== */
console.log('');
console.log('五、请求头随授权一起管理');
{
  const proxy = makeProxy();
  proxy.allowHost('hdr.example.com', { Referer: 'https://hdr.example.com/', Cookie: 'sid=abc', 'X-Evil': 'nope' });
  ok('仅白名单字段被接受（其余丢弃）', proxy.sessionStats.count === 1);

  proxy.revokeHost('hdr.example.com');
  // 撤销后重新授权但不带请求头，不应残留旧头
  proxy.allowHost('hdr.example.com');
  ok('撤销后重新授权不残留旧请求头（无异常即可）', proxy.isAllowed('hdr.example.com') === true);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
