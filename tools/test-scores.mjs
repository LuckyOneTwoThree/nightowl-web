/**
 * 保鲜折算与写盘校验测试
 *
 * 核心回归：一条「声称完赛但比分不全」的事件，此前会产出 { st:'done' } 的半套补丁，
 * 导致写盘前校验失败、sync-scores --apply **整批中止** —— 其余完全合法的补丁一起丢，
 * 而唯一"解法"是手工改数据文件（违反本仓「数据只走脚本」的铁律）。
 * 现在改为：该事件单条跳过，其余照常落盘。
 *
 * 运行：node tools/test-scores.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { planPatches, applyPatches, validateFixtures, ALLOWED_ST, activeSyncTargets } from '../server/scores.js';
import { createServer } from '../server/index.js';
import { loadRules } from '../server/proxy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(readFileSync(resolve(ROOT, 'src/data/fixtures.json'), 'utf8'));

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

const pick = id => fixtures.find(m => m.id === id);

console.log('保鲜折算与写盘校验测试');
console.log('');

/* ================================================================== */
console.log('一、前置校验：声称完赛必须带完整比分');
{
  const dirty = pick('PL-4-MUN-MCI');
  const good1 = pick('PL-4-TOT-EVE');
  const good2 = pick('PL-4-LIV-FUL');
  ok('测试样本存在', !!(dirty && good1 && good2));

  const merged = [
    // 脏事件：state=done 但两个比分都是 null
    { league: 'PL', homeId: dirty.h, awayId: dirty.a, kickoff: dirty.t, state: 'done', homeScore: null, awayScore: null, sources: ['espn'], scoreSource: 'espn' },
    { league: 'PL', homeId: good1.h, awayId: good1.a, kickoff: good1.t, state: 'done', homeScore: '2', awayScore: '1', sources: ['espn'], scoreSource: 'espn' },
    { league: 'PL', homeId: good2.h, awayId: good2.a, kickoff: good2.t, state: 'done', homeScore: '0', awayScore: '3', sources: ['openfootball'], scoreSource: 'openfootball' }
  ];

  const { patches, stats, incompleteScore } = planPatches(merged, fixtures);

  ok('★ 脏事件被计数', stats.skippedIncompleteScore === 1, `实际 ${stats.skippedIncompleteScore}`);
  ok('★ 脏事件未产出补丁', !patches.has(dirty.id), `补丁里有 ${dirty.id}`);
  ok('脏事件被记录到 incompleteScore 供排查', incompleteScore.length === 1 && incompleteScore[0].h === dirty.h);
  ok('记录了拿到的残缺值', /homeScore=null/.test(incompleteScore[0].got || ''), incompleteScore[0]?.got);
  ok('合法事件照常产出补丁', patches.has(good1.id) && patches.has(good2.id));
  ok('补丁总数为 2（脏事件未污染）', patches.size === 2, `实际 ${patches.size}`);

  const { fixtures: next, changed } = applyPatches(fixtures, patches);
  ok('应用后改动 2 场', changed === 2, `实际 ${changed}`);

  // 这是最关键的一条：写盘校验必须通过，否则 --apply 会整批中止
  const issues = validateFixtures(next);
  ok('★ 写盘校验通过（不再整批中止）', issues.length === 0, issues.join(' | '));
}

/* ================================================================== */
console.log('');
console.log('二、对照：旧行为确实会让整批失败');
{
  const dirty = fixtures.find(m => m.st === 'sched' && !m.sc) || pick('PL-4-MUN-MCI');
  // 手工构造旧行为会产出的半套补丁
  const legacyPatches = new Map([[dirty.id, { st: 'done', sc: undefined }]]);
  const { fixtures: legacyNext } = applyPatches(fixtures, legacyPatches);
  const legacyIssues = validateFixtures(legacyNext);

  ok('旧式半套补丁会导致校验失败（前提校验）', legacyIssues.length > 0, legacyIssues.join(' | '));
  ok('失败原因正是「done 但无比分」', /st=done 但无比分/.test(legacyIssues[0] || ''), legacyIssues[0]);
}

/* ================================================================== */
console.log('');
console.log('三、validateFixtures 列出全部 offender（不再只报第一个）');
{
  const manyBad = fixtures.map((m, i) =>
    m.id.startsWith('PL-4-') && i % 2 === 0 ? { ...m, st: 'bogus' } : m
  );
  const issues = validateFixtures(manyBad);
  ok('检出非法 st', issues.some(i => /不在取值域/.test(i)));

  const stIssue = issues.find(i => /不在取值域/.test(i)) || '';
  const listed = (stIssue.match(/PL-4-[A-Z]{3}-[A-Z]{3}=bogus/g) || []).length;
  ok('★ 列出了多个具体 offender（而非仅第一个）', listed >= 5, `列出 ${listed} 个：${stIssue.slice(0, 120)}`);

  // 超过 10 个时应提示总数
  const more = fixtures.map(m => ({ ...m, st: 'bogus' }));
  const issues2 = validateFixtures(more);
  ok('数量很多时给出总数上限提示', /共 \d+ 场/.test(issues2[0] || ''), issues2[0]);

  // 干净数据不误报
  ok('当前真实数据通过校验', validateFixtures(fixtures).length === 0, validateFixtures(fixtures).join(' | '));
}

/* ================================================================== */
console.log('');
console.log('四、取值域与边界');
{
  ok('取值域为 sched/done/pp', JSON.stringify(ALLOWED_ST) === JSON.stringify(['sched', 'done', 'pp']));

  const m = pick('PL-4-MUN-MCI');
  // 进行中不落库
  const r1 = planPatches(
    [{ league: 'PL', homeId: m.h, awayId: m.a, kickoff: m.t, state: 'live', homeScore: '1', awayScore: '0', sources: ['espn'] }],
    fixtures
  );
  ok('进行中事件不落库（铁律）', r1.patches.size === 0 && r1.stats.skippedLive === 1);

  // 比分格式异常（非数字）
  const r2 = planPatches(
    [{ league: 'PL', homeId: m.h, awayId: m.a, kickoff: m.t, state: 'done', homeScore: 'x', awayScore: 'y', sources: ['espn'] }],
    fixtures
  );
  ok('非数字比分同样被前置校验拦下', r2.patches.size === 0 && r2.stats.skippedIncompleteScore === 1);

  // 比分是 0 也必须算「齐全」（falsy 陷阱）
  const r3 = planPatches(
    [{ league: 'PL', homeId: m.h, awayId: m.a, kickoff: m.t, state: 'done', homeScore: '0', awayScore: '0', sources: ['espn'] }],
    fixtures
  );
  ok('★ 0-0 被视为完整比分（不受 falsy 影响）', r3.patches.get(m.id)?.sc === '0-0', JSON.stringify([...r3.patches]));
}

/* ================================================================== */
console.log('');
console.log('五、增量定向同步（activeSyncTargets）');
{
  const now = new Date('2026-09-16T15:00:00+08:00').getTime();
  const sampleFixtures = [
    // 1. 已完赛且有比分：必须被排除
    { id: '1', l: 'PL', t: '2026-09-14T03:00', st: 'done', sc: '3-0' },
    // 2. 过去未完赛（待录入）：必须纳入目标
    { id: '2', l: 'PL', t: '2026-09-15T03:00', st: 'sched', sc: null },
    // 3. 未来 24 小时内的比赛：必须纳入目标
    { id: '3', l: 'PD', t: '2026-09-17T03:00', st: 'sched', sc: null },
    // 4. 远期比赛（12 天后）：必须排除
    { id: '4', l: 'SA', t: '2026-09-28T03:00', st: 'sched', sc: null },
    // 5. 延期无确切时间：排除
    { id: '5', l: 'BL', t: null, st: 'pp', sc: null }
  ];

  const targets = activeSyncTargets(sampleFixtures, now);
  ok('已完赛记录不纳入同步目标', !targets.get('PL')?.has('20260913'));
  ok('未同步的过去比赛纳入目标并准确转换为 UTC 日期', targets.get('PL')?.has('20260914'));
  ok('近期未来比赛纳入目标', targets.get('PD')?.has('20260916'));
  ok('远期比赛不纳入目标', !targets.has('SA'));
  ok('无时间的改期比赛不纳入目标', !targets.has('BL'));
}

/* ================================================================== */
console.log('');
console.log('六、HTTP API 端点集成（防 written 变量未声明与 500 回归）');
{
  const rules = loadRules();
  const server = createServer(rules, { log: () => {}, warn: () => {}, error: () => {} });
  const port = await new Promise((res, rej) => {
    server.listen(0, '127.0.0.1', () => res(server.address().port));
    server.on('error', rej);
  });

  try {
    // 1. GET /api/scores/status
    const rStatus = await fetch(`http://127.0.0.1:${port}/api/scores/status`);
    const jStatus = await rStatus.json();
    ok('GET /api/scores/status 返回 200', rStatus.status === 200);
    ok('状态包含 freshness 对象', !!jStatus.freshness);

    // 2. POST /api/scores/sync（dryRun）
    const rDry = await fetch(`http://127.0.0.1:${port}/api/scores/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: false })
    });
    const jDry = await rDry.json();
    ok('POST /api/scores/sync (dryRun) 返回 200', rDry.status === 200);
    ok('dryRun 标志为 true', jDry.dryRun === true);

    // 3. POST /api/scores/sync (apply=true, 关键回归：written 未声明曾导致 ReferenceError 500)
    const rApply = await fetch(`http://127.0.0.1:${port}/api/scores/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: true })
    });
    const jApply = await rApply.json();
    ok('★ POST /api/scores/sync (apply=true) 返回 200 且无 500 ReferenceError', rApply.status === 200, jApply.error);
    ok('落盘摘要 written 对象有效', !!jApply.summary?.written && jApply.summary.written.ok === true);
  } finally {
    await new Promise(r => server.close(r));
  }
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
