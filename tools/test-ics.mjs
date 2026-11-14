/**
 * 日历导出（ICS）测试（离线）
 *
 * 守住 PRD FR-09 的四条：只导未来且时间确定的场次、标题不含比分、时区正确、空集报错。
 * 另外守住两条容易写错的实现细节：
 *   · 折行必须按字节（中文队名按字符折会得到 200+ 字节的行）
 *   · 转义顺序（先反斜杠，否则后插入的反斜杠被二次转义）
 *
 * 运行：node tools/test-ics.mjs
 */

import {
  bjStamp,
  buildIcs,
  escapeText,
  foldLine,
  selectIcsMatches,
  utcStamp
} from '../src/core/ics.js';

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
};

// 2026-11-01 21:00 北京时间
const NOW = Date.UTC(2026, 10, 1, 13, 0, 0);

const m = (id, t, extra = {}) => ({
  id,
  l: 'PL',
  r: 9,
  t,
  st: 'sched',
  h: 'ARS',
  a: 'MCI',
  tbd: false,
  ...extra
});

console.log('日历导出（ICS）测试');
console.log('');
console.log('一、时间与转义');

{
  ok('北京墙钟序列化（不带到秒的偏移）', bjStamp(Date.UTC(2026, 10, 1, 16, 30, 0)) === '20261102T003000', bjStamp(Date.UTC(2026, 10, 1, 16, 30, 0)));
  ok('UTC 序列化用于 DTSTAMP', utcStamp(NOW) === '20261101T130000Z', utcStamp(NOW));
}
{
  ok('反斜杠先转义再处理分隔符', escapeText('a\\b;c,d') === 'a\\\\b\\;c\\,d', escapeText('a\\b;c,d'));
  ok('换行转成字面量 \\n', escapeText('上半场\n下半场') === '上半场\\n下半场', escapeText('上半场\n下半场'));
}
{
  // 中文队名：按字节折行，续行以空格开头且不超过 75 字节
  const long = `DESCRIPTION:${'曼彻斯特联 vs 曼彻斯特城 '.repeat(6)}`;
  const folded = foldLine(long);
  const lines = folded.split('\r\n ');
  ok('★ 超过 75 字节的行被折开', lines.length > 1);
  ok('★ 每个折行片段都不超过 75 字节', lines.every(l => Buffer.byteLength(l, 'utf8') <= (l === lines[0] ? 75 : 74) + 1), lines.map(l => Buffer.byteLength(l, 'utf8')).join(','));
  ok('折行不破坏中文（无乱码替换符）', !folded.includes('\uFFFD'));
}

console.log('');
console.log('二、筛选范围');

{
  const matches = [
    m('F1', '2026-11-01T23:00'), // 今晚
    m('F2', '2026-11-02T03:00'), // 今晚（凌晨归前一夜）
    m('F3', '2026-11-02T23:00'), // 明天
    m('F4', '2026-11-01T12:00'), // 已开赛
    m('F5', '2026-11-03T03:00', { tbd: true }), // 时间待定
    m('F6', '2026-11-03T03:00', { st: 'done', sc: '2-1' }) // 已完赛
  ];
  const tonight = selectIcsMatches(matches, { range: 'tonight', nowTs: NOW });
  ok('★ 今晚范围只取当前夜猫日', tonight.map(x => x.id).join(',') === 'F1,F2', tonight.map(x => x.id).join(','));
  ok('★ 已开赛的不导出', !tonight.some(x => x.id === 'F4'));
  ok('★ tbd 不导出', !tonight.some(x => x.id === 'F5'));
  ok('★ 已完赛不导出', !tonight.some(x => x.id === 'F6'));

  const week = selectIcsMatches(matches, { range: 'week', nowTs: NOW, weekStartStr: '2026-10-26' });
  // NOW 是 11-01（周日），这一周是 10-26 ~ 11-01；F3 落在下一周，不该被导出
  ok('★ 本周范围只覆盖本周夜猫日', week.map(x => x.id).join(',') === 'F1,F2', week.map(x => x.id).join(','));

  const weekEmptySet = selectIcsMatches(matches, {
    range: 'week',
    nowTs: NOW,
    weekStartStr: '2026-10-26',
    weekIds: new Set()
  });
  ok('★ 显式传入空 weekIds Set 时返回空，不回退导出全周', weekEmptySet.length === 0, String(weekEmptySet.length));

  const weekPicked = selectIcsMatches(matches, {
    range: 'week',
    nowTs: NOW,
    weekStartStr: '2026-10-26',
    weekIds: new Set(['F2', 'F3'])
  });
  ok('传入 weekIds Set 时仅导出集合内未来且时间确定的场次', weekPicked.map(x => x.id).join(',') === 'F2,F3', weekPicked.map(x => x.id).join(','));

  const followed = selectIcsMatches(matches, {
    range: 'followed',
    nowTs: NOW,
    followedTeams: ['ARS'],
    weekStartStr: '2026-10-26'
  });
  ok('关注球队范围仍排除 tbd 与已开赛', followed.length === 3, String(followed.length));
  ok('未关注任何球队时返回空', selectIcsMatches(matches, { range: 'followed', nowTs: NOW, followedTeams: [] }).length === 0);
}

console.log('');
console.log('三、日历正文');

{
  const ics = buildIcs({ matches: [m('F1', '2026-11-01T23:00')], now: NOW, reminderMinutes: 15 });
  ok('含 VCALENDAR 头尾', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
  ok('★ 带 Asia/Shanghai 时区定义', ics.includes('TZID:Asia/Shanghai') && ics.includes('BEGIN:VTIMEZONE'));
  ok('★ 开球时间按北京墙钟写入', ics.includes('DTSTART;TZID=Asia/Shanghai:20261101T230000'));
  ok('结束时间 = 开球 + 2 小时', ics.includes('DTEND;TZID=Asia/Shanghai:20261102T010000'));
  ok('★ 标题是联赛 + 双方队名', ics.includes('SUMMARY:英超 阿森纳 vs 曼城'), ics.match(/SUMMARY:[^\r\n]*/)?.[0]);
  ok('★ 不含比分', !/\d-\d/.test(ics));
  ok('★ 提醒按选择生成（15 分钟）', ics.includes('TRIGGER:-PT15M'));
  ok('换行统一 CRLF', !/[^\r]\n/.test(ics));
}
{
  const ics = buildIcs({ matches: [m('F1', '2026-11-01T23:00')], now: NOW, reminderMinutes: 0 });
  ok('提醒关闭时不生成 VALARM', !ics.includes('BEGIN:VALARM'));
}
{
  let threw = null;
  try {
    buildIcs({ matches: [], now: NOW });
  } catch (err) {
    threw = err.message;
  }
  ok('★ 没有可导出场次时明确报错，不生成空文件', typeof threw === 'string' && threw.includes('没有可导出的场次'), String(threw));
}
{
  // 已开赛的场次即使被传进来也不落进日历
  const ics = buildIcs({ matches: [m('F4', '2026-11-01T12:00'), m('F1', '2026-11-01T23:00')], now: NOW });
  ok('混入已开赛场次时只导出未来的那场', !ics.includes('F4@nightowl-terrace') && ics.includes('F1@nightowl-terrace'));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
