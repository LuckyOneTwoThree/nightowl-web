import { pruneWeekOverridesMap } from '../core/week-overrides.js';

const KEY = 'owl:week-overrides:v1';

export function loadWeekOverrides() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return pruneWeekOverridesMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveWeekOverrides(map, minWeekStartStr = null) {
  const clean = pruneWeekOverridesMap(map, minWeekStartStr);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // 存储不可用时仅在内存保留
  }
  return clean;
}
