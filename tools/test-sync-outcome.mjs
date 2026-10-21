/**
 * 同步结果文案测试
 *
 * 回归：写盘失败时 HTTP 仍为 200，旧 UI 只看 written.changed，于是把
 * 「磁盘只读 / 校验未通过」显示成「已经是最新」——界面在说谎。
 *
 * 运行：node tools/test-sync-outcome.mjs
 */

import { summarizeSyncResponse } from '../src/core/sync-outcome.js';

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

console.log('同步结果文案测试');
console.log('');

/* 写盘失败 */
{
  const r = summarizeSyncResponse({
    summary: { written: { ok: false, reason: '磁盘只读' } }
  });
  ok('★ 写盘失败不报「已经是最新」', r.ok === false && r.text === '磁盘只读', JSON.stringify(r));
}

/* 校验失败：带具体 issues */
{
  const r = summarizeSyncResponse({
    summary: { written: { ok: false, reason: '校验未通过，已放弃写盘', issues: ['3 场次 st=done 但无比分'] } }
  });
  ok('★ 校验失败展示具体 issue',
    r.ok === false && r.text.includes('校验未通过') && r.text.includes('st=done 但无比分'),
    JSON.stringify(r));
}

/* 写盘失败但没给原因 */
{
  const r = summarizeSyncResponse({ summary: { written: { ok: false } } });
  ok('写盘失败缺 reason 时有兜底文案', r.ok === false && r.text === '写盘失败', JSON.stringify(r));
}

/* 成功且有变更 */
{
  const r = summarizeSyncResponse({ summary: { written: { ok: true, changed: 3 } } });
  ok('成功且有变更时显示场次数量', r.ok === true && r.text === '已更新 3 场比分', JSON.stringify(r));
}

/* 成功但无变更 */
{
  const r = summarizeSyncResponse({ summary: { written: { ok: true, changed: 0 } } });
  ok('成功且无变更才是「已经是最新」', r.ok === true && r.text === '已经是最新', JSON.stringify(r));
}

/* 旧服务端 / dryRun 缺 written：不得冒充「最新」 */
{
  const r = summarizeSyncResponse({ summary: { patches: 0 } });
  ok('缺 written 时不冒充「已经是最新」', r.ok === true && r.text === '同步完成', JSON.stringify(r));
}

/* 顶层错误 */
{
  const r = summarizeSyncResponse({ error: '已有同步任务进行中' });
  ok('顶层 error 原样展示', r.ok === false && r.text.includes('已有同步任务进行中'), JSON.stringify(r));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
