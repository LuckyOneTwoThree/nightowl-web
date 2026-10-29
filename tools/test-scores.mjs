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
import { planPatches, applyPatches, validateFixtures, ALLOWED_ST, activeSyncTargets, uclWeeklyTargets, seasonMonths } from '../server/scores.js';
import { createServer } from '../server/index.js';
import { loadRules } from '../server/proxy.js';
import { freshness } from '../server/data-store.js';
import { ts } from '../src/core/engine.js';

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
    { id: '1', l: 'PL', t: '2026-09-12T03:00', st: 'done', sc: '3-0' },
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
  ok('已完赛记录不纳入同步目标', !targets.get('PL')?.has('20260911'));
  ok('未同步的过去比赛纳入目标并准确转换为 UTC 日期', targets.get('PL')?.has('20260914'));
  ok('★ 待录场次同时查询前后一天（覆盖改期/源日期漂移）',
    targets.get('PL')?.has('20260913') && targets.get('PL')?.has('20260915'),
    [...(targets.get('PL') || [])].join(','));
  ok('近期未来比赛纳入目标', targets.get('PD')?.has('20260916'));
  ok('未来比赛不展开前后一天', targets.get('PD')?.size === 1, `实际 ${targets.get('PD')?.size}`);
  ok('远期比赛不纳入目标', !targets.has('SA'));
  ok('无时间的改期比赛不纳入目标', !targets.has('BL'));
}

/* ================================================================== */
console.log('');
console.log('五·二、★ tbd 占位轮的查询日期展开（防止整轮漏同步）');
{
  // 背景：tbd 轮整轮共用一个占位时间（实测 108/108 轮如此），
  // 但一轮跨周五/周六/周日。只查占位日会漏掉其余日子的场次，
  // 它们永久停在 tbd，开球后表现为「上游未提供」。
  const now = new Date('2026-09-16T15:00:00+08:00').getTime();
  const sampleFixtures = [
    // tbd 场次：占位 2026-09-18T03:00（北京）→ UTC 2026-09-17（须落在 48h 窗口内）
    { id: 't1', l: 'BL', t: '2026-09-18T03:00', st: 'sched', sc: null, tbd: true },
    // 非 tbd 场次：时间已确认，不需要展开
    { id: 't2', l: 'PL', t: '2026-09-18T03:00', st: 'sched', sc: null, tbd: false }
  ];

  const targets = activeSyncTargets(sampleFixtures, now);

  // tbd：占位日 ±3 天，共 7 个查询日期
  const blDates = targets.get('BL');
  ok('tbd 场次展开为 7 个查询日期（占位日 ±3 天）', blDates?.size === 7, `实际 ${blDates?.size}`);
  ok('tbd 展开包含占位日本身', blDates?.has('20260917'));
  ok('tbd 展开包含前 3 天', ['20260914', '20260915', '20260916'].every(x => blDates?.has(x)));
  ok('tbd 展开包含后 3 天', ['20260918', '20260919', '20260920'].every(x => blDates?.has(x)));

  // 非 tbd：只有占位日 1 个
  ok('非 tbd 场次只生成 1 个查询日期（不展开）', targets.get('PL')?.size === 1, `实际 ${targets.get('PL')?.size}`);
  ok('非 tbd 场次的查询日期就是其真实日期', targets.get('PL')?.has('20260917'));
}

/* ================================================================== */
console.log('');
console.log('五·二·二、★ 回填模式（历史 tbd 占位轮按 ±3 天展开）');
{
  const now = new Date('2026-10-21T15:00:00+08:00').getTime();
  const oldTbd = { id: 'b1', l: 'BL', t: '2026-10-11T02:00', st: 'sched', sc: null, tbd: true };
  const tooOld = { id: 'b2', l: 'BL', t: '2026-09-30T02:00', st: 'sched', sc: null, tbd: true };

  const base = activeSyncTargets([oldTbd], now).get('BL');
  ok('默认守卫：10 天前的 tbd 只查占位日', base?.size === 1, `实际 ${base?.size}`);

  const back = activeSyncTargets([oldTbd], now, { backfillDays: 14 }).get('BL');
  ok('backfill=14：10 天前的 tbd 展开 7 个日期', back?.size === 7, `实际 ${back?.size}`);

  const beyond = activeSyncTargets([tooOld], now, { backfillDays: 14 }).get('BL');
  ok('backfill 不展开窗口外的 tbd（21 天前）', beyond?.size === 1, `实际 ${beyond?.size}`);
}

/* ================================================================== */
console.log('');
console.log('五·三、★ UCL 淘汰赛接管（不依赖本地场次扫本周比赛日）');
{
  // 2026-09-16 是周三 → 本周二是 09-15、周三 09-16、周四 09-17（UTC）
  const now = new Date('2026-09-16T15:00:00+08:00').getTime();
  const t = uclWeeklyTargets(now);
  const ucl = t.get('UCL');
  ok('UCL 生成本周 3 个比赛日（周二/三/四）', ucl?.size === 3, `实际 ${ucl?.size}`);
  ok('包含本周二 20260915', ucl?.has('20260915'));
  ok('包含本周三 20260916', ucl?.has('20260916'));
  ok('包含本周四 20260917', ucl?.has('20260917'));
  ok('不包含本周一', !ucl?.has('20260914'));
  ok('不包含本周五', !ucl?.has('20260918'));

  // 跨周边界：周日算本周的末尾，本周二三四仍属同一周
  const sunday = new Date('2026-09-20T15:00:00+08:00').getTime();
  const t2 = uclWeeklyTargets(sunday);
  ok('周日时本周二三四仍是 09-15/16/17', t2.get('UCL')?.has('20260915') && t2.get('UCL')?.has('20260917'));

  // 传入已有 targets 时是追加而非覆盖
  const base = new Map([['PL', new Set(['20260916'])]]);
  const merged = uclWeeklyTargets(now, base);
  ok('追加到已有 targets 时不覆盖其它联赛', merged.get('PL')?.has('20260916') && merged.get('UCL')?.size === 3);
}

/* ================================================================== */
console.log('');
console.log('五·四、★ 跨轮次改期识别（同对阵唯一 + 本地未赛）');
{
  const local = {
    id: 'T-RS1', l: 'PL', t: '2026-09-01T03:00', st: 'sched', sc: null, h: 'ARS', a: 'CHE'
  };
  const ev = {
    league: 'PL', homeId: 'ARS', awayId: 'CHE', kickoff: '2026-10-06T03:00',
    kickoffTrusted: true, state: 'sched', sources: ['espn']
  };

  const r1 = planPatches([ev], [local]);
  ok('★ 同对阵唯一且本地未赛：允许跨轮次改期',
    r1.patches.get('T-RS1')?.t === '2026-10-06T03:00' && r1.stats.rescheduled === 1,
    JSON.stringify([...r1.patches]));

  const r2 = planPatches([{ ...ev, state: 'done', homeScore: '2', awayScore: '1' }], [local]);
  const p2 = r2.patches.get('T-RS1');
  ok('改期已完赛：同时写入时间与比分',
    p2?.t === '2026-10-06T03:00' && p2?.sc === '2-1' && p2?.st === 'done' && r2.stats.rescheduled === 1,
    JSON.stringify(p2));

  const r3 = planPatches([ev], [{ ...local, st: 'done', sc: '0-0' }]);
  ok('本地已完赛：不接受 35 天外的时间改写',
    r3.patches.size === 0 && r3.stats.rescheduled === 0, JSON.stringify([...r3.patches]));

  const r4 = planPatches([ev], [local, { ...local, id: 'T-RS1b', t: '2026-09-15T03:00' }]);
  ok('同对阵多候选：拒绝改期匹配',
    r4.patches.size === 0 && r4.stats.rescheduled === 0, JSON.stringify([...r4.patches]));

  const r5 = planPatches([{ ...ev, kickoffTrusted: false }], [local]);
  ok('时间不可信：拒绝改期匹配',
    r5.patches.size === 0 && r5.stats.rescheduled === 0, JSON.stringify([...r5.patches]));

  const r6 = planPatches([{ ...ev, kickoff: '2027-01-05T03:00' }], [local]);
  ok('超过 60 天：仍拒绝改期匹配',
    r6.patches.size === 0 && r6.stats.rescheduled === 0, JSON.stringify([...r6.patches]));
}

/* ================================================================== */
console.log('');
console.log('六、HTTP API 端点集成（依赖注入，离线且不写盘）');
{
  const rules = loadRules();
  const silent = { log: () => {}, warn: () => {}, error: () => {} };
  const target = fixtures.find(m => m.st === 'sched' && !m.tbd) || fixtures.find(m => m.st === 'sched');
  ok('找到可用于打补丁的测试样本', !!target, target?.id);

  const successPatch = new Map([[target.id, { st: 'done', sc: '2-1', tbd: false }]]);
  const incompletePatch = new Map([[target.id, { st: 'done' }]]);

  /** 启动一个注入了假依赖的服务，跑完自动关闭；绝不联网、绝不写盘 */
  async function withServer(overrides, fn) {
    let saveCalls = 0;
    let saved = null;
    const server = createServer(rules, silent, {
      backgroundSync: false,
      loadFixtures: async () => fixtures,
      syncScores: async () => ({
        patches: successPatch,
        errors: [],
        stats: { done: 1 },
        bySource: {},
        conflicts: [],
        incompleteScore: [],
        unmatched: []
      }),
      saveFixtures: next => {
        saveCalls++;
        saved = next;
        return { ok: true, path: '/tmp/nightowl-fixtures.json', bytes: 1 };
      },
      ...overrides
    });
    const port = await new Promise((res, rej) => {
      server.listen(0, '127.0.0.1', () => res(server.address().port));
      server.on('error', rej);
    });
    try {
      return await fn({ port, getSaveCalls: () => saveCalls, getSaved: () => saved });
    } finally {
      await new Promise(r => server.close(r));
    }
  }

  // 1. 状态与 fixtures 端点
  await withServer({}, async ({ port }) => {
    const rStatus = await fetch(`http://127.0.0.1:${port}/api/scores/status`);
    const jStatus = await rStatus.json();
    ok('GET /api/scores/status 返回 200', rStatus.status === 200);
    ok('状态包含 freshness 对象', !!jStatus.freshness);
    ok('启动后 lastSync 为 null（未运行过同步）', jStatus.lastSync === null);

    const rFixtures = await fetch(`http://127.0.0.1:${port}/api/fixtures`);
    const jFixtures = await rFixtures.json();
    ok('GET /api/fixtures 返回假数据总数', rFixtures.status === 200 && jFixtures.count === fixtures.length);
  });

  // 2. dryRun 不写盘
  await withServer({}, async ({ port, getSaveCalls }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/scores/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: false })
    });
    const j = await r.json();
    ok('POST /api/scores/sync (dryRun) 返回 200', r.status === 200);
    ok('dryRun 标志为 true', j.dryRun === true);
    ok('dryRun 不调用写盘', getSaveCalls() === 0);
  });

  // 3. apply=true 成功：written.ok / changed / fixtures 回传
  await withServer({}, async ({ port, getSaveCalls, getSaved }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/scores/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: true })
    });
    const j = await r.json();
    ok('★ POST /api/scores/sync (apply=true) 返回 200 且无 500', r.status === 200, j.error);
    ok('写盘成功：written.ok=true 且 changed=1',
      j.summary?.written?.ok === true && j.summary?.written?.changed === 1);
    ok('写盘成功：applied=true', j.summary?.applied === true);
    ok('写盘成功：回传的新 fixtures 已含补丁',
      Array.isArray(j.fixtures) && j.fixtures.find(m => m.id === target.id)?.sc === '2-1');
    ok('写盘只调用一次', getSaveCalls() === 1);
    ok('写盘内容确实是应用补丁后的数据', getSaved()?.find(m => m.id === target.id)?.sc === '2-1');
  });

  // 4. 写盘失败：不得回传新 fixtures、不得标记 applied
  await withServer(
    { saveFixtures: () => ({ ok: false, reason: '磁盘只读' }) },
    async ({ port }) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/scores/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true })
      });
      const j = await r.json();
      ok('写盘失败：HTTP 仍为 200（同步本身成功，写盘是后置步骤）', r.status === 200);
      ok('★ 写盘失败：written.ok=false 且带 reason',
        j.summary?.written?.ok === false && /磁盘只读/.test(j.summary?.written?.reason || ''));
      ok('★ 写盘失败：applied=false', j.summary?.applied === false);
      ok('★ 写盘失败：不回传新 fixtures（避免内存假装成功）', !j.fixtures);
    }
  );

  // 5. 校验失败：绝不写盘，绝不回传新 fixtures
  await withServer(
    {
      syncScores: async () => ({
        patches: incompletePatch,
        errors: [],
        stats: { done: 1 },
        bySource: {},
        conflicts: [],
        incompleteScore: [],
        unmatched: []
      })
    },
    async ({ port, getSaveCalls }) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/scores/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true })
      });
      const j = await r.json();
      ok('校验失败：written.ok=false 且说明校验未通过',
        j.summary?.written?.ok === false && /校验未通过/.test(j.summary?.written?.reason || ''));
      ok('校验失败：列出具体 issues', Array.isArray(j.summary?.written?.issues) && j.summary.written.issues.length > 0);
      ok('校验失败：不调用写盘', getSaveCalls() === 0);
      ok('校验失败：不回传新 fixtures', !j.fixtures);
    }
  );
}

/* ================================================================== */
console.log('');
console.log('七、数据新鲜度语义（lastScoreAt 是赛果时间，不是同步时间）');
{
  const now = new Date('2026-09-16T15:00:00+08:00').getTime();
  const sample = [
    { id: 'd1', l: 'PL', t: '2026-09-15T03:00', st: 'done', sc: '2-1' },
    { id: 'p1', l: 'PL', t: '2026-09-16T03:00', st: 'sched', sc: null }, // 已过完赛窗口 → 待录
    { id: 'pOld', l: 'SA', t: '2026-09-10T03:00', st: 'sched', sc: null }, // 超过 24h → 上游缺分
    { id: 'l1', l: 'PL', t: '2026-09-16T14:00', st: 'sched', sc: null }, // 进行中窗口
    { id: 'f1', l: 'PL', t: '2026-09-18T03:00', st: 'sched', sc: null }  // 未来 → 不计
  ];
  const f = freshness(sample, now, { usingUser: true });
  ok('★ lastScoreAt 取最近完赛的开球时间',
    f.lastScoreAt === new Date(ts('2026-09-15T03:00')).toISOString(), f.lastScoreAt);
  ok('pendingCount 只计已过完赛窗口的 sched 场次', f.pendingCount === 2, `实际 ${f.pendingCount}`);
  ok('★ stalePendingCount 单独标记超过 24h 的缺分场次', f.stalePendingCount === 1, `实际 ${f.stalePendingCount}`);
  ok('liveCount 只计进行中窗口的 sched 场次', f.liveCount === 1, `实际 ${f.liveCount}`);
  ok('freshness 字段完整',
    ['source', 'lastScoreAt', 'staleHours', 'pendingCount', 'stalePendingCount', 'liveCount', 'writable']
      .every(k => k in f));
}

/* ================================================================== */
console.log('');
console.log('八、赛季窗口配置化（不再硬编码 2027-05）');
{
  const s2627 = seasonMonths('2026-27');
  ok('2026-27 覆盖 10 个月（8 月—次年 5 月）', s2627.length === 10, `实际 ${s2627.length}`);
  ok('2026-27 从 2026-08 开始', s2627[0] === '202608', s2627[0]);
  ok('2026-27 到 2027-05 结束', s2627[s2627.length - 1] === '202705', s2627[s2627.length - 1]);

  const s2728 = seasonMonths('2027-28');
  ok('2027-28 正确跨年',
    s2728[0] === '202708' && s2728[9] === '202805',
    `${s2728[0]} … ${s2728[9]}`);

  ok('非法 / 不连续赛季串返回空',
    seasonMonths('2026-28').length === 0 && seasonMonths('bad').length === 0);
  ok('默认赛季仍是 2026-27', JSON.stringify(seasonMonths()) === JSON.stringify(s2627));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
