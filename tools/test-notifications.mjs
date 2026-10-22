/**
 * 通知文案 / 时机 / 事件口径测试
 *
 * 纯离线。系统通知的弹出由 Electron 主进程负责，这里只测可回归的纯函数。
 *
 * 运行：node tools/test-notifications.mjs
 */

import {
  isPrematchDue,
  prematchNotification,
  liveEventNotification,
  fullTimeNotification
} from '../src/core/notifications.js';
import {
  EVENT_LABEL,
  eventSummary,
  eventKey,
  shouldNotifyEvent
} from '../src/core/live-events.js';
import { ts } from '../src/core/engine.js';

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

const match = {
  id: 'PL-TEST-ARS-COV',
  l: 'PL',
  r: 7,
  t: '2026-10-21T02:45',
  tbd: false,
  st: 'sched',
  h: 'ARS',
  a: 'COV'
};

console.log('通知与事件口径测试');
console.log('');

/* ================================================================== */
console.log('一、赛前 15 分钟窗口');
{
  ok('距开球 14 分钟 → 提醒', isPrematchDue(match, ts('2026-10-21T02:31')));
  ok('距开球 15 分钟整 → 提醒', isPrematchDue(match, ts('2026-10-21T02:30')));
  ok('★ 距开球 16 分钟 → 不提醒', !isPrematchDue(match, ts('2026-10-21T02:29')));
  ok('开球瞬间仍提醒', isPrematchDue(match, ts('2026-10-21T02:45')));
  ok('已过开球 → 不提醒', !isPrematchDue(match, ts('2026-10-21T02:46')));
  ok('tbd 场次不提醒', !isPrematchDue({ ...match, tbd: true }, ts('2026-10-21T02:31')));
  ok('已完赛不提醒', !isPrematchDue({ ...match, st: 'done' }, ts('2026-10-21T02:31')));
  ok('非法时间不提醒', !isPrematchDue({ ...match, t: 'bad' }, ts('2026-10-21T02:31')));
}

/* ================================================================== */
console.log('');
console.log('二、赛前文案');
{
  const normal = prematchNotification(match);
  ok('普通提醒标题含双方队名', normal.title === '即将开球 · 阿森纳 vs 考文垂', normal.title);
  ok('正文含开球时间/联赛/轮次', normal.body.includes('02:45') && normal.body.includes('英超') && normal.body.includes('第 7 轮'), normal.body);

  const hero = prematchNotification(match, { isHero: true });
  ok('★ 今晚之选有独立标题', hero.title.startsWith('今晚之选即将开球'), hero.title);
}

/* ================================================================== */
console.log('');
console.log('三、实时事件摘要与通知文案');
{
  const live = { score: { h: 2, a: 1 } };
  const goal = { clock: "61'", type: 'goal', side: 'h', text: 'Goal! Arsenal 2, Coventry 1.' };
  const red = { clock: "64'", type: 'red', side: 'a', text: 'Coventry player sent off.' };

  ok('进球摘要', eventSummary(goal, match) === '阿森纳进球', eventSummary(goal, match));
  ok('红牌摘要', eventSummary(red, match) === '考文垂红牌', eventSummary(red, match));
  ok('点球摘要', eventSummary({ type: 'penalty', side: 'h' }, match) === '阿森纳点球');
  ok('VAR 摘要', eventSummary({ type: 'var', side: 'a' }, match) === 'VAR · 考文垂');
  ok('黄牌标签存在', EVENT_LABEL.yellow === '黄牌');
  ok(
    '★ 头球进球补中文细节',
    eventSummary({ ...goal, typeText: 'Goal - Header' }, match) === '阿森纳进球 · 头球',
    eventSummary({ ...goal, typeText: 'Goal - Header' }, match)
  );
  ok(
    '★ 点球进球补中文细节',
    eventSummary({ type: 'goal', side: 'h', typeText: 'Penalty - Scored' }, match) === '阿森纳进球 · 点球',
    eventSummary({ type: 'goal', side: 'h', typeText: 'Penalty - Scored' }, match)
  );
  ok(
    '★ 点球未进不显示成进球',
    eventSummary({ type: 'penalty', side: 'h', typeText: 'Penalty - Missed' }, match) === '阿森纳点球未进',
    eventSummary({ type: 'penalty', side: 'h', typeText: 'Penalty - Missed' }, match)
  );
  ok(
    '★ 第二张黄牌区分',
    eventSummary({ type: 'yellow', side: 'a', typeText: 'Second Yellow Card' }, match) === '考文垂第二张黄牌',
    eventSummary({ type: 'yellow', side: 'a', typeText: 'Second Yellow Card' }, match)
  );

  const gn = liveEventNotification(match, live, goal);
  ok('★ 进球通知标题含类型与比分', gn.title === '进球 · 阿森纳 2-1 考文垂', gn.title);
  ok('进球通知正文含分钟与摘要', gn.body.includes("61'") && gn.body.includes('阿森纳进球'), gn.body);

  const rn = liveEventNotification(match, live, red);
  ok('红牌通知标题正确', rn.title === '红牌 · 阿森纳 2-1 考文垂', rn.title);
  ok('红牌通知正文归属正确', rn.body.includes('考文垂红牌'), rn.body);

  const ft = fullTimeNotification(match, live);
  ok('★ 终场通知标题含最终比分', ft.title === '终场 · 阿森纳 2-1 考文垂', ft.title);
  ok('终场通知引导查看回顾与集锦', ft.body.includes('赛后回顾与集锦'), ft.body);
}

/* ================================================================== */
console.log('');
console.log('四、事件去重与通知过滤');
{
  const ev = { clock: "61'", type: 'goal', side: 'h', text: 'Goal! Arsenal 2, Coventry 1.' };
  ok('同一事件 key 稳定', eventKey(ev) === eventKey({ ...ev }));
  ok('不同分钟 key 不同', eventKey(ev) !== eventKey({ ...ev, clock: "62'" }));
  ok('不同事件 key 不同', eventKey(ev) !== eventKey({ ...ev, text: 'Goal! Arsenal 3, Coventry 1.' }));

  ok('进球进入通知', shouldNotifyEvent({ type: 'goal' }));
  ok('红牌进入通知', shouldNotifyEvent({ type: 'red' }));
  ok('点球进入通知', shouldNotifyEvent({ type: 'penalty' }));
  ok('★ 黄牌不进通知（降噪）', !shouldNotifyEvent({ type: 'yellow' }));
  ok('★ VAR 不进通知（降噪）', !shouldNotifyEvent({ type: 'var' }));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n失败项：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
