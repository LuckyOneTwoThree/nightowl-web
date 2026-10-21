/**
 * 赛后集锦联网健康检查
 *
 * 不进入 CI（TheSportsDB 免费 key 30 次/分钟，且上游内容会变）。
 * 目标：确认五大联赛最近一场完赛仍能拿到 YouTube 集锦，且没有错配。
 *
 * 运行：npm run test:highlights:online
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadFixtures } from '../server/data-store.js';
import { loadRules } from '../server/proxy.js';
import { resolveHighlights, buildTeamResolver } from '../server/highlights.js';
import { ts } from '../src/core/engine.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rules = loadRules();
const fixtures = await loadFixtures();
const teams = JSON.parse(readFileSync(resolve(ROOT, 'src/data/teams.json'), 'utf8'));
const resolveTeam = buildTeamResolver(teams);

const leagues = ['PL', 'PD', 'SA', 'BL', 'FL'];
const targets = leagues
  .map(lg => {
    const list = fixtures
      .filter(m => m.l === lg && m.st === 'done' && m.sc)
      .sort((a, b) => ts(b.t) - ts(a.t));
    return list[0];
  })
  .filter(Boolean);

console.log('赛后集锦联网检查');
console.log(`样本：${targets.length} 场（五大联赛各取最近一场完赛）`);
console.log('');

let okCount = 0;
let errorCount = 0;
let wrongCount = 0;
let found = 0;

for (const match of targets) {
  const r = await resolveHighlights(match, { rules, persist: false, force: true });
  if (!r.ok) {
    errorCount++;
    console.log(`  ❌ ${match.l} ${match.id} ${match.h}-${match.a}：${r.reason} ${r.message || ''}`);
    continue;
  }

  if (!r.videos.length) {
    console.log(`  ⚠️  ${match.l} ${match.id} ${match.h}-${match.a}：暂无可索引集锦（${r.reason || 'empty'}）`);
    continue;
  }

  found++;
  const v = r.videos[0];
  const pair = String(v.eventName || '').split(/\s+vs\s+/i);
  const rh = pair.length === 2 ? resolveTeam(pair[0], match.l) : null;
  const ra = pair.length === 2 ? resolveTeam(pair[1], match.l) : null;
  const same =
    (rh === match.h && ra === match.a) || (rh === match.a && ra === match.h);
  const youTube = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(v.url);

  if (!same) {
    wrongCount++;
    console.log(`  ❌ ${match.l} ${match.id}：集锦错配 → ${v.eventName || '(无标题)'}`);
    continue;
  }
  if (!youTube) {
    errorCount++;
    console.log(`  ❌ ${match.l} ${match.id}：非 YouTube 地址 ${v.url}`);
    continue;
  }

  okCount++;
  console.log(`  ✅ ${match.l} ${match.id}：${v.eventName} → ${v.url}`);
}

console.log('');
console.log(`结果：命中 ${found} / ${targets.length}，校验通过 ${okCount}，上游错误 ${errorCount}，错配 ${wrongCount}`);

if (wrongCount > 0) {
  console.error('✖ 存在集锦错配，必须修复后再发布');
  process.exit(1);
}
if (errorCount > 0) {
  console.error('✖ 上游错误（配置/网络/赛季串），请检查 rules.highlights');
  process.exit(1);
}
if (found < 3) {
  console.error('✖ 可索引集锦少于 3 个联赛，疑似上游覆盖崩塌');
  process.exit(1);
}
console.log('✓ 集锦覆盖与匹配检查通过（UCL 走官方平台，不在本检查范围）');
