/**
 * 抓取模块健康检查 + 匹配正确性回归
 *
 * 两件事：
 *   1. **发现别名缺口**：抓真实页面，列出匹配不到球队的条目，供补充
 *      server/scraper-alias.json（MLB/NBA 等非足球项目匹配不到是预期内的噪声）
 *   2. **守住 P0 回归**：断言「绝不出现单队兜底式误配」。
 *      这个 bug 曾导致 329/329 全部误配（本地「曼联vs萨巴赫」→ 播「曼联vs曼城」），
 *      属于静默错误，必须有测试挡住它。
 *
 * 运行：node tools/check-scraper.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchSchedule, probeChannels, TV_SPORTS_CHANNELS, findRoomFor, getLiveSourcesForMatch } from '../server/scraper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const fixtures = JSON.parse(readFileSync(resolve(ROOT, 'src/data/fixtures.json'), 'utf8'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

console.log('一、聚合站抓取与队名匹配');
let games = [];
try {
  games = await fetchSchedule(true);
} catch (err) {
  console.log(`  ❌ 抓取失败：${err.message}`);
  process.exit(1);
}

ok('解析到比赛房间', games.length > 0, `${games.length} 个`);

const matched = games.filter(g => g.homeId && g.awayId);
const rate = games.length ? ((matched.length / games.length) * 100).toFixed(1) : '0';
console.log(`     匹配率 ${rate}%（${matched.length}/${games.length}）`);
ok('足球项目匹配率不低于 50%', matched.length / Math.max(1, games.length) >= 0.5, `${rate}%`);

const unmatched = games.filter(g => !g.homeId || !g.awayId);
if (unmatched.length) {
  console.log('');
  console.log('     未匹配条目（含 MLB/NBA 等非足球噪声，确认是足球的请补进 scraper-alias.json）：');
  unmatched.slice(0, 20).forEach(g => console.log(`       · ${g.homeRaw} / ${g.awayRaw}`));
  if (unmatched.length > 20) console.log(`       … 另有 ${unmatched.length - 20} 条`);
}

console.log('');
console.log('二、P0 回归：禁止单队兜底式误配');

// 直接调用 scraper 的**真实**匹配函数。
// 此前这里自己重写了一遍匹配规则（与实现同款写法）—— 结构上不可能发现
// 「多候选时永远取第一条」之类的缺陷；离线单测见 tools/test-scraper-match.mjs。
const future = fixtures.filter(m => m.st === 'sched' && !m.tbd);
let hits = 0;
let wrong = 0;
let multiCand = 0;
const wrongSamples = [];
for (const f of future) {
  const res = findRoomFor(games, { h: f.h, a: f.a, t: f.t });
  if (!res.room) continue;
  hits++;
  if (res.candidates > 1) multiCand++;
  const g = res.room;
  // 全等匹配下本不该错；显式再验一次，防止将来有人把兜底逻辑加回来
  const okPair = (g.homeId === f.h && g.awayId === f.a) || (g.homeId === f.a && g.awayId === f.h);
  if (!okPair) {
    wrong++;
    if (wrongSamples.length < 5) wrongSamples.push(`${f.h} vs ${f.a} → ${g.homeRaw} vs ${g.awayRaw}`);
  }
}
console.log(`     命中 ${hits} 场（其中同一对阵多候选 ${multiCand} 场）`);
wrongSamples.forEach(s => console.log(`       ✗ ${s}`));
ok('无任何错误匹配', wrong === 0, `${wrong} 场误配`);

console.log('');
console.log('三、失败语义（抓取失败须与「今天没这场」区分）');
{
  const res = await getLiveSourcesForMatch({ matchId: 'PROBE', h: 'ARS', a: 'CHE', t: '2026-09-13T23:30' });
  ok('正常到达聚合站时 scrapeError 为 null', res.scrapeError === null, String(res.scrapeError));
  ok('返回匹配质量字段（候选数 / 歧义标记）',
    typeof res.matchCandidates === 'number' && typeof res.matchAmbiguous === 'boolean',
    `candidates=${res.matchCandidates} ambiguous=${res.matchAmbiguous}`);
  ok('返回保底频道失效清单字段', Array.isArray(res.tvChannelsDown));
}

console.log('');
console.log('四、保底源健康探测（签名 URL 会过期，失效须可见）');
const probe = await probeChannels(true);
for (const ch of TV_SPORTS_CHANNELS) {
  const alive = probe.get(ch.id);
  console.log(`     ${alive ? '可用' : '失效'}  ${ch.tag}`);
}
const deadCount = TV_SPORTS_CHANNELS.filter(c => probe.get(c.id) === false).length;
if (deadCount > 0) {
  console.log(`     ⚠️  ${deadCount} 条保底源已失效：签名过期，需刷新 TV_SPORTS_CHANNELS 配置`);
}
ok('探测结果与源数量一致', probe.size === TV_SPORTS_CHANNELS.length);

console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
// 保底源失效不算测试失败（那是外部依赖问题，只需可见），故不据此退出
if (fail > 0) process.exit(1);
