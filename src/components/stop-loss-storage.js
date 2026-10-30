import { normalizeStopLossState } from '../core/stop-loss.js';

const KEY = 'nightowl:stopLoss:v1';

export function loadStopLossStates() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([night, state]) => [night, normalizeStopLossState(state)])
    );
  } catch {
    return {};
  }
}

export function saveStopLossStates(states) {
  try {
    localStorage.setItem(KEY, JSON.stringify(states));
  } catch {
    // 存储不可用时仅当前会话生效
  }
}
