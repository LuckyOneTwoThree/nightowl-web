/**
 * 桌面轻提示。
 *
 * 项目里此前没有任何全局提示：外链打不开是静默的（`window.desktop.openExternal` 的返回值
 * 没人看），复制成功也没有回执。提示必须有「成功 / 失败 / 信息」三档，
 * 失败要能挂恢复动作 —— 否则「打不开」就只是一句句号。
 *
 * 用模块级订阅而不是 Context：调用点常常在事件处理函数、甚至非组件模块里
 * （`lib/openExternal.js`），把它们都塞进 Provider 只会让调用链变长。
 */

const listeners = new Set();
let current = null;
let seq = 0;
let timer = null;

function emit() {
  for (const listener of listeners) listener();
}

/** 错误停留更久：成功扫一眼就够，失败要读完还能点到按钮 */
const TTL = { success: 3200, info: 3200, error: 6000 };

export function pushToast({ kind = 'info', message, actions = [], ttl }) {
  current = { id: (seq += 1), kind, message, actions };
  clearTimeout(timer);
  timer = setTimeout(() => dismissToast(current?.id), ttl ?? TTL[kind] ?? 3200);
  emit();
  return current.id;
}

export function dismissToast(id) {
  if (id && current && current.id !== id) return;
  clearTimeout(timer);
  timer = null;
  current = null;
  emit();
}

export function subscribeToast(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToast() {
  return current;
}

export const toast = {
  success: message => pushToast({ kind: 'success', message }),
  info: message => pushToast({ kind: 'info', message }),
  error: (message, actions = []) => pushToast({ kind: 'error', message, actions })
};
