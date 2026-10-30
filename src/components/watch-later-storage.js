import { normalizeQueue } from '../core/queue.js';

const KEY = 'nightowl:watchLater:v1';

export function loadWatchLater() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return normalizeQueue(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveWatchLater(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeQueue(items)));
  } catch {
    // 存储不可用时本次会话仍可使用，只是不持久化
  }
}
