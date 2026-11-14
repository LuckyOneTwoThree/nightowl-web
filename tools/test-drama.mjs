import assert from 'node:assert/strict';
import { DRAMA_TAGS, parseClockMinute, summarizeDrama } from '../src/core/drama.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

check('parseClockMinute 解析常规与伤停补时时钟', () => {
  assert.deepEqual(parseClockMinute("12'"), { base: 12, added: 0, minute: 12 });
  assert.deepEqual(parseClockMinute("45+3'"), { base: 45, added: 3, minute: 48 });
  assert.deepEqual(parseClockMinute("90+4'"), { base: 90, added: 4, minute: 94 });
  assert.equal(parseClockMinute(''), null);
  assert.equal(parseClockMinute(null), null);
});

check('上半场补时 45+3 不误判为终场悬念', () => {
  const m = { id: 'm1', h: 'ARS', a: 'MCI', st: 'done', sc: '1-0' };
  const out = summarizeDrama(m, [{ type: 'goal', side: 'h', clock: "45+3'" }]);
  assert.equal(out.available, true);
  assert.equal(out.hasEvents, true);
  assert.equal(out.tags.some(t => t.id === DRAMA_TAGS.LATE_DRAMA.id), false);
  assert.deepEqual(out.pulseMinutes, [48]);
});

check('终场悬念 + 剧本反转同时触发且严格截断至 2 枚标签', () => {
  const m = { id: 'm2', h: 'ARS', a: 'LIV', st: 'done', sc: '2-3' };
  const events = [
    { type: 'goal', side: 'h', clock: "15'" },
    { type: 'goal', side: 'h', clock: "32'" },
    { type: 'goal', side: 'a', clock: "50'" },
    { type: 'goal', side: 'a', clock: "71'" },
    { type: 'red', side: 'h', clock: "80'" },
    { type: 'goal', side: 'a', clock: "90+2'" }
  ];
  const out = summarizeDrama(m, events);
  assert.equal(out.tags.length, 2);
  assert.equal(out.tags[0].id, DRAMA_TAGS.LATE_DRAMA.id);
  assert.equal(out.tags[1].id, DRAMA_TAGS.COMEBACK.id);
  assert.deepEqual(out.pulseMinutes, [15, 32, 50, 71, 80, 92]);
});

check('绝平拉锯识别 >= 2 次回到平局', () => {
  const m = { id: 'm3', h: 'BAR', a: 'RMA', st: 'done', sc: '2-2' };
  const events = [
    { type: 'goal', side: 'h', clock: "10'" },
    { type: 'goal', side: 'a', clock: "25'" },
    { type: 'goal', side: 'a', clock: "55'" },
    { type: 'goal', side: 'h', clock: "78'" }
  ];
  const out = summarizeDrama(m, events);
  assert.equal(out.tags.some(t => t.id === DRAMA_TAGS.COMEBACK.id), true);
  assert.equal(out.tags.some(t => t.id === DRAMA_TAGS.SEESAW.id), true);
});

check('3-0 垃圾时间 88 分钟进球不算终场悬念', () => {
  const m = { id: 'm4', h: 'BAY', a: 'DOR', st: 'done', sc: '4-0' };
  const events = [
    { type: 'goal', side: 'h', clock: "10'" },
    { type: 'goal', side: 'h', clock: "30'" },
    { type: 'goal', side: 'h', clock: "60'" },
    { type: 'goal', side: 'h', clock: "88'" }
  ];
  const out = summarizeDrama(m, events);
  assert.equal(out.tags.some(t => t.id === DRAMA_TAGS.LATE_DRAMA.id), false);
  assert.equal(out.tags.some(t => t.id === DRAMA_TAGS.GOAL_FEST.id), true);
});

check('0-0 无红点标签为颗粒无收；0-0 有红牌不算颗粒无收', () => {
  const m0 = { id: 'm5', h: 'INT', a: 'JUV', st: 'done', sc: '0-0' };
  const boring = summarizeDrama(m0, []);
  assert.equal(boring.tags[0].id, DRAMA_TAGS.GOALLESS.id);
  assert.deepEqual(boring.pulseMinutes, []);

  const wild00 = summarizeDrama(m0, [{ type: 'red', side: 'a', clock: "64'" }]);
  assert.equal(wild00.tags.some(t => t.id === DRAMA_TAGS.GOALLESS.id), false);
  assert.equal(wild00.tags[0].id, DRAMA_TAGS.CARDS_PENALTY.id);
});

check('无事件明细时诚实降级：不猜测反转、不画伪造脉冲点', () => {
  const m = { id: 'm6', h: 'ARS', a: 'CHE', st: 'done', sc: '3-2' };
  const out = summarizeDrama(m, null);
  assert.equal(out.available, true);
  assert.equal(out.hasEvents, false);
  assert.equal(out.degradedReason, 'no-events');
  assert.deepEqual(out.pulseMinutes, []);
  assert.deepEqual(out.tags.map(t => t.id), [DRAMA_TAGS.GOAL_FEST.id]);
});

check('乌龙球 side 错向与终场比分不自洽时，禁用虚假反转推演', () => {
  const m = { id: 'm7', h: 'ARS', a: 'TOT', st: 'done', sc: '2-1' };
  // 故意把乌龙球标反成 side:'a' 导致 tempH=1, tempA=2 与 2-1 矛盾
  const events = [
    { type: 'goal', side: 'a', clock: "20'" },
    { type: 'own', side: 'a', clock: "40'" },
    { type: 'goal', side: 'h', clock: "75'" }
  ];
  const out = summarizeDrama(m, events);
  assert.equal(out.tags.some(t => t.id === DRAMA_TAGS.COMEBACK.id), false);
  assert.deepEqual(out.pulseMinutes, [20, 40, 75]);
});

check('防剧透序列化逆向审计：返回体绝不泄露比分、主客方向或队名三字码', () => {
  const m = { id: 'm8', h: 'ARS', a: 'MCI', st: 'done', sc: '3-2' };
  const out = summarizeDrama(m, [
    { type: 'goal', side: 'h', clock: "11'", text: 'Bukayo Saka' },
    { type: 'goal', side: 'a', clock: "22'" },
    { type: 'goal', side: 'a', clock: "44'" },
    { type: 'goal', side: 'h', clock: "66'" },
    { type: 'goal', side: 'h', clock: "90+1'" }
  ]);
  const serialized = JSON.stringify(out);
  assert.equal(serialized.includes('3-2'), false);
  assert.equal(serialized.includes('ARS'), false);
  assert.equal(serialized.includes('MCI'), false);
  assert.equal(serialized.includes('Saka'), false);
  assert.equal(serialized.includes('"side"'), false);
});

console.log(`[test:drama] ${passed} passed`);
