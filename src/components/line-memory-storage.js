import { normalizeLineMemory } from '../core/line-memory.js';

const KEY = 'nightowl:lineMemory:v1';

/** 读取本机线路记忆（自动丢弃 7 天无数据的条目） */
export function loadLineMemory() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return normalizeLineMemory(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveLineMemory(memory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeLineMemory(memory)));
  } catch {
    // 存储不可用时本次会话仍可排序，只是不持久化
  }
}

/** 清除事件：设置里清空后，已挂载的播放舞台要立刻按默认顺序重排 */
export const LINE_MEMORY_CLEARED_EVENT = 'nightowl:line-memory-cleared';

/** 用户可清除本机线路经验（PRD FR-07：清除后恢复默认顺序） */
export function clearLineMemory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  try {
    window.dispatchEvent(new CustomEvent(LINE_MEMORY_CLEARED_EVENT));
  } catch {
    /* 非浏览器环境忽略 */
  }
  return {};
}
