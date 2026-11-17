import assert from 'node:assert/strict';
import { buildSyncBundle, mergeSyncBundles } from '../src/core/sync-bundle.js';

// 桌面 storage 适配层回归：Number(null) === 0 曾把「从未记录」读成 epoch 0，
// 在 LWW 合并里击败对端未知一侧，丢掉双未知本应的并集（全新安装/升级即触发）。
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const {
  loadWeekOverridesUpdatedAt,
  saveWeekOverridesUpdatedAt,
  saveWeekUpdatedAt
} = await import('../src/components/week-overrides-storage.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}

check('缺失 key 读成 null 而非 0', () => {
  store.clear();
  assert.equal(loadWeekOverridesUpdatedAt(), null);
});

check('save(null/undefined/0) 清除 key 而非写入 "0"', () => {
  store.clear();
  assert.equal(saveWeekOverridesUpdatedAt(null), null);
  assert.equal(store.has('owl:week-overrides-global-ts:v1'), false);
  assert.equal(saveWeekOverridesUpdatedAt(undefined), null);
  assert.equal(saveWeekOverridesUpdatedAt(0), null);
  assert.equal(store.has('owl:week-overrides-global-ts:v1'), false);
});

check('正常时间戳往返；损坏值读成 null', () => {
  assert.equal(saveWeekOverridesUpdatedAt(1_795_000_000_000), 1_795_000_000_000);
  assert.equal(loadWeekOverridesUpdatedAt(), 1_795_000_000_000);
  store.set('owl:week-overrides-global-ts:v1', 'abc');
  assert.equal(loadWeekOverridesUpdatedAt(), null);
});

check('逐周时间戳 0 被过滤（0 不是真实编辑时刻）', () => {
  const out = saveWeekUpdatedAt({ '2026-11-09': 0, '2026-11-16': 5000 });
  assert.deepEqual(out, { '2026-11-16': 5000 });
});

check('端到端：两端全新安装（storage 缺失）配对 → 双未知并集，不丢周计划', () => {
  store.clear();
  const wk = '2026-11-09';
  const now = 1_795_000_000_000;
  const ov = pins => ({ pinnedIds: pins, excludedIds: [], blockedNights: [] });
  // 模拟两端各自从 storage 读全局时间戳后构建 bundle
  const desktopBundle = buildSyncBundle(
    { weekOverridesUpdatedAt: loadWeekOverridesUpdatedAt(), weekOverridesByWeek: { [wk]: ov(['desktop-pin']) } },
    now
  );
  const mobileBundle = buildSyncBundle(
    { weekOverridesUpdatedAt: loadWeekOverridesUpdatedAt(), weekOverridesByWeek: { [wk]: ov(['mobile-pin']) } },
    now
  );
  assert.equal(desktopBundle.weekOverridesUpdatedAt, null);
  assert.equal(mobileBundle.weekOverridesUpdatedAt, null);
  const merged = mergeSyncBundles(desktopBundle, mobileBundle, now);
  assert.deepEqual(merged.weekOverridesByWeek[wk].pinnedIds.sort(), ['desktop-pin', 'mobile-pin']);
  assert.equal(merged.weekOverridesUpdatedAt, null);
  // 合并结果 null 回写 storage 后重启，仍必须是 null（不能被固化成 0）
  saveWeekOverridesUpdatedAt(merged.weekOverridesUpdatedAt);
  assert.equal(loadWeekOverridesUpdatedAt(), null);
});

console.log(`[test:week-overrides-storage] ${passed} passed`);