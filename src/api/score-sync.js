/**
 * 比分同步请求层（唯一入口）
 *
 * 为什么需要单独一层：
 *   同步有两个调用方 —— App 的后台/自动同步（无 UI）与设置抽屉的手动同步（有反馈）。
 *   此前两处各自 `fetch('/api/scores/sync')` 并各自解析响应，口径已经分叉：
 *     · App 自己判 `summary.written.ok !== false`，没有走 `summarizeSyncResponse`；
 *     · SettingsDrawer 走 `summarizeSyncResponse`，但把 409（已有同步在跑）当成失败；
 *     · 只有 App 处理 409 后的等待逻辑。
 *   同一个「同步」动作在两处给出不同结论，是这类重复实现最典型的后果。
 *
 * 边界：本文件不碰 React、不碰 DOM，只做请求与结果归一；fetch 可注入，便于离线回归。
 * `src/core/` 保持纯函数，网络访问集中在本层。
 */

import { summarizeSyncResponse } from '../core/sync-outcome.js';

/** 服务端已有同步任务在跑（HTTP 409）。语义上不是失败，调用方应等待后再刷新。 */
export const SYNC_STATUS_BUSY = 'busy';

/**
 * 发起一次比分同步
 *
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl] 注入的 fetch（默认全局 fetch），离线测试用
 * @param {boolean} [opts.apply] 是否写盘（false = 预览）
 * @returns {Promise<{ok:boolean, status:string, text:string, payload:object|null, httpStatus:number}>}
 *   status ∈ updated / partial_failure / up_to_date / not_needed / failed / busy
 */
export async function requestScoreSync({ fetchImpl = globalThis.fetch, apply = true } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 'failed', text: '当前环境没有可用的网络请求能力', payload: null, httpStatus: 0 };
  }

  let res;
  try {
    res = await fetchImpl('/api/scores/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply })
    });
  } catch (err) {
    // 网络层失败：与「服务端回了失败」区分开，但都归入 failed 语义
    return {
      ok: false,
      status: 'failed',
      text: err?.message || '无法连接本地服务',
      payload: null,
      httpStatus: 0
    };
  }

  // 409：后台完整保鲜可能持续几十秒（openfootball 兜底慢）。
  // 这是「正在同步」，不是「同步失败」—— 调用方据此决定等待还是报错。
  if (res.status === 409) {
    return {
      ok: true,
      status: SYNC_STATUS_BUSY,
      text: '已有同步任务在进行中',
      payload: null,
      httpStatus: 409
    };
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 'failed',
      text: payload?.error || `同步失败（HTTP ${res.status}）`,
      payload,
      httpStatus: res.status
    };
  }

  // 成功响应仍交给唯一的判据函数：HTTP 200 不等于写盘成功
  return { ...summarizeSyncResponse(payload), payload, httpStatus: res.status };
}
