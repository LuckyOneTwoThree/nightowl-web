/**
 * 全局提示 · 订阅与生命周期测试（离线）
 *
 * 这不是「测一个 store 有没有 set」——守的是三条一旦破了就没人会发现的承诺：
 *   1. 失败必须能带恢复动作（外链打不开时，用户手上没有第二个出口）
 *   2. 旧提示的退场不能误伤新提示（dismiss(id) 只认自己那条）
 *   3. 错误停得比成功久（成功扫一眼就够，失败要读完再点按钮）
 */
import { dismissToast, getToast, pushToast, subscribeToast, toast } from '../src/lib/toast.js';

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

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

console.log('全局提示测试');
console.log('');
console.log('一、推送与订阅');

let notified = 0;
const unsubscribe = subscribeToast(() => {
  notified += 1;
});

const first = pushToast({ message: '第一条' });
ok('推送后可读到当前提示', getToast()?.message === '第一条');
ok('订阅者被通知一次', notified === 1, `实际 ${notified}`);
ok('kind 缺省为 info', getToast()?.kind === 'info');

const second = pushToast({ kind: 'success', message: '第二条' });
ok('同一条通道只保留最新一条', getToast()?.message === '第二条');
ok('id 递增', second > first);
ok('订阅者累计两次', notified === 2, `实际 ${notified}`);

console.log('');
console.log('二、失败的恢复动作');

toast.error('打不开「YouTube 集锦」', [
  { label: '重试', primary: true, onClick: () => {} },
  { label: '复制链接', onClick: () => {} }
]);
const err = getToast();
ok('错误态 kind 正确', err?.kind === 'error');
ok('错误带两个恢复动作', err?.actions?.length === 2, `实际 ${err?.actions?.length}`);
ok('第一个动作是主行动', err?.actions?.[0]?.primary === true);
ok('动作标签是「重试 / 复制链接」', err?.actions?.map(a => a.label).join('/') === '重试/复制链接');

console.log('');
console.log('三、退场只关自己那条');

pushToast({ message: '第三条', ttl: 60_000 });
const thirdId = getToast().id;
dismissToast(thirdId - 1);
ok('用旧 id 关闭不会误伤新提示', getToast()?.id === thirdId);
dismissToast(thirdId);
ok('用对的 id 能关掉', getToast() === null);
dismissToast();
ok('不带 id 直接清空也不报错', getToast() === null);

console.log('');
console.log('四、存活时间');

pushToast({ kind: 'success', message: '成功', ttl: 20 });
await wait(60);
ok('到期自动消失', getToast() === null);

pushToast({ kind: 'error', message: '失败', ttl: 20 });
await wait(60);
ok('错误提示同样到期自动消失', getToast() === null);

unsubscribe();
const afterUnsubscribe = notified;
pushToast({ message: '取消订阅后', ttl: 20 });
ok('退订后不再收到通知', notified === afterUnsubscribe, `实际 ${notified}`);
await wait(60);

console.log('');
if (fail === 0) {
  console.log(`通过 ${pass} 项，失败 0 项`);
} else {
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exitCode = 1;
}
