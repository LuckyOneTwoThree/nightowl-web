/**
 * 防剧透视图模型测试
 *
 * 回归：比分可见性曾散落在 WatchSheet、积分榜、球队页和比赛统计里。
 * 这里锁住唯一 selector，以及 stats 的 excludeIds 透传。
 */
import { ts } from '../src/core/engine.js';
import {
  completedWatchHint,
  hasRevealed,
  isScoreVisible,
  liveScoreForDisplay,
  unrevealedTonightIds,
  WATCH_HINT_LEVEL,
} from '../src/core/reveal.js';
import { computeMatchStats, computeSeasonStats, computeTeamForm } from '../src/core/stats.js';

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
    console.log(`  ❌ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

const now = ts('2026-10-27T18:00');
const fixtures = [
  { id: 'N1', l: 'PL', r: 1, t: '2026-10-27T19:00', st: 'done', h: 'A', a: 'B', sc: '1-0' },
  { id: 'N2', l: 'PL', r: 1, t: '2026-10-27T20:00', st: 'done', h: 'A', a: 'C', sc: '2-2' },
  // 凌晨场：owlDay 仍是 10-27
  { id: 'N3', l: 'PL', r: 1, t: '2026-10-28T01:00', st: 'done', h: 'A', a: 'D', sc: '0-1' },
  // 次日白天：不属于今晚
  { id: 'N4', l: 'PL', r: 1, t: '2026-10-26T07:00', st: 'done', h: 'A', a: 'E', sc: '3-0' },
  { id: 'N5', l: 'PL', r: 2, t: '2026-10-27T23:00', st: 'sched', h: 'A', a: 'D' }
];

console.log('防剧透视图模型测试');
console.log('');

console.log('一、今晚未揭晓集合');
{
  ok('Set 形式揭晓集合', hasRevealed(new Set(['N1']), 'N1') && !hasRevealed(new Set(['N1']), 'N2'));
  ok('object 形式揭晓集合', hasRevealed({ N1: true }, 'N1') && !hasRevealed({}, 'N1'));
  ok('array 形式揭晓集合', hasRevealed(['N1'], 'N1') && !hasRevealed([], 'N1'));
  ok('比分可见性：关防剧透或已揭晓', isScoreVisible(false, false) && isScoreVisible(true, true) && !isScoreVisible(true, false));
  const score = { h: 2, a: 1 };
  ok('★ 直播比分显示 helper 遵守防剧透',
    liveScoreForDisplay(score, true, false) === null &&
      liveScoreForDisplay(score, true, true) === score &&
      liveScoreForDisplay(score, false, false) === score);

  const ids = unrevealedTonightIds(fixtures, now, true, new Set(['N1']));
  ok('★ 只排除当前夜猫日且未揭晓的已完赛场次',
    ids.has('N2') && ids.has('N3') && !ids.has('N1') && !ids.has('N4') && !ids.has('N5'),
    [...ids].join(','));
  ok('★ 关闭防剧透时不排除任何场次', unrevealedTonightIds(fixtures, now, false, new Set()).size === 0);
  ok('★ 跨过 06:00 的白天场次不属于今晚', !unrevealedTonightIds(fixtures, now, true, new Set()).has('N4'));
}

console.log('');
console.log('二、stats 排除透传');
{
  const exclude = unrevealedTonightIds(fixtures, now, true, new Set(['N1']));
  const current = fixtures[4];
  const form = computeTeamForm('A', current, fixtures, 5, { excludeIds: exclude });
  ok('★ 近 5 场排除未揭晓场次', form.length === 2 && form.every(f => !['N2','N3'].includes(f.matchId)),
    form.map(f => f.matchId).join(','));
  const season = computeSeasonStats('A', 'PL', fixtures, Infinity, { excludeIds: exclude });
  ok('★ 赛季统计排除未揭晓场次', season.played === 2 && season.wins === 2 && season.draws === 0 && season.losses === 0,
    JSON.stringify(season));
  const stats = computeMatchStats(current, fixtures, { excludeIds: exclude });
  ok('★ 比赛统计整体透传 excludeIds',
    stats.home.form.length === 2 && stats.home.season.played === 2 &&
      stats.h2h.meetings.every(m => m.id !== 'N3'),
    JSON.stringify({ form: stats.home.form.length, played: stats.home.season.played, h2h: stats.h2h.meetings.map(m => m.id) }));
}

console.log('');
console.log('三、防剧透观赛热度提示');
{
  const h00 = completedWatchHint({ st: 'done', sc: '0-0' }, { star: 1, isFollowed: false });
  const h10 = completedWatchHint({ st: 'done', sc: '1-0' }, { star: 1, isFollowed: false });
  ok('★ 0-0 与低星 1-0 同属 low 档，不可反向猜出 0-0',
    h00?.level === WATCH_HINT_LEVEL.LOW &&
      h10?.level === WATCH_HINT_LEVEL.LOW &&
      h00?.label === h10?.label &&
      h00?.shortLabel === h10?.shortLabel);

  const h21 = completedWatchHint({ st: 'done', sc: '2-1' }, { star: 2, isFollowed: false });
  const h20Star3 = completedWatchHint({ st: 'done', sc: '2-0' }, { star: 3, isFollowed: false });
  ok('★ 总进球 >=3 或 3★ 且 2 球归为 high',
    h21?.level === WATCH_HINT_LEVEL.HIGH && h20Star3?.level === WATCH_HINT_LEVEL.HIGH);

  const hFollowed10 = completedWatchHint({ st: 'done', sc: '1-0' }, { star: 1, isFollowed: true });
  ok('关注球队 1-0 归为 normal 而非直接判 low', hFollowed10?.level === WATCH_HINT_LEVEL.NORMAL);

  const sched = completedWatchHint({ st: 'sched', sc: null });
  ok('未完赛不返回热度提示', sched === null);

  const texts = [h00, h10, h21, h20Star3, hFollowed10].map(x => `${x.label}|${x.shortLabel}`).join(' ');
  ok('★ 提示文案不泄露比分数字、胜负或主客队',
    !/\d+\s*[-:]\s*\d+|胜|负|平局|主队|客队/.test(texts),
    texts);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
