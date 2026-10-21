/**
 * 实时比分/关键事件：状态映射、ESPN 匹配、缓存与降级
 *
 * 纯离线：用真实的 ESPN 响应形状做合成样本，不联网。
 *
 * 运行：node tools/test-live.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  utcDateOf,
  mapEspnStatus,
  pickEspnEvent,
  extractLiveFromSummary,
  extractLiveFromScoreboard,
  resolveLive,
  resetLiveCache
} from '../server/live.js';
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

console.log('实时比分与关键事件测试');
console.log('');

/* ================================================================== */
console.log('一、UTC 日期口径');
{
  ok('北京 03:00 → 前一个 UTC 日（ESPN dates 口径）', utcDateOf('2026-10-21T03:00') === '20261020', utcDateOf('2026-10-21T03:00'));
  ok('北京 23:00 → 当天 UTC 日', utcDateOf('2026-10-21T23:00') === '20261021', utcDateOf('2026-10-21T23:00'));
  ok('非法时间返回 null', utcDateOf('bad') === null);
}

/* ================================================================== */
console.log('');
console.log('二、ESPN 状态映射');
{
  const live = mapEspnStatus({ name: 'STATUS_IN_PROGRESS', state: 'in', completed: false }, { displayClock: "67'" });
  ok('进行中 → live / 67′', live.state === 'live' && live.minuteLabel === "67'");

  const half = mapEspnStatus({ name: 'STATUS_HALFTIME', state: 'in' });
  ok('中场 → halftime / HT', half.state === 'halftime' && half.minuteLabel === 'HT');

  const done = mapEspnStatus({ name: 'STATUS_FULL_TIME', state: 'post', completed: true });
  ok('完赛 → finished / FT', done.state === 'finished' && done.minuteLabel === 'FT');

  const pp = mapEspnStatus({ name: 'STATUS_POSTPONED', state: 'post' });
  ok('延期 → postponed', pp.state === 'postponed');

  const sched = mapEspnStatus({ name: 'STATUS_SCHEDULED', state: 'pre' });
  ok('未开始 → scheduled', sched.state === 'scheduled');
}

/* ================================================================== */
console.log('');
console.log('三、ESPN 事件匹配');
{
  const match = { id: 'PL-LIVE', l: 'PL', t: '2026-10-18T22:00', h: 'BOU', a: 'SUN' };
  const ev = {
    homeId: 'BOU',
    awayId: 'SUN',
    kickoff: '2026-10-18T22:00',
    state: 'live',
    homeScore: '2',
    awayScore: '0',
    raw: { id: '401879263', status: 'STATUS_IN_PROGRESS', displayClock: "67'", completed: false }
  };

  ok('★ 同主客 + 时间邻近命中', pickEspnEvent(match, [ev]) === ev);
  ok('主客互换也能命中', pickEspnEvent(match, [{ ...ev, homeId: 'SUN', awayId: 'BOU' }])?.raw.id === '401879263');
  ok('★ 时间差超 12 小时不命中', pickEspnEvent(match, [{ ...ev, kickoff: '2026-10-20T22:00' }]) === null);
  ok('★ 两个同样接近的候选视为歧义', pickEspnEvent(match, [ev, { ...ev }]) === null);
  ok('无 event id 不命中', pickEspnEvent(match, [{ ...ev, raw: {} }]) === null);
}

/* ================================================================== */
console.log('');
console.log('四、summary → 实时比分/事件');
{
  const match = { id: 'PL-LIVE', l: 'PL', t: '2026-10-18T22:00', h: 'BOU', a: 'SUN' };
  const summary = {
    header: {
      id: '401879263',
      competitions: [
        {
          status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false }, displayClock: "67'" },
          competitors: [
            { homeAway: 'home', score: '2', team: { id: '349', abbreviation: 'BOU' } },
            { homeAway: 'away', score: '0', team: { id: '366', abbreviation: 'SUN' } }
          ]
        }
      ]
    },
    keyEvents: [
      { type: { text: 'Kickoff' }, clock: { displayValue: '' }, text: 'First Half begins.', team: null, scoringPlay: false },
      { type: { text: 'Goal - Header' }, clock: { displayValue: "6'" }, text: 'Goal! Bournemouth 1, Sunderland 0.', team: { id: '349' }, scoringPlay: true },
      { type: { text: 'Yellow Card' }, clock: { displayValue: "26'" }, text: 'Sunderland player booked.', team: { id: '366' }, scoringPlay: false },
      { type: { text: 'Penalty - Missed' }, clock: { displayValue: "55'" }, text: 'Penalty missed.', team: { id: '349' }, scoringPlay: false },
      { type: { text: 'Substitution' }, clock: { displayValue: "60'" }, text: 'Substitution.', team: { id: '349' }, scoringPlay: false }
    ]
  };

  const r = extractLiveFromSummary(summary, match, 'PL', 1000);
  ok('★ 解析出进行中状态与分钟', r.ok && r.state === 'live' && r.minuteLabel === "67'");
  ok('★ 比分按本队主客方向', r.score.h === 2 && r.score.a === 0);
  ok(
    '★ 只保留进球/红黄牌/点球等关键事件',
    r.events.length === 3 &&
      r.events[0].type === 'goal' &&
      r.events[1].type === 'yellow' &&
      r.events[2].type === 'penalty'
  );
  ok('事件归属到正确一方', r.events[0].side === 'h' && r.events[1].side === 'a');

  const swappedSummary = {
    ...summary,
    header: {
      ...summary.header,
      competitions: [
        {
          ...summary.header.competitions[0],
          competitors: [
            { homeAway: 'home', score: '0', team: { id: '366', abbreviation: 'SUN' } },
            { homeAway: 'away', score: '2', team: { id: '349', abbreviation: 'BOU' } }
          ]
        }
      ]
    }
  };
  const swapped = extractLiveFromSummary(swappedSummary, match, 'PL', 1000);
  ok('★ 主客反转时比分方向仍正确', swapped.ok && swapped.score.h === 2 && swapped.score.a === 0);

  const mismatch = extractLiveFromSummary(summary, { ...match, h: 'ARS', a: 'COV' }, 'PL', 1000);
  ok('★ 对阵不匹配时拒绝（不展示错场比分）', mismatch.ok === false && mismatch.reason === 'team-mismatch');

  const empty = extractLiveFromSummary({ header: {} }, match, 'PL', 1000);
  ok('summary 缺字段时明确失败', empty.ok === false);
}

/* ================================================================== */
console.log('');
console.log('五、scoreboard 降级');
{
  const match = { id: 'PL-LIVE', l: 'PL', t: '2026-10-18T22:00', h: 'BOU', a: 'SUN' };
  const ev = {
    homeId: 'BOU',
    awayId: 'SUN',
    kickoff: '2026-10-18T22:00',
    state: 'live',
    homeScore: '2',
    awayScore: '0',
    raw: { id: '401879263', status: 'STATUS_IN_PROGRESS', displayClock: "67'", completed: false }
  };
  const r = extractLiveFromScoreboard(ev, match, 'PL', 1000);
  ok('★ summary 失败时仍给出比分/分钟', r.ok && r.score.h === 2 && r.score.a === 0 && r.minuteLabel === "67'");
  ok('降级时事件为空且标记 warning', r.events.length === 0 && r.warning === 'events-unavailable');

  const swapped = extractLiveFromScoreboard({ ...ev, homeId: 'SUN', awayId: 'BOU', homeScore: '0', awayScore: '2' }, match, 'PL', 1000);
  ok('降级路径也处理主客反转', swapped.ok && swapped.score.h === 2 && swapped.score.a === 0);

  const noScore = extractLiveFromScoreboard({ ...ev, homeScore: null, awayScore: null }, match, 'PL', 1000);
  ok('★ 缺失比分返回 null，不伪造 0-0', noScore.score.h === null && noScore.score.a === null);

  const mismatch = extractLiveFromScoreboard(ev, { ...match, h: 'ARS', a: 'COV' }, 'PL', 1000);
  ok('降级路径对阵不匹配时拒绝', mismatch.ok === false);
}

/* ================================================================== */
console.log('');
console.log('六、resolveLive：缓存 / 失败降级 / 不写盘');
{
  const match = { id: 'PL-LIVE', l: 'PL', t: '2026-10-18T22:00', h: 'BOU', a: 'SUN' };
  const rules = {
    live: {
      enabled: true,
      baseUrl: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
      cacheTtlMs: 20000,
      finishedCacheTtlMs: 60000,
      timeoutMs: 1000
    }
  };
  const ev = {
    homeId: 'BOU',
    awayId: 'SUN',
    kickoff: '2026-10-18T22:00',
    state: 'live',
    homeScore: '2',
    awayScore: '0',
    raw: { id: '401879263', status: 'STATUS_IN_PROGRESS', displayClock: "67'", completed: false }
  };
  const summary = {
    header: {
      competitions: [
        {
          status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false }, displayClock: "67'" },
          competitors: [
            { homeAway: 'home', score: '2', team: { id: '349', abbreviation: 'BOU' } },
            { homeAway: 'away', score: '0', team: { id: '366', abbreviation: 'SUN' } }
          ]
        }
      ]
    },
    keyEvents: [
      { type: { text: 'Goal' }, clock: { displayValue: "6'" }, text: 'Goal!', team: { id: '349' }, scoringPlay: true }
    ]
  };

  let leagueCalls = 0;
  let summaryCalls = 0;
  const fetchLeague = async () => {
    leagueCalls++;
    return [ev];
  };
  const fetchSummary = async () => {
    summaryCalls++;
    return summary;
  };

  resetLiveCache();
  const first = await resolveLive(match, { rules, now: 1000, fetchLeague, fetchSummary });
  ok('★ 正常解析出比分/事件', first.ok && first.score.h === 2 && first.events.length === 1);
  ok('首次请求各调用一次', leagueCalls === 1 && summaryCalls === 1);

  const second = await resolveLive(match, { rules, now: 5000, fetchLeague, fetchSummary });
  ok('★ 20 秒内命中缓存，不再请求上游', second.cached === true && leagueCalls === 1 && summaryCalls === 1);

  const third = await resolveLive(match, { rules, now: 25000, fetchLeague, fetchSummary });
  ok('★ 缓存过期后重新请求', third.cached === false && leagueCalls === 2 && summaryCalls === 2);

  const forced = await resolveLive(match, {
    rules,
    now: 5000,
    force: true,
    fetchLeague,
    fetchSummary
  });
  ok('★ force 手动刷新跳过缓存', forced.cached === false && leagueCalls === 3 && summaryCalls === 3);

  resetLiveCache();
  const fallback = await resolveLive(match, {
    rules,
    now: 1000,
    fetchLeague: async () => [ev],
    fetchSummary: async () => {
      throw new Error('summary down');
    }
  });
  ok('★ summary 失败 → scoreboard 降级（比分仍可用）', fallback.ok && fallback.score.h === 2 && fallback.warning === 'events-unavailable');

  resetLiveCache();
  const upstreamErr = await resolveLive(match, {
    rules,
    now: 1000,
    fetchLeague: async () => {
      throw new Error('scoreboard down');
    },
    fetchSummary
  });
  ok('★ scoreboard 失败 → 明确返回 upstream-error', upstreamErr.ok === false && upstreamErr.reason === 'upstream-error');

  resetLiveCache();
  const notFound = await resolveLive(match, {
    rules,
    now: 1000,
    fetchLeague: async () => [],
    fetchSummary
  });
  ok('找不到比赛 → event-not-found', notFound.ok === false && notFound.reason === 'event-not-found');

  resetLiveCache();
  const disabled = await resolveLive(match, {
    rules: { live: { enabled: false } },
    now: 1000,
    fetchLeague,
    fetchSummary
  });
  ok('开关关闭时不请求', disabled.ok === false && disabled.reason === 'disabled');
}

/* ================================================================== */
console.log('');
console.log('七、HTTP 端点');
{
  const rules = loadRules();
  const silent = { log: () => {}, warn: () => {}, error: () => {} };
  const target = fixtures.find(m => m.st === 'sched') || fixtures[0];
  const fake = {
    ok: true,
    matchId: target.id,
    state: 'live',
    statusText: '进行中',
    minuteLabel: "67'",
    score: { h: 2, a: 0 },
    events: [{ clock: "6'", type: 'goal', text: 'Goal!', side: 'h' }]
  };

  let called = 0;
  const server = createServer(rules, silent, {
    backgroundSync: false,
    loadFixtures: async () => fixtures,
    resolveLive: async () => {
      called++;
      return fake;
    }
  });
  const port = await new Promise((res, rej) => {
    server.listen(0, '127.0.0.1', () => res(server.address().port));
    server.on('error', rej);
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/live?matchId=${target.id}`);
    const j = await r.json();
    ok('GET /api/live 返回 200 与假数据', r.status === 200 && j.ok === true && j.score.h === 2);
    ok('HTTP 层透传 matchId', j.matchId === target.id);
    ok('解析器只调用一次', called === 1);

    const r2 = await fetch(`http://127.0.0.1:${port}/api/live?matchId=NOT-A-MATCH`);
    const j2 = await r2.json();
    ok('不存在返回 404', r2.status === 404 && j2.ok === false);
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
