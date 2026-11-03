/**
 * 决策条纯函数测试（离线）
 *
 * 只断言语义枚举与数值，不断言文案 —— 文案属于视图层。
 */
import {
  DECISION_REASON,
  DECISION_VERDICT,
  DEFER_MIN_COST_MINUTES,
  decisionStrip,
  lighterAlternative
} from '../src/core/decision-strip.js';

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
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const HOUR = 3600000;
const MIN = 60000;

/** 北京墙钟，与真实数据同格式（无时区后缀） */
function at(day, clock) {
  return `2026-11-${String(day).padStart(2, '0')}T${clock}`;
}

const sleepOn = { sleepEnabled: true, sleepWakeTime: '07:30', sleepMinHours: 7 };
const sleepOff = { sleepEnabled: false, sleepWakeTime: '07:30', sleepMinHours: 7 };

function match(o = {}) {
  return { id: 'M1', h: 'AAA', a: 'BBB', l: 'PL', t: at(3, '03:00'), st: 'sched', ...o };
}

// 03:00 开球 + 120min = 05:00 结束；07:30 起床 → 剩 2.5h，缺口 4.5h = 270min
const heavyNight = match();
// 21:00 开球 + 120min = 23:00 结束；07:30 起床 → 剩 8.5h，无缺口
const earlyMatch = match({ id: 'M2', t: at(2, '21:00') });

const NOW = new Date('2026-11-02T20:00:00Z').getTime();

console.log('决策条测试');
console.log('');
console.log('一、结论判定');

const highlight = decisionStrip({ match: heavyNight, index: 22, prefs: sleepOn, now: NOW });
ok('指数 22 但低于底线 → 中性（不再值得熬）', highlight.verdict === DECISION_VERDICT.NEUTRAL, highlight.verdict);
ok('低于底线原因可区分', highlight.reason === DECISION_REASON.BELOW_FLOOR, highlight.reason);
ok('低于底线标记为 true', highlight.belowFloor === true);

const earlyHighlight = decisionStrip({ match: earlyMatch, index: 22, prefs: sleepOn, now: NOW });
ok('不越线的高指数 → 推荐', earlyHighlight.verdict === DECISION_VERDICT.RECOMMENDED, earlyHighlight.verdict);
ok('推荐原因标为高光', earlyHighlight.reason === DECISION_REASON.HIGHLIGHT, earlyHighlight.reason);
ok('不越线标记为 false', earlyHighlight.belowFloor === false);

const neutral = decisionStrip({ match: heavyNight, index: 6, prefs: sleepOn, now: NOW });
ok('越线且无替代 → 中性', neutral.verdict === DECISION_VERDICT.NEUTRAL, neutral.verdict);
ok('越线优先于低指数原因', neutral.reason === DECISION_REASON.BELOW_FLOOR, neutral.reason);
const earlyNeutral = decisionStrip({ match: earlyMatch, index: 6, prefs: sleepOn, now: NOW });
ok('不越线且低指数 → 中性', earlyNeutral.verdict === DECISION_VERDICT.NEUTRAL, earlyNeutral.verdict);
ok('不越线中性原因为低指数', earlyNeutral.reason === DECISION_REASON.LOW_INDEX, earlyNeutral.reason);

const followed = decisionStrip({ match: heavyNight, index: 3, prefs: sleepOn, now: NOW, followed: true });
ok('关注球队但越线 → 中性', followed.verdict === DECISION_VERDICT.NEUTRAL, followed.verdict);
ok('关注球队越线仍保留关注标记', followed.followed === true && followed.reason === DECISION_REASON.BELOW_FLOOR, JSON.stringify({ r: followed.reason, f: followed.followed }));
const followedEarly = decisionStrip({ match: earlyMatch, index: 3, prefs: sleepOn, now: NOW, followed: true });
ok('不越线的关注球队 → 推荐', followedEarly.verdict === DECISION_VERDICT.RECOMMENDED, followedEarly.verdict);
ok('关注优先于低指数', followedEarly.reason === DECISION_REASON.FOLLOWED, followedEarly.reason);

const followedHighlight = decisionStrip({ match: heavyNight, index: 22, prefs: sleepOn, now: NOW, followed: true });
ok('关注 + 越线仍降级为中性', followedHighlight.verdict === DECISION_VERDICT.NEUTRAL);

const missing = decisionStrip({ match: earlyMatch, prefs: sleepOn, now: NOW });
ok('缺指数不崩且不误判为推荐', missing.verdict === DECISION_VERDICT.NEUTRAL, missing.verdict);
ok('缺指数原因可区分', missing.reason === DECISION_REASON.MISSING_INDEX, missing.reason);

console.log('');
console.log('二、时间与代价');

ok('结束时刻 = 开球 + 120 分钟', highlight.endAt === Date.parse('2026-11-02T21:00:00Z'), String(highlight.endAt));
ok('睡眠缺口 270 分钟', highlight.costMinutes === 270, String(highlight.costMinutes));
ok('看完还剩 150 分钟', highlight.remainingMinutes === 150, String(highlight.remainingMinutes));
ok('睡眠账本已启用', highlight.sleepKnown === true);

const noSleep = decisionStrip({ match: heavyNight, index: 6, prefs: sleepOff, now: NOW });
ok('关闭睡眠账本 → 代价未知', noSleep.costMinutes === null, String(noSleep.costMinutes));
ok('关闭睡眠账本 → 剩余未知', noSleep.remainingMinutes === null);
ok('关闭睡眠账本 → sleepKnown=false', noSleep.sleepKnown === false);
ok('关闭睡眠账本仍有结束时刻', noSleep.endAt === highlight.endAt);
ok('关闭睡眠账本从不劝退', noSleep.verdict === DECISION_VERDICT.NEUTRAL, noSleep.verdict);

const enoughSleep = decisionStrip({ match: earlyMatch, index: 6, prefs: sleepOn, now: NOW });
ok('看完还睡得够 → 代价 0', enoughSleep.costMinutes === 0, String(enoughSleep.costMinutes));
ok('睡得够不会劝退', enoughSleep.verdict === DECISION_VERDICT.NEUTRAL);

console.log('');
console.log('三、时间待定');

const tbd = decisionStrip({ match: match({ id: 'TBD1', tbd: true }), index: 30, prefs: sleepOn, now: NOW });
ok('tbd → 未知', tbd.verdict === DECISION_VERDICT.UNKNOWN, tbd.verdict);
ok('tbd 原因为 tbd', tbd.reason === DECISION_REASON.TBD, tbd.reason);
ok('tbd 不承诺结束时刻', tbd.endAt === null);
ok('tbd 不编造代价', tbd.costMinutes === null);
ok('tbd 不推荐替代', tbd.alternativeId === null);

const badTime = decisionStrip({ match: match({ t: 'not-a-time' }), index: 30, prefs: sleepOn, now: NOW });
ok('非法时间 → 未知', badTime.verdict === DECISION_VERDICT.UNKNOWN);
ok('非法时间原因为 invalid', badTime.reason === DECISION_REASON.INVALID, badTime.reason);

const empty = decisionStrip({});
ok('空输入不抛错', empty.verdict === DECISION_VERDICT.UNKNOWN);

console.log('');
console.log('四、更轻的替代');

const altGood = { m: match({ id: 'A1', t: at(3, '01:00') }), index: 12 }; // 03:00 结束，早 2h
const altTooLate = { m: match({ id: 'A2', t: at(3, '03:10') }), index: 18 }; // 只早 110min? 见下
const altTooWeak = { m: match({ id: 'A3', t: at(3, '00:00') }), index: 4 }; // 早但看点太低
const altSelf = { m: heavyNight, index: 9 };

ok('更轻替代要求指数达标', lighterAlternative(heavyNight, 9, [altTooWeak]) === null);
ok('更轻替代排除自己', lighterAlternative(heavyNight, 9, [altSelf]) === null);
ok('更轻替代要求早结束 30 分钟', lighterAlternative(heavyNight, 9, [altTooLate]) === null);

const defer = decisionStrip({
  match: heavyNight,
  index: 9,
  prefs: sleepOn,
  now: NOW,
  alternatives: [altGood, altTooWeak]
});
ok('睡不够且有更轻替代 → 建议换一场', defer.verdict === DECISION_VERDICT.DEFER, defer.verdict);
ok('给出替代场次 id', defer.alternativeId === 'A1', String(defer.alternativeId));
ok('换一场原因为替代', defer.reason === DECISION_REASON.LIGHTER_ALTERNATIVE, defer.reason);

const noDeferBecauseHighlight = decisionStrip({
  match: heavyNight,
  index: 22,
  prefs: sleepOn,
  now: NOW,
  alternatives: [altGood]
});
ok('高光但越线 → 中性，不再打“值得熬”', noDeferBecauseHighlight.verdict === DECISION_VERDICT.NEUTRAL, noDeferBecauseHighlight.verdict);
ok('高光越线不输出替代 id', noDeferBecauseHighlight.alternativeId === null);

const lightGap = decisionStrip({
  match: earlyMatch,
  index: 9,
  prefs: sleepOn,
  now: NOW,
  alternatives: [{ m: match({ id: 'A4', t: at(2, '18:00') }), index: 9 }]
});
ok('睡得够时不劝退', lightGap.verdict === DECISION_VERDICT.NEUTRAL, lightGap.verdict);
ok('sleep 缺口阈值口径可读', DEFER_MIN_COST_MINUTES === 90);

const borderline = decisionStrip({
  match: heavyNight,
  index: 9,
  // 05:00 结束、11:30 起床 → 剩 6.5h；底线 7h → 缺口只有 30 分钟
  prefs: { sleepEnabled: true, sleepWakeTime: '11:30', sleepMinHours: 7 },
  now: NOW,
  alternatives: [altGood]
});
ok('缺口不足 90 分钟不劝退', borderline.verdict === DECISION_VERDICT.NEUTRAL, borderline.verdict);
ok('但代价仍然如实给出', borderline.costMinutes === 30, String(borderline.costMinutes));

console.log('');
console.log('五、防剧透');

const doneEarly = match({ id: 'D1', st: 'done', sc: '2-1', t: at(2, '21:00') });
const hidden = decisionStrip({
  match: doneEarly,
  index: 20,
  prefs: sleepOn,
  now: NOW,
  spoilerFree: true,
  revealed: false
});
ok('完赛未揭晓 → 结果需隐藏', hidden.resultHidden === true);
ok('隐藏结果不影响结论', hidden.verdict === DECISION_VERDICT.RECOMMENDED);

const shown = decisionStrip({
  match: doneEarly,
  index: 20,
  prefs: sleepOn,
  now: NOW,
  spoilerFree: true,
  revealed: true
});
ok('已揭晓 → 结果可见', shown.resultHidden === false);

const noSpoilerFree = decisionStrip({
  match: doneEarly,
  index: 20,
  prefs: sleepOn,
  now: NOW
});
ok('关闭防剧透 → 结果可见', noSpoilerFree.resultHidden === false);

console.log('');
console.log('六、量与纯度');

const sample = decisionStrip({ match: heavyNight, index: 22, prefs: sleepOn, now: NOW });
const keys = Object.keys(sample).sort().join(',');
ok(
  '返回字段固定',
  keys === 'alternativeId,belowFloor,costMinutes,endAt,followed,reason,remainingMinutes,resultHidden,sleepKnown,verdict',
  keys
);
ok('不含任何中文文案', !JSON.stringify(sample).match(/[\u4e00-\u9fa5]/));
ok('HOUR 口径自检', heavyNight.t === '2026-11-03T03:00' && HOUR === 3600000 && MIN === 60000);

console.log('');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  console.log('失败明细：');
  for (const line of failures) console.log(`  · ${line}`);
  process.exit(1);
}
