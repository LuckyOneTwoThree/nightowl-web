/**
 * 桌面端「已揭晓比分场次」本地持久化（localStorage：nightowl_revealed_v1）
 * 上限保留最近 500 场，避免长期使用无限膨胀。
 */
const KEY = 'nightowl_revealed_v1';
const MAX_REVEALED = 500;

export function loadRevealed() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter(x => typeof x === 'string' && x).slice(-MAX_REVEALED));
  } catch {
    return new Set();
  }
}

export function saveRevealed(setOrList) {
  const arr = [...(setOrList || [])].filter(x => typeof x === 'string' && x).slice(-MAX_REVEALED);
  try {
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {
    /* 隐私/无痕兜底 */
  }
  return new Set(arr);
}
