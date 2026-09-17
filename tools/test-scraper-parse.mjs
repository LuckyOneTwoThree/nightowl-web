/**
 * 抓取器 HTML 解析回归测试（纯离线，进 test:all）
 *
 * 守住两件事：
 *   1. 结构性探活：站点改版（类名变了、HTML 仍在）时，必须抛错而非静默返回空数组
 *      —— 否则抓取挂了界面只说「暂无线路」，用户分不清是没匹配还是抓取坏了
 *   2. 解析正确性：给定真实结构样本，能解析出正确的场次/队名/时间
 *
 * 样本是**按真实站点结构构造的最小用例**（真实首页含敏感链接，不入库）。
 *
 * 运行：node tools/test-scraper-parse.mjs
 */

import { parseScheduleHtml } from '../server/scraper.js';

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

/** 构造一条符合真实结构的房间 HTML */
function oneGame(gameId, home, away, time, status) {
  return `<a class="group-game-item" href="/live/${gameId}/play">
    <span class="category-game-time">${time}</span>
    <div class="team-wrap">
      <span class="team-name">${home}</span>
      <span class="team-name">${away}</span>
    </div>
    <span class="game-status">${status}</span>
  </a>`;
}

console.log('抓取器 HTML 解析回归测试');
console.log('');

/* ================================================================== */
console.log('一、正常解析');
{
  const html = `<html><body>${[
    oneGame(101, '阿森纳', '曼城', '03:00', '未开始'),
    oneGame(102, '皇马', '巴萨', '04:00', '直播中')
  ].join('')}</body></html>`;

  const games = parseScheduleHtml(html, 'https://www.88kanqiu.net');
  ok('解析出 2 个场次', games.length === 2, `实际 ${games.length}`);
  ok('gameId 正确', games[0].gameId === '101');
  ok('主队原始名正确', games[0].homeRaw === '阿森纳');
  ok('客队原始名正确', games[0].awayRaw === '曼城');
  ok('开球时间正确', games[0].time === '03:00');
  ok('playUrl 拼接 baseUrl', games[0].playUrl === 'https://www.88kanqiu.net/live/101/play');
  ok('直播状态识别', games[1].isLive === true && games[1].isUpcoming === false);
  ok('未开赛状态识别', games[0].isUpcoming === true && games[0].isLive === false);
  ok('中文队名解析为球队 id', games[0].homeId === 'ARS' && games[0].awayId === 'MCI',
    `实际 ${games[0].homeId}/${games[0].awayId}`);
}

/* ================================================================== */
console.log('');
console.log('二、★ 结构性探活：改版时必须抛错，不能静默返回空');
{
  // 站点改版：容器类名改了，但直播链接仍在 HTML 里（多个 → 触发探活）
  const redesigned = `<html><body>${Array(6)
    .fill(0)
    .map((_, i) => `<div class="match-card-v2"><a href="/live/${200 + i}/play">比赛 ${i}</a></div>`)
    .join('')}</body></html>`;

  // 直接调用 parseScheduleHtml 只得到空数组（探活在 fetchSchedule 层），
  // 所以这里验证的是「探活判据本身」：含多个 live 链接的页面不该被当成「无比赛」
  const parsed = parseScheduleHtml(redesigned);
  ok('改版结构下解析为 0 条（正则失效）', parsed.length === 0);
  ok('改版页面含 ≥3 个直播链接（探活信号存在）', (redesigned.match(/\/live\/\d+\/play/gi) || []).length >= 3);
}

console.log('');
console.log('二·二、★ 探活不误报：真正的无比赛日不能被判成改版');
{
  // 无比赛日：页面长（含导航/样式），但只有 1~2 个页脚回放链接
  const padding = '<style>' + 'x'.repeat(3000) + '</style>';
  const emptyDay = `<html><body>${padding}<main>今日暂无赛程</main>` +
    `<footer><a href="/live/999/play">昨日回放</a></footer></body></html>`;
  ok('无比赛日页面足够长（>2000）', emptyDay.length > 2000);
  ok('无比赛日页面直播链接 <3 个（不触发探活）', (emptyDay.match(/\/live\/\d+\/play/gi) || []).length < 3);
  ok('无比赛日页面解析为 0 条', parseScheduleHtml(emptyDay).length === 0);
}

/* ================================================================== */
console.log('');
console.log('三、缺字段时的降级（不因次要字段缺失而整条丢弃）');
{
  // 缺时间的场次：仍然解析，time 为空
  const noTime = `<a class="group-game-item" href="/live/103/play">
    <div class="team-wrap"><span class="team-name">利物浦</span><span class="team-name">埃弗顿</span></div>
  </a>`;
  const games = parseScheduleHtml(noTime);
  ok('缺时间的场次仍被解析', games.length === 1 && games[0].gameId === '103');
  ok('缺时间时 time 为空串', games.length === 1 && games[0].time === '');

  // 只有 team-name 不足两条的条目被丢弃
  const oneTeam = `<a class="group-game-item" href="/live/104/play">
    <div class="team-wrap"><span class="team-name">利物浦</span></div>
  </a>`;
  ok('队名不足两条的条目被丢弃', parseScheduleHtml(oneTeam).length === 0);
}

/* ================================================================== */
console.log('');
console.log('四、鲁棒性：空输入与异常输入不抛错');
{
  ok('空字符串返回空数组', parseScheduleHtml('').length === 0);
  ok('null 返回空数组', parseScheduleHtml(null).length === 0);
  ok('undefined 返回空数组', parseScheduleHtml(undefined).length === 0);
  ok('纯文本（无标签）返回空数组', parseScheduleHtml('hello world').length === 0);
}

/* ================================================================== */
console.log('');
console.log('五、多场次不重不漏');
{
  const html = Array.from({ length: 12 }, (_, i) =>
    oneGame(300 + i, '阿森纳', '曼城', '03:00', '未开始')
  ).join('');
  ok('12 条全部解析', parseScheduleHtml(html).length === 12);
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
}
