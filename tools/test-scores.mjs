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

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { planPatches, applyPatches, validateFixtures, ALLOWED_ST, activeSyncTargets, uclWeeklyTargets, seasonMonths, staleTbdMatches, autoBackfillDays } from '../server/scores.js';
import { createServer, checkedPendingIds, pendingMatchIds } from '../server/index.js';
import { mergeEvents } from '../server/sources/index.js';
import { parseRound } from '../server/sources/openfootball.js';
import { loadRules } from '../server/proxy.js';
import { freshness, mergeFixtures, loadFixtures, saveFixtures, builtinSeason } from '../server/data-store.js';
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
  // 「done 不产生目标」必须用独立样本验证：混合样本里别的场次的扩窗可能覆盖同一天
  // （id=2 积压后按 ±4 展开，正好把 0911 也包进来），用「某日期是否在集合里」会误判。
  {
    const onlyDone = [{ id: 'd1', l: 'PL', t: '2026-09-12T03:00', st: 'done', sc: '3-0' }];
    const t1 = activeSyncTargets(onlyDone, now);
    ok('已完赛记录不产生任何查询目标',
      !t1.has('PL') || t1.get('PL').size === 0, [...(t1.get('PL') || [])].join(','));
  }
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
console.log('五·一之二、★ 改期超过 1 天的场次：查询窗口必须放宽到匹配窗口');
{
  // 实测案例：FL-9-LOR-BRT 本地记 2026-11-01T03:45 sched，
  // ESPN 实际 2026-11-02T19:45Z（北京 11-03 03:45）已完赛 0-2。
  // 查询日期由本地墙钟换算成 UTC 日期 → 20261031；只查 ±1 天（1030/1031/1101）
  // 永远覆盖不到实际日期 20261102，界面就会一直显示「待录比分」。
  const AT = new Date('2026-11-04T12:00:00+08:00').getTime();
  const backlog = [{ id: 'bk', l: 'FL', t: '2026-11-01T03:45', st: 'sched', sc: null }];
  const set = activeSyncTargets(backlog, AT).get('FL') || new Set();
  ok('★ 积压场次覆盖实际比赛日期（20261102）', set.has('20261102'), [...set].join(','));
  ok('积压场次按匹配窗口展开为 ±4 天共 9 个日期', set.size === 9, `${set.size}: ${[...set].join(',')}`);
}

{
  // 反向保护：当天刚完赛的场次不能也被放大成 9 个日期，否则整轮同步会明显变慢。
  const AT = new Date('2026-11-03T12:00:00+08:00').getTime();
  const fresh = [{ id: 'fr', l: 'PL', t: '2026-11-03T06:00', st: 'sched', sc: null }];
  const set = activeSyncTargets(fresh, AT).get('PL') || new Set();
  ok('当天刚完赛（积压 < 1 天）仍只查 ±1 天', set.size === 3, `${set.size}: ${[...set].join(',')}`);
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

  // 2.1 没有任何可尝试的目标时，不能被冒充成“已检查”
  await withServer(
    {
      syncScores: async () => ({
        patches: new Map(),
        errors: [],
        stats: {},
        bySource: {},
        attempted: false,
        conflicts: [],
        incompleteScore: [],
        unmatched: []
      })
    },
    async ({ port }) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/scores/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true })
      });
      const j = await r.json();
      ok('★ attempted=false 原样回传，不再恒真', j.summary?.attempted === false, JSON.stringify(j.summary));
    }
  );

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
  // 开球 2026-09-15T03:00 + 120min 完赛 → 2026-09-15T05:00（北京墙钟）
  ok('★ lastScoreEndAt 是完赛时刻（开球 + 120min）',
    f.lastScoreEndAt === new Date(ts('2026-09-15T05:00')).toISOString(), f.lastScoreEndAt);
  // now = 09-16 15:00，距完赛 34 小时（此前按开球算会得到 36 小时，高估一整场）
  ok('★ staleHours 以完赛时刻为基准（不高估一场比赛时长）',
    f.staleHours === 34, `实际 ${f.staleHours}`);
  ok('pendingCount 只计已过完赛窗口的 sched 场次', f.pendingCount === 2, `实际 ${f.pendingCount}`);
  ok('★ stalePendingCount 单独标记超过 24h 的缺分场次', f.stalePendingCount === 1, `实际 ${f.stalePendingCount}`);
  ok('liveCount 只计进行中窗口的 sched 场次', f.liveCount === 1, `实际 ${f.liveCount}`);
  ok('freshness 字段完整',
    ['source', 'lastScoreAt', 'lastScoreEndAt', 'staleHours', 'pendingCount', 'stalePendingCount', 'liveCount', 'writable']
      .every(k => k in f));
}

/* ================================================================== */
console.log('');
console.log('七·二、★ 同步窗口只控制「扩窗」，不控制「是否查询」');
{
  // 这条曾被误解过（包括我自己）：以为 activeSyncTargets 的 14 天窗口意味着
  // 「更早的场次根本不会查」。实际 add(t) 是无条件的，窗口只决定要不要向
  // ±1 / ±MATCH_WINDOW 展开。所以窗口外的历史缺分也必须计入待录统计 ——
  // 它们确实被查过，查不到就是真的没数据，过滤掉等于对用户隐瞒。
  const DAY = 86400000;
  const now = Date.now();
  // 真实数据的 t 是 `YYYY-MM-DDTHH:mm`（北京墙钟、无后缀）。换成空格分隔会让
  // ts() 解析失败，整条断言变成空断言（假绿）。
  const mk = (id, daysAgo) => ({
    id, l: 'PL', st: 'sched', sc: null, tbd: false,
    t: new Date(now - daysAgo * DAY).toISOString().slice(0, 16)
  });
  const mkHours = (id, hours) => ({
    id, l: 'PL', st: 'sched', sc: null, tbd: false,
    t: new Date(now - hours * 3600000).toISOString().slice(0, 16)
  });

  // 三种情况各查一种，边界才不会被「一刀切」蒙混过去：
  //   刚完赛（4 小时前开球，2 小时前完赛）→ 只扩 ±1，3 个日期
  //   积压（5 天前）→ 放宽到 ±MATCH_WINDOW_DAYS，9 个日期
  //   超出同步窗口（20 天前）→ 只查本地日期，1 个
  const tFresh = activeSyncTargets([mkHours('f', 4)], now).get('PL');
  const tBacklog = activeSyncTargets([mk('b', 5)], now).get('PL');
  const tOld = activeSyncTargets([mk('o', 20)], now).get('PL');
  ok('当天刚完赛的缺分只扩 ±1（3 个日期）', tFresh.size === 3, [...tFresh].join(','));
  ok('积压（5 天前）的缺分扩到 ±MATCH_WINDOW_DAYS（9 个日期）', tBacklog.size === 9, [...tBacklog].join(','));
  ok('★ 窗口外（20 天前）的缺分仍会被查询（本地日期 1 个）', tOld.size === 1, [...tOld].join(','));

  // 因此统计口径不该按窗口切分：20 天前的缺分照样算「待录 / 上游缺分」
  const fOld = freshness([mk('o2', 20)], now, { usingUser: true });
  ok('★ 窗口外的历史缺分仍计入 pendingCount', fOld.pendingCount === 1, `实际 ${fOld.pendingCount}`);
  ok('窗口外且超 24h 仍计入 stalePendingCount', fOld.stalePendingCount === 1, `实际 ${fOld.stalePendingCount}`);

  // 内置快照（未同步过）不报「上游缺分」——那只是还没同步
  const fBuiltin = freshness([mk('b', 5)], now, { usingUser: false });
  ok('内置快照模式下不报「上游缺分」', fBuiltin.stalePendingCount === 0 && fBuiltin.pendingCount === 1,
    `pending=${fBuiltin.pendingCount} stale=${fBuiltin.stalePendingCount}`);

  // 有比分的完赛场次完全不参与任何计数
  const fDone = freshness([{ ...mk('d', 5), st: 'done', sc: '1-0' }], now, { usingUser: true });
  ok('有比分的完赛场次不计入任何待录计数',
    fDone.pendingCount === 0 && fDone.stalePendingCount === 0);
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

/* ================================================================== */
console.log('');
console.log('九、★ 内置快照与用户数据合并（升级后新场次必须送得到）');
{
  const builtin = [
    { id: 'A', l: 'PL', t: '2026-11-01T03:00', st: 'sched', h: 'AAA', a: 'BBB' },
    { id: 'B', l: 'PL', t: '2026-11-02T03:00', st: 'sched', h: 'CCC', a: 'DDD' },
    // 新版本才有的场次（UCL 淘汰赛对阵之类）
    { id: 'NEW', l: 'UCL', t: '2027-02-18T04:00', st: 'sched', h: 'EEE', a: 'FFF' }
  ];
  const user = [
    { id: 'A', l: 'PL', t: '2026-11-01T03:00', st: 'done', sc: '2-1', h: 'AAA', a: 'BBB' },
    { id: 'U', l: 'PL', t: '2026-11-05T03:00', st: 'sched', h: 'GGG', a: 'HHH' }
  ];
  const merged = mergeFixtures(builtin, user);
  const byId = new Map(merged.map(m => [m.id, m]));
  ok('★ 内置独有的场次不会被用户数据挡住（核心修复）', byId.has('NEW'), merged.map(m => m.id).join(','));
  ok('★ 用户侧已录比分覆盖内置', byId.get('A')?.st === 'done' && byId.get('A')?.sc === '2-1',
    JSON.stringify(byId.get('A')));
  ok('内置其他场次原样保留', byId.get('B')?.h === 'CCC', JSON.stringify(byId.get('B')));
  ok('用户独有场次也保留（并集而非替换）', byId.has('U'), merged.map(m => m.id).join(','));
  ok('合并后 id 不重复', merged.length === new Set(merged.map(m => m.id)).size, `实际 ${merged.length}`);

  ok('用户数据为空时返回内置',
    mergeFixtures(builtin, []).length === builtin.length);
  ok('内置为空时返回用户', mergeFixtures([], user).length === user.length);
  ok('两侧都为空返回空数组', mergeFixtures([], []).length === 0);
  ok('脏条目（无 id）被丢弃', mergeFixtures(builtin, [{ id: null }, { foo: 1 }]).length === builtin.length);
}

/* ================================================================== */
console.log('');
console.log('十、★ 已检查场次的判定口径（两条同步路径必须共用同一入口）');
{
  // 固定时钟，不依赖当天快照：t 是北京墙钟无后缀，now 用 +08:00 显式给出
  const NOW = Date.parse('2026-10-02T00:00:00+08:00');
  const past = '2026-10-01T03:00';
  const mk = (id, l, extra = {}) => ({ id, l, t: past, st: 'sched', h: 'H' + id, a: 'A' + id, ...extra });

  const fx = [
    mk('PL-P1', 'PL'),
    mk('BL-P1', 'BL'),
    mk('PL-P2', 'PL'),
    mk('BL-TBD', 'BL', { tbd: true })   // 时间未定：不该被记为「查过」
  ];

  const allOk = { bySource: { espn: { ok: 3 } }, errors: [] };
  const blFailed = {
    bySource: { espn: { ok: 3 } },
    errors: [{ source: 'espn', league: 'BL', unit: '20261001', message: '503' }]
  };
  const noRequest = { bySource: {}, errors: [] };
  const allFailed = { bySource: { espn: { ok: 0 } }, errors: [] };

  const ids = (fixtures, result, opts) => checkedPendingIds(fixtures, result, { now: NOW, ...opts }).sort();

  // ① 无 matchId + 某联赛失败 → 该联赛场次不入账
  ok('★ 联赛请求失败：该联赛场次不记为已检查',
    JSON.stringify(ids(fx, blFailed)) === JSON.stringify(['PL-P1', 'PL-P2']),
    JSON.stringify(ids(fx, blFailed)));

  // ② 无 matchId + 全成功 → 全部待录场次入账（tbd 除外）
  ok('全成功：待录场次全部入账', JSON.stringify(ids(fx, allOk)) === JSON.stringify(['BL-P1', 'PL-P1', 'PL-P2']),
    JSON.stringify(ids(fx, allOk)));
  ok('tbd 场次永不记为已检查', !ids(fx, allOk).includes('BL-TBD'), JSON.stringify(ids(fx, allOk)));

  // ③ 有 matchId → 只记该场，不外溢到其它联赛
  ok('★ 单场重查只记该场（不外溢）',
    JSON.stringify(ids(fx, allOk, { matchId: 'PL-P1' })) === JSON.stringify(['PL-P1']),
    JSON.stringify(ids(fx, allOk, { matchId: 'PL-P1' })));

  // ④ 单场重查 + 该场联赛失败 → 一条都不记（确实没查到）
  ok('单场重查但该联赛失败：不记为已检查',
    ids(fx, blFailed, { matchId: 'BL-P1' }).length === 0,
    JSON.stringify(ids(fx, blFailed, { matchId: 'BL-P1' })));

  // ⑤ 零请求 / 全失败 → 不动新鲜度
  ok('零请求：一条都不记', ids(fx, noRequest).length === 0, JSON.stringify(ids(fx, noRequest)));
  ok('全部请求失败：一条都不记', ids(fx, allFailed).length === 0, JSON.stringify(ids(fx, allFailed)));

  // ⑥ 时间边界：未到完赛时间的场次不算查过（NOW=10-02 00:00，本场 02:00 才结束）
  const future = [{ id: 'PL-F', l: 'PL', t: '2026-10-01T23:30', st: 'sched', h: 'X', a: 'Y' }];
  ok('未到完赛时间：不算查过', ids(future, allOk).length === 0, JSON.stringify(ids(future, allOk)));
  ok('已完赛且有比分：不算待录（st=done）',
    ids([{ id: 'PL-D', l: 'PL', t: past, st: 'done', sc: '1-0', h: 'X', a: 'Y' }], allOk).length === 0);

  // ⑦ 与旧写法的对照：旧写法在「BL 失败 + 无 matchId」时会把 BL 也记进去
  const legacy = pendingMatchIds(fx, NOW).sort();
  ok('对照：旧口径确实会多记（本用例敏感度自检）',
    legacy.includes('BL-P1') && !ids(fx, blFailed).includes('BL-P1'),
    `legacy=${JSON.stringify(legacy)}`);
}

/* ================================================================== */
console.log('');
console.log('十一、★ stale tbd 补查盲区（占位日已过仍 tbd 必须能回看）');
{
  const NOW = Date.parse('2026-11-06T00:00:00+08:00');
  const mk = (id, t, extra = {}) => ({ id, l: 'PD', t, st: 'sched', h: 'H' + id, a: 'A' + id, ...extra });

  const fx = [
    mk('FRESH', '2026-11-06T04:00', { tbd: true }),        // 占位日在未来：不算 stale
    mk('STALE3', '2026-11-02T04:00', { tbd: true }),        // 已过 4 天
    mk('STALE10', '2026-10-26T02:00', { tbd: true }),       // 已过 11 天
    mk('DONE', '2026-11-02T04:00', { st: 'done', sc: '1-0' }), // 已完赛：不参与
    mk('SCHED', '2026-10-26T02:00')                          // 非 tbd：不参与
  ];

  const stale = staleTbdMatches(fx, NOW).map(m => m.id).sort();
  ok('★ 只挑出「占位日已过仍是 tbd」的场次',
    JSON.stringify(stale) === JSON.stringify(['STALE10', 'STALE3']), JSON.stringify(stale));
  // ⚠️ 不断言「恰好 12 场」——数据刷新后这个数字会变成 0，写死会让门禁无缘无故变红。
  const realStale = staleTbdMatches(fixtures, Date.now());
  ok('内置快照的命中项都确实是「tbd + 占位日已过」',
    realStale.every(m => m.tbd === true && m.st === 'sched' && ts(m.t) < Date.now() - 3 * 86400000),
    realStale.map(m => m.id).slice(0, 3).join('、'));
  console.log(`     （当前内置快照 stale tbd：${realStale.length} 场，仅作观测，不作断言）`);

  // 自动回填：有积压才放宽，干净时严格 0（与旧行为一致）
  ok('★ 无积压时自动回填为 0（不加任何请求）', autoBackfillDays([fx[0], fx[3]], 0, NOW) === 0);
  ok('★ 有积压时自动放宽窗口', autoBackfillDays(fx, 0, NOW) === 60, String(autoBackfillDays(fx, 0, NOW)));
  ok('显式 backfill 优先于自动值', autoBackfillDays(fx, 7, NOW) === 7);
  ok('内置快照按实际积压决定是否放宽',
    autoBackfillDays(fixtures, 0, Date.now()) === (realStale.length ? 60 : 0),
    `stale=${realStale.length}`);

  // 真实效果：同一条 stale tbd，放宽后才能查到真实比赛日
  const one = [mk('S1', '2026-10-26T02:00', { tbd: true })];
  const tight = activeSyncTargets(one, NOW, { backfillDays: 0 });
  const loose = activeSyncTargets(one, NOW, { backfillDays: autoBackfillDays(one, 0, NOW) });
  const size = m => { let n = 0; for (const s of m.values()) n += s.size; return n; };
  ok('★ 默认守卫只查占位日（盲区复现）', size(tight) === 1, `${size(tight)} 个日期`);
  ok('★ 放宽后覆盖真实比赛日附近（盲区修复）', size(loose) === 7, `${size(loose)} 个日期`);
  ok('放宽后仍包含占位日自身（不丢原有查询）', [...loose.get('PD')].length === size(loose));
}

/* ================================================================== */
console.log('');
console.log('十二、★ 轮次修正（patch.r 只能改 r，id 必须保持稳定主键）');
{
  const ev = {
    league: 'PD',
    homeId: 'RSO',
    awayId: 'CEL',
    kickoff: '2026-09-03T03:00',
    kickoffTrusted: true,
    state: 'done',
    homeScore: '0',
    awayScore: '0',
    source: 'openfootball',
    round: 6,
    sources: ['openfootball']
  };
  const local = { id: 'PD-4-RSO-CEL', l: 'PD', r: 4, t: '2026-09-03T03:00', st: 'done', sc: '0-0', h: 'RSO', a: 'CEL' };

  const r1 = planPatches([ev], [local]);
  ok('★ 轮次不一致时写入 patch.r', r1.patches.get(local.id)?.r === 6,
    JSON.stringify([...r1.patches]));
  ok('轮次修正是独立统计项', r1.stats.roundFixed === 1, String(r1.stats.roundFixed));

  // ⚠️ 核心：id 不能被改
  const applied = applyPatches([local], r1.patches).fixtures[0];
  ok('★ 修正后 id 原样保留（用户补看/线路记忆以 id 为键）',
    applied.id === 'PD-4-RSO-CEL', applied.id);
  ok('修正后 r 已是权威值', applied.r === 6, String(applied.r));

  // 轮次一致时不产生多余补丁
  const r2 = planPatches([ev], [{ ...local, r: 6 }]);
  ok('轮次一致时不写补丁', !r2.patches.get(local.id)?.r, JSON.stringify([...r2.patches]));

  // 同对阵多候选 → 分不清归属，不改
  const r3 = planPatches([ev], [local, { ...local, id: 'PD-4-RSO-CEL-b', t: '2026-09-04T03:00' }]);
  ok('★ 同对阵多候选：拒绝改轮次', !r3.patches.get(local.id)?.r, JSON.stringify([...r3.patches]));

  // 改期匹配（超出正常窗口）→ 交人工，不改
  const r4 = planPatches([{ ...ev, kickoff: '2026-10-21T18:00' }], [local]);
  ok('★ 改期场次：拒绝改轮次', !r4.patches.get(local.id)?.r,
    `rescheduled=${r4.stats.rescheduled} ${JSON.stringify([...r4.patches])}`);

  // 解析器："Matchday 6" / 6 / 脏值
  ok('parseRound 解析 "Matchday 6"', parseRound('Matchday 6') === 6, String(parseRound('Matchday 6')));
  ok('parseRound 解析数字', parseRound(6) === 6);
  ok('parseRound 拒绝脏值', parseRound('Matchday') === null && parseRound(0) === null && parseRound('x9') === 9,
    `${parseRound('Matchday')} ${parseRound(0)} ${parseRound('x9')}`);

  // 合并层必须把 round 提到一等字段（否则 planPatches 根本看不到）
  const merged = mergeEvents([
    { ...ev, source: 'espn', round: undefined, sources: ['espn'] },
    ev
  ]);
  ok('★ mergeEvents 把 round 提到一等字段', merged.merged[0]?.round === 6,
    JSON.stringify(merged.merged[0]?.round));
  ok('mergeEvents 记下来源', merged.merged[0]?.roundSource === 'openfootball',
    String(merged.merged[0]?.roundSource));
}

/* ================================================================== */
console.log('');
console.log('十三、★ 已确认的开球时间不接受大位移（副源不得改写 ESPN 已核实的日期）');
{
  const evBase = {
    league: 'FL', homeId: 'LOR', awayId: 'BRT',
    kickoffTrusted: true, state: 'done',
    homeScore: '0', awayScore: '2', source: 'openfootball', sources: ['openfootball']
  };
  // ESPN 已确认：11-03 03:45（= 11-02 19:45Z）；副源错说 11-01 03:45
  const confirmed = { id: 'FL-9-LOR-BRT', l: 'FL', r: 9, t: '2026-11-03T03:45', tbd: false, st: 'done', sc: '0-2', h: 'LOR', a: 'BRT' };

  const r1 = planPatches([{ ...evBase, kickoff: '2026-11-01T03:45' }], [confirmed]);
  ok('★ 已确认时间被副源拉走 2 天：拒绝改 t', !r1.patches.get(confirmed.id)?.t,
    JSON.stringify([...r1.patches]));
  ok('拒绝时计数并留证', r1.stats.timeRejected === 1 && r1.timeRejected[0]?.hours === 48,
    JSON.stringify(r1.timeRejected));

  // 同一天内的小幅修正（≤6h）应当被接受
  const r2 = planPatches([{ ...evBase, kickoff: '2026-11-03T05:30' }], [confirmed]);
  ok('小幅修正（2.5h）照常接受', r2.patches.get(confirmed.id)?.t === '2026-11-03T05:30',
    JSON.stringify([...r2.patches]));

  // 占位时间（tbd）本来就是假的，允许改到任何真实时间
  const placeholder = { ...confirmed, tbd: true, t: '2026-11-02T04:00', r: 10 };
  const r3 = planPatches([{ ...evBase, state: 'sched', homeScore: null, awayScore: null, kickoff: '2026-11-01T00:15' }], [placeholder]);
  ok('★ tbd 占位时间可改任意幅度', r3.patches.get(placeholder.id)?.t === '2026-11-01T00:15',
    JSON.stringify([...r3.patches]));

  // 真改期（pp）：窗口内的改期必须放行（本地 sched 11-08 → 源说延期到 11-10，位移 >6h）
  const upcoming = { ...confirmed, t: '2026-11-08T03:45', st: 'sched', sc: undefined, r: 12 };
  const r4 = planPatches([{ ...evBase, state: 'pp', homeScore: null, awayScore: null, kickoff: '2026-11-10T20:00' }], [upcoming]);
  ok('★ 延期（pp）改期照常放行', r4.patches.get(upcoming.id)?.t === '2026-11-10T20:00',
    `rescheduled=${r4.stats.rescheduled} ${JSON.stringify([...r4.patches])}`);
}

/* ================================================================== */
console.log('');
console.log('十四、★ 跨赛季隔离（id 不含赛季，不同赛季绝不合并且旧文件要归档）');
{
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'nightowl-season-'));
  const prevEnv = process.env.NIGHTOWL_USER_DATA;
  process.env.NIGHTOWL_USER_DATA = tmpDir;
  const userFx = resolve(tmpDir, 'fixtures.json');
  const userMeta = resolve(tmpDir, 'fixtures-meta.json');
  const seasonNow = builtinSeason();

  // 用内置里不存在的 id：这样"上季数据有没有混进来"可以用存在性直接判定，
  // 不能拿真实场次比 sc —— 内置自己的赛季首战就是 3-0，会假红。
  const sample = [{ id: 'PL-99-OLD-SEASON', l: 'PL', r: 99, t: '2026-05-20T03:00', st: 'done', sc: '9-9', h: 'ARS', a: 'TOT' }];
  const writeUser = (season) => {
    writeFileSync(userFx, JSON.stringify(sample), 'utf8');
    if (season === undefined) rmSync(userMeta, { force: true });
    else writeFileSync(userMeta, JSON.stringify({ season }), 'utf8');
  };

  try {
    ok('内置快照带赛季章', typeof seasonNow === 'string' && seasonNow.length > 0, String(seasonNow));

    // ① 同赛季（显式盖章）：正常合并，不归档
    writeUser(seasonNow);
    const same = await loadFixtures();
    ok('★ 同赛季：正常合并', same.length === fixtures.length + 1 && same.some(m => m.id === 'PL-99-OLD-SEASON'),
      `${same.length} vs ${fixtures.length + 1}`);
    ok('同赛季不产生归档文件', readdirSync(tmpDir).every(f => !f.includes('.bak.json')));

    // ② 老用户没有 meta：按同赛季处理（向后兼容，不轻易丢数据）
    writeUser(undefined);
    const legacy = await loadFixtures();
    ok('★ 无 meta 的老用户：按同赛季合并（不归档）', legacy.length === fixtures.length + 1,
      `${legacy.length}`);
    ok('老用户不产生归档文件', readdirSync(tmpDir).every(f => !f.includes('.bak.json')));

    // ③ 跨赛季：以内置为准，用户文件改名归档（不删除）
    writeUser('2025-26');
    const crossed = await loadFixtures();
    ok('★ 跨赛季：只用内置快照', crossed.length === fixtures.length, `${crossed.length}`);
    ok('★ 跨赛季：旧赛季用户文件被归档而非删除',
      readdirSync(tmpDir).some(f => f === 'fixtures-2025-26.bak.json'),
      readdirSync(tmpDir).join(','));
    ok('跨赛季：归档内容原样保留',
      JSON.parse(readFileSync(resolve(tmpDir, 'fixtures-2025-26.bak.json'), 'utf8'))[0]?.id === 'PL-99-OLD-SEASON');
    ok('★ 跨赛季：生效数据里没有上季场次（不会污染新赛季）',
      !crossed.some(m => m.id === 'PL-99-OLD-SEASON'),
      crossed.filter(m => m.id === 'PL-99-OLD-SEASON').map(m => m.id).join(','));
    ok('跨赛季：生效数据规模回到内置快照', crossed.length === fixtures.length, `${crossed.length}`);

    // ④ 写盘会盖章：下次启动能认出这是本赛季的数据
    const saved = saveFixtures(sample);
    ok('写盘成功', saved.ok === true, JSON.stringify(saved));
    ok('★ 写盘时盖上本赛季章', JSON.parse(readFileSync(userMeta, 'utf8')).season === seasonNow,
      readFileSync(userMeta, 'utf8'));
    const afterSave = await loadFixtures();
    ok('盖章后合并正常（不再被判成跨赛季）', afterSave.length === fixtures.length + 1, `${afterSave.length}`);
  } finally {
    if (prevEnv === undefined) delete process.env.NIGHTOWL_USER_DATA;
    else process.env.NIGHTOWL_USER_DATA = prevEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/* ================================================================== */
console.log('');
console.log('十五、★ 字段级来源（内置更正能压过用户副本，同步值能压过旧快照）');
{
  const builtin = [
    { id: 'B1', l: 'PL', r: 1, t: '2026-09-01T22:00', st: 'sched', tbd: false, h: 'A', a: 'B' }
  ];
  const REV = '2026-09-03T00:00:00.000Z';

  // ① 用户侧写于内置修订**之前** → 内置胜（这就是「内置更正被遮蔽」的根治点）
  const older = [{ id: 'B1', t: '2026-09-01T23:00', at: { t: '2026-09-02T00:00:00.000Z' } }];
  const m1 = mergeFixtures(builtin, older, { writer: 'sparse', builtinRev: REV });
  ok('★ 内置修订更新：内置值胜出', m1[0].t === '2026-09-01T22:00', m1[0].t);

  // ② 用户侧写于内置修订**之后** → 用户胜（同步拿到的新时间不能被旧快照覆盖）
  const newer = [{ id: 'B1', t: '2026-09-01T23:00', at: { t: '2026-09-04T00:00:00.000Z' } }];
  const m2 = mergeFixtures(builtin, newer, { writer: 'sparse', builtinRev: REV });
  ok('★ 同步写入更新：用户值胜出', m2[0].t === '2026-09-01T23:00', m2[0].t);

  // ③ 没记时刻的字段：保守地信用户（老数据，无法判定）
  const noAt = [{ id: 'B1', t: '2026-09-01T23:00' }];
  ok('无可比时刻时保留用户值', mergeFixtures(builtin, noAt, { writer: 'sparse', builtinRev: REV })[0].t === '2026-09-01T23:00');

  // ④ 旧式整份副本：只信结果字段，t/r 用内置（抄来的旧值不能反压内置）
  const dense = [{ id: 'B1', t: '2026-09-01T23:00', r: 9, st: 'done', sc: '2-1' }];
  const m4 = mergeFixtures(builtin, dense, { writer: 'dense', builtinRev: REV });
  ok('★ 整份副本：t 用内置', m4[0].t === '2026-09-01T22:00', m4[0].t);
  ok('★ 整份副本：r 用内置', m4[0].r === 1, String(m4[0].r));
  ok('整份副本：比分仍以用户侧为准', m4[0].sc === '2-1' && m4[0].st === 'done');
  ok('合并结果不把内部 at 漏给消费方', !('at' in m4[0]), JSON.stringify(m4[0]));

  // ⑤ 端到端：写盘只落差分
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'nightowl-diff-'));
  const prevEnv = process.env.NIGHTOWL_USER_DATA;
  process.env.NIGHTOWL_USER_DATA = tmpDir;
  try {
    // 把内置原样写回 → 差异为空
    const same = saveFixtures(fixtures);
    ok('写盘成功', same.ok === true, JSON.stringify(same));
    ok('★ 与内置完全一致时落盘为空（不再复制整份快照）',
      JSON.parse(readFileSync(resolve(tmpDir, 'fixtures.json'), 'utf8')).length === 0);

    // 改一场的比分 → 只该落这一场的 diff
    const target = fixtures.find(m => m.st === 'sched' && !m.tbd);
    const changed = fixtures.map(m => (m.id === target.id ? { ...m, st: 'done', sc: '3-2' } : m));
    const r2 = saveFixtures(changed);
    const rows = JSON.parse(readFileSync(resolve(tmpDir, 'fixtures.json'), 'utf8'));
    ok('★ 只落变化的场次', rows.length === 1 && rows[0].id === target.id, JSON.stringify(rows).slice(0, 120));
    ok('★ 只落变化的字段', Object.keys(rows[0]).sort().join(',') === 'at,id,sc,st',
      Object.keys(rows[0]).join(','));
    ok('变化字段记下写入时刻', Date.parse(rows[0].at.sc) > 0 && rows[0].at.st === rows[0].at.sc);
    ok('返回变更字段清单', (r2.changedFields || []).includes(`${target.id}.sc`), String(r2.changedFields));

    // 再存一次同样的内容 → 时刻不能漂移（否则内置永远更正不动）
    const before = rows[0].at.sc;
    await new Promise(r => setTimeout(r, 5));
    saveFixtures(changed);
    const rows2 = JSON.parse(readFileSync(resolve(tmpDir, 'fixtures.json'), 'utf8'));
    ok('★ 值未变时写入时刻不刷新', rows2[0].at.sc === before, `${before} → ${rows2[0].at.sc}`);

    // 读回来：内置打底 + 差分覆盖
    const loaded = await loadFixtures();
    const got = loaded.find(m => m.id === target.id);
    ok('★ 读回：差分的比分生效', got.sc === '3-2' && got.st === 'done', JSON.stringify(got));
    ok('读回：未变动字段仍取内置', got.h === target.h && got.t === target.t);
    ok('读回：条目数与内置一致', loaded.length === fixtures.length, `${loaded.length}`);

    // meta 记录写盘方式，供下次合并选策略
    const meta = JSON.parse(readFileSync(resolve(tmpDir, 'fixtures-meta.json'), 'utf8'));
    ok('★ meta 记下 writer=sparse 与内置 rev', meta.writer === 'sparse' && !!meta.builtinRev,
      JSON.stringify(meta));
  } finally {
    if (prevEnv === undefined) delete process.env.NIGHTOWL_USER_DATA;
    else process.env.NIGHTOWL_USER_DATA = prevEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
