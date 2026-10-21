/**
 * 命令面板：比赛命令构建 + 搜索打分
 *
 * 运行：node tools/test-palette.mjs
 */

import {
  VIEW_COMMANDS,
  ACTION_COMMANDS,
  buildMatchCommands,
  searchPalette
} from '../src/core/command-palette.js';

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

const fixtures = [
  {
    id: 'PL-1-ARS-COV',
    l: 'PL',
    r: 1,
    t: '2026-08-22T03:00',
    tbd: false,
    st: 'done',
    h: 'ARS',
    a: 'COV',
    sc: '3-0'
  },
  {
    id: 'PD-1-RMA-RSO',
    l: 'PD',
    r: 1,
    t: '2026-10-23T03:00',
    tbd: false,
    st: 'sched',
    h: 'RMA',
    a: 'RSO',
    sc: null
  }
];

const matchItems = buildMatchCommands(fixtures);
const items = [...VIEW_COMMANDS, ...ACTION_COMMANDS, ...matchItems];

console.log('命令面板测试');
console.log('');

/* ================================================================== */
console.log('一、比赛命令构建');
{
  const ars = matchItems.find(x => x.id === 'match:PL-1-ARS-COV');
  ok('标题使用中文双方队名', ars?.title === '阿森纳 vs 考文垂', ars?.title);
  ok('副标题含联赛与日期', ars?.subtitle.includes('英超') && ars?.subtitle.includes('2026-08-22'), ars?.subtitle);
  ok('★ 副标题不含比分（防剧透）', !String(ars?.subtitle).includes('3-0'), ars?.subtitle);
  ok('关键词含球队 ID 与联赛', ars?.keywords.includes('ARS') && ars?.keywords.includes('PL'));
  ok('动作携带 matchId', ars?.action?.type === 'match' && ars?.action?.matchId === 'PL-1-ARS-COV');

  const now = Date.UTC(2026, 9, 21, 4, 0);
  const ordered = buildMatchCommands(fixtures, now);
  ok('★ 未来比赛排在同队旧赛果前面', ordered[0]?.action?.matchId === 'PD-1-RMA-RSO', ordered[0]?.action?.matchId);
}

/* ================================================================== */
console.log('');
console.log('二、搜索');
{
  ok('空查询返回前 N 条', searchPalette(items, '', 4).length === 4);
  ok('★ 空查询优先展示导航/操作', searchPalette(items, '', 4).every(x => x.kind === '导航' || x.kind === '操作'));

  const byTeam = searchPalette(items, '阿森纳');
  ok('★ 中文队名命中比赛', byTeam[0]?.id === 'match:PL-1-ARS-COV', byTeam[0]?.id);
  const byEn = searchPalette(items, 'ars');
  ok('英文缩写命中比赛', byEn.some(x => x.id === 'match:PL-1-ARS-COV'));
  const byLeague = searchPalette(items, '西甲');
  ok('联赛名命中比赛', byLeague.some(x => x.id === 'match:PD-1-RMA-RSO'));
  const byId = searchPalette(items, 'PD-1-RMA-RSO');
  ok('场次 ID 命中比赛', byId[0]?.id === 'match:PD-1-RMA-RSO', byId[0]?.id);

  ok('「设置」命中偏好操作', searchPalette(items, '设置')[0]?.action?.type === 'settings');
  ok('「今晚」命中今晚导航', searchPalette(items, '今晚')[0]?.action?.view === 'tonight');
  ok('「sync」命中同步操作', searchPalette(items, 'sync')[0]?.action?.type === 'sync');
  ok('无匹配返回空数组', searchPalette(items, 'zzzzzz').length === 0);
  ok('limit 生效', searchPalette(items, '0', 2).length <= 2);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
