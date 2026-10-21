/**
 * 赛后集锦：匹配、URL 白名单、缓存与接口降级
 *
 * 纯离线：不联网、不写盘。真实上游由 tools/check-highlights.mjs 单独验证。
 *
 * 运行：node tools/test-highlights.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  youtubeUrl,
  seasonToTheSportsDb,
  buildTeamResolver,
  pickHighlightEvent,
  cacheEntryFresh,
  resolveHighlights
} from '../server/highlights.js';
import { sourceUrlFor, replayQuery, highlightQuery, highlightSources } from '../src/core/watch-sources.js';
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

console.log('赛后集锦解析测试');
console.log('');

/* ================================================================== */
console.log('一、YouTube URL 白名单');
{
  ok('watch?v= 规范地址', youtubeUrl('https://www.youtube.com/watch?v=gxCAKjl_irk') === 'https://www.youtube.com/watch?v=gxCAKjl_irk');
  ok('youtu.be 短链', youtubeUrl('https://youtu.be/gxCAKjl_irk') === 'https://www.youtube.com/watch?v=gxCAKjl_irk');
  ok('shorts 链接', youtubeUrl('https://www.youtube.com/shorts/gxCAKjl_irk') === 'https://www.youtube.com/watch?v=gxCAKjl_irk');
  ok('embed 链接', youtubeUrl('https://www.youtube.com/embed/gxCAKjl_irk') === 'https://www.youtube.com/watch?v=gxCAKjl_irk');
  ok('★ 非 YouTube 地址被拒绝', youtubeUrl('https://vimeo.com/123456') === null);
  ok('★ 伪装成 YouTube 的域名被拒绝', youtubeUrl('https://notyoutube.com/watch?v=gxCAKjl_irk') === null);
  ok('★ 非法视频 ID 被拒绝', youtubeUrl('https://www.youtube.com/watch?v=short') === null);
  ok('空值被拒绝', youtubeUrl(null) === null);
}

/* ================================================================== */
console.log('');
console.log('二、赛季串换算');
{
  ok('2026-27 → 2026-2027', seasonToTheSportsDb('2026-27') === '2026-2027');
  ok('2026-2027 原样通过', seasonToTheSportsDb('2026-2027') === '2026-2027');
  ok('不连续赛季返回 null', seasonToTheSportsDb('2026-28') === null);
  ok('非法串返回 null', seasonToTheSportsDb('bad') === null);
}

/* ================================================================== */
console.log('');
console.log('三、队名解析：归一化 / 别名 / 唯一包含');
{
  const resolveTeam = buildTeamResolver();
  ok('本地英文全称', resolveTeam('Newcastle United', 'PL') === 'NEW');
  ok('带变音符号的队名', resolveTeam('Atletico Madrid', 'PD') === 'ATM');
  ok('★ 西甲全称别名（之前匹配不到）', resolveTeam('Deportivo de A Coruña', 'PD') === 'DEP');
  ok('★ 西甲 Racing 全称别名', resolveTeam('Racing de Santander', 'PD') === 'RAC');
  ok('英超全称/简称唯一包含', resolveTeam('Brighton and Hove Albion', 'PL') === 'BHA');
  ok('德甲 Bayern München 别名', resolveTeam('Bayern München', 'BL') === 'FCB');
  ok('意甲 Inter 别名', resolveTeam('Inter', 'SA') === 'INT');
  ok('★ 歧义名称（Manchester）不猜', resolveTeam('Manchester', 'PL') === null);
  ok('★ 未知队名返回 null', resolveTeam('Not A Real Club', 'PL') === null);
}

/* ================================================================== */
console.log('');
console.log('四、轮次事件匹配：日期 / 主客方向 / 歧义');
{
  const match = { id: 'PL-7-NEW-AVL', l: 'PL', r: 7, t: '2026-10-18T00:30', h: 'NEW', a: 'AVL' };
  const resolveTeam = name =>
    ({ 'Newcastle United': 'NEW', 'Aston Villa': 'AVL' }[name] || null);

  const good = {
    dateEvent: '2026-10-17',
    strHomeTeam: 'Newcastle United',
    strAwayTeam: 'Aston Villa',
    strVideo: 'https://www.youtube.com/watch?v=gxCAKjl_irk',
    strEvent: 'Newcastle United vs Aston Villa'
  };

  const picked = pickHighlightEvent(match, [good], resolveTeam);
  ok('★ 同队名 + 日期邻近命中', picked?.event === good && picked?.video === 'https://www.youtube.com/watch?v=gxCAKjl_irk');

  const swapped = { ...good, strHomeTeam: 'Aston Villa', strAwayTeam: 'Newcastle United' };
  ok('主客互换仍能命中', pickHighlightEvent(match, [swapped], resolveTeam)?.event === swapped);

  const wrongDate = { ...good, dateEvent: '2026-10-22' };
  ok('★ 日期超出 ±2 天不命中', pickHighlightEvent(match, [wrongDate], resolveTeam) === null);

  const wrongTeams = { ...good, strHomeTeam: 'Newcastle United', strAwayTeam: 'Chelsea' };
  ok('★ 对阵不同不命中', pickHighlightEvent(match, [wrongTeams], resolveTeam) === null);

  const duplicate = { ...good, strEvent: 'duplicate' };
  ok('★ 两个同样接近的候选视为歧义，不猜', pickHighlightEvent(match, [good, duplicate], resolveTeam) === null);

  const noVideo = { ...good, strVideo: 'https://example.com/highlight.mp4' };
  const noVideoPick = pickHighlightEvent(match, [noVideo], resolveTeam);
  ok('命中比赛但非 YouTube → video 为 null', noVideoPick?.event === noVideo && noVideoPick?.video === null);
}

/* ================================================================== */
console.log('');
console.log('五、缓存 TTL：有视频 7 天，无视频 1 小时');
{
  const now = Date.now();
  const cfg = { cacheTtlMs: 7 * 86400000, missTtlMs: 3600000 };
  ok('有视频 1 天内新鲜', cacheEntryFresh({ at: now - 86400000, videos: [{}] }, now, cfg));
  ok('有视频 8 天后过期', !cacheEntryFresh({ at: now - 8 * 86400000, videos: [{}] }, now, cfg));
  ok('无视频 30 分钟内新鲜', cacheEntryFresh({ at: now - 1800000, videos: [] }, now, cfg));
  ok('★ 无视频 2 小时后过期（允许重新发现）', !cacheEntryFresh({ at: now - 7200000, videos: [] }, now, cfg));
  ok('空条目视为过期', !cacheEntryFresh(null, now, cfg));
}

/* ================================================================== */
console.log('');
console.log('六、resolveHighlights：抓取 / 解析 / 失败降级');
{
  const match = { id: 'PL-7-NEW-AVL', l: 'PL', r: 7, t: '2026-10-18T00:30', h: 'NEW', a: 'AVL' };
  const resolveTeam = name => ({ 'Newcastle United': 'NEW', 'Aston Villa': 'AVL' }[name] || null);
  const json = {
    events: [
      {
        dateEvent: '2026-10-17',
        strHomeTeam: 'Newcastle United',
        strAwayTeam: 'Aston Villa',
        strVideo: 'https://youtu.be/gxCAKjl_irk',
        strEvent: 'Newcastle United vs Aston Villa'
      }
    ]
  };
  const baseOpts = {
    persist: false,
    resolveTeam,
    rules: { highlights: { enabled: true, minRequestIntervalMs: 0 } },
    now: 1000
  };

  let called = 0;
  const r = await resolveHighlights(match, {
    ...baseOpts,
    cache: {},
    fetchJSON: async () => {
      called++;
      return json;
    }
  });
  ok('★ 真实结构解析出集锦', r.ok && r.videos.length === 1 && r.videos[0].url === 'https://www.youtube.com/watch?v=gxCAKjl_irk');
  ok('抓取只调用一次', called === 1);

  const cached = await resolveHighlights(match, {
    ...baseOpts,
    cache: { [match.id]: { at: 900, videos: r.videos } },
    fetchJSON: async () => {
      throw new Error('不应联网');
    }
  });
  ok('★ 缓存命中不再请求上游', cached.ok && cached.cached === true && cached.videos.length === 1);

  let forced = 0;
  const forcedResult = await resolveHighlights(match, {
    ...baseOpts,
    cache: { [match.id]: { at: 900, videos: r.videos } },
    force: true,
    fetchJSON: async () => {
      forced++;
      return json;
    }
  });
  ok('★ force 刷新跳过缓存并重新请求', forcedResult.cached === false && forced === 1);

  const noVideo = await resolveHighlights(match, {
    ...baseOpts,
    cache: {},
    fetchJSON: async () => ({ events: [{ ...json.events[0], strVideo: 'https://example.com/x.mp4' }] })
  });
  ok('★ 非 YouTube 链接不会进入结果', noVideo.ok && noVideo.videos.length === 0 && noVideo.reason === 'no-video');

  const upstreamErr = await resolveHighlights(match, {
    ...baseOpts,
    cache: {},
    fetchJSON: async () => {
      throw new Error('network down');
    }
  });
  ok('★ 上游失败明确降级，不抛异常', upstreamErr.ok === false && upstreamErr.reason === 'upstream-error');

  const disabled = await resolveHighlights(match, {
    ...baseOpts,
    rules: { highlights: { enabled: false } }
  });
  ok('开关关闭时不请求', disabled.ok === false && disabled.reason === 'disabled');

  const unsupported = await resolveHighlights(
    { ...match, l: 'UCL' },
    { ...baseOpts, fetchJSON: async () => json }
  );
  ok('UCL 不在集锦联赛配置内（走官方平台）', unsupported.ok === false && unsupported.reason === 'unsupported-league');
}

/* ================================================================== */
console.log('');
console.log('七、官方回放 / 国内集锦深链');
{
  const match = { h: 'ARS', a: 'COV' };
  const src = {
    searchTemplate: 'https://example.com/search?q={q}',
    replayTemplate: 'https://example.com/replay?q={q}',
    highlightTemplate: 'https://example.com/highlight?q={q}',
    homeUrl: 'https://example.com/'
  };
  const q = replayQuery(match);
  ok('回放搜索词包含双方队名与“回放”', q === '阿森纳 考文垂 回放', q);

  const replayUrl = sourceUrlFor(src, match, { replay: true });
  ok('★ 回放模板使用双方队名', replayUrl === `https://example.com/replay?q=${encodeURIComponent(q)}`, replayUrl);

  const liveUrl = sourceUrlFor(src, match);
  ok('非回放仍使用单队搜索', liveUrl === `https://example.com/search?q=${encodeURIComponent('阿森纳')}`, liveUrl);

  const fallback = sourceUrlFor({ searchTemplate: src.searchTemplate, homeUrl: src.homeUrl }, match, { replay: true });
  ok('无 replayTemplate 时退回 searchTemplate', fallback.startsWith('https://example.com/search?q='), fallback);

  const home = sourceUrlFor({ homeUrl: src.homeUrl }, match, { replay: true });
  ok('无模板时退回首页', home === src.homeUrl);

  const hq = highlightQuery(match);
  ok('集锦搜索词包含双方队名与“集锦”', hq === '阿森纳 考文垂 集锦', hq);
  ok('★ 集锦搜索词不含比分（防剧透）', !/\d+\s*[-:]\s*\d+/.test(hq), hq);

  const highlightUrl = sourceUrlFor(src, match, { highlight: true });
  ok('★ 集锦模板使用双方队名', highlightUrl === `https://example.com/highlight?q=${encodeURIComponent(hq)}`, highlightUrl);

  const noHighlight = sourceUrlFor(
    { searchTemplate: src.searchTemplate, homeUrl: src.homeUrl },
    match,
    { highlight: true }
  );
  ok('无 highlightTemplate 时退回 searchTemplate', noHighlight.startsWith('https://example.com/search?q='), noHighlight);

  const sources = [
    { id: 'a', kind: 'deeplink', searchTemplate: 'https://a.example/?q={q}' },
    { id: 'b', kind: 'deeplink', highlightTemplate: 'https://b.example/?q={q}', leagues: ['UCL'] },
    { id: 'c', kind: 'portal', homeUrl: 'https://c.example/' },
    { id: 'd', kind: 'deeplink', highlightTemplate: 'https://d.example/?q={q}', leagues: ['PL'] },
    { id: 'e', kind: 'deeplink' }
  ];
  const ordered = highlightSources(sources, 'PL');
  ok('★ 本联赛平台排前，其余保持注册表顺序', ordered.map(s => s.id).join(',') === 'd,a,b', ordered.map(s => s.id).join(','));
  ok('聚合导航与无搜索模板的源不进入集锦入口', ordered.length === 3, ordered.map(s => s.id).join(','));
  ok('无联赛信息时保持注册表顺序', highlightSources(sources, '').map(s => s.id).join(',') === 'a,b,d');
  ok('空源列表安全', highlightSources(null, 'PL').length === 0);

  const registry = JSON.parse(readFileSync(resolve(ROOT, 'server/watch-sources.json'), 'utf8'));
  ok('每个官方源都声明 highlightTemplate 字段', registry.official.every(s => 'highlightTemplate' in s));
  ok('集锦模板只允许 https 或 null', registry.official.every(s => s.highlightTemplate === null || /^https:\/\//.test(s.highlightTemplate)));
  ok('leagues 只含已知联赛码', registry.official.every(s => (s.leagues || []).every(l => ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL'].includes(l))));
  ok('国内集锦入口至少覆盖两家官方平台', highlightSources(registry.official, 'PL').length >= 2);
}

/* ================================================================== */
console.log('');
console.log('八、HTTP 端点：已完赛才查、失败不 500');
{
  const rules = loadRules();
  const silent = { log: () => {}, warn: () => {}, error: () => {} };
  const done = fixtures.find(m => m.st === 'done');
  const sched = fixtures.find(m => m.st === 'sched');
  ok('找到完赛/未开赛样本', !!(done && sched));

  async function withServer(overrides, fn) {
    const server = createServer(rules, silent, {
      backgroundSync: false,
      loadFixtures: async () => fixtures,
      ...overrides
    });
    const port = await new Promise((res, rej) => {
      server.listen(0, '127.0.0.1', () => res(server.address().port));
      server.on('error', rej);
    });
    try {
      return await fn(port);
    } finally {
      await new Promise(r => server.close(r));
    }
  }

  let called = 0;
  await withServer(
    {
      resolveHighlights: async () => {
        called++;
        return { ok: true, videos: [{ id: 'x', url: 'https://www.youtube.com/watch?v=gxCAKjl_irk' }] };
      }
    },
    async port => {
      const r = await fetch(`http://127.0.0.1:${port}/api/highlights?matchId=${done.id}`);
      const j = await r.json();
      ok('已完赛返回 200 与视频', r.status === 200 && j.ok === true && j.videos.length === 1);
      ok('HTTP 层透传 matchId', j.matchId === done.id);
      ok('调用解析器一次', called === 1);

      const r2 = await fetch(`http://127.0.0.1:${port}/api/highlights?matchId=${sched.id}`);
      const j2 = await r2.json();
      ok('★ 未开赛不查上游', r2.status === 200 && j2.ok === false && j2.reason === 'not-finished' && called === 1);

      const r3 = await fetch(`http://127.0.0.1:${port}/api/highlights?matchId=NOT-A-MATCH`);
      const j3 = await r3.json();
      ok('不存在返回 404', r3.status === 404 && j3.ok === false);

      const r4 = await fetch(`http://127.0.0.1:${port}/api/highlights?matchId=${done.id}`, {
        headers: { Origin: 'https://evil.example' }
      });
      ok('★ 外部网页来源被拒绝（不替第三方触发上游请求）', r4.status === 403 && called === 1);
    }
  );

  await withServer(
    {
      resolveHighlights: async () => {
        throw new Error('boom');
      }
    },
    async port => {
      const r = await fetch(`http://127.0.0.1:${port}/api/highlights?matchId=${done.id}`);
      const j = await r.json();
      ok('★ 解析异常返回 500 + videos 空数组（UI 可降级）', r.status === 500 && j.ok === false && Array.isArray(j.videos));
    }
  );
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
