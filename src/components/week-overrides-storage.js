import { pruneWeekOverridesMap } from '../core/week-overrides.js';

const KEY = 'owl:week-overrides:v1';
const TS_KEY = 'owl:week-overrides-ts:v1';

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

export function loadWeekUpdatedAt() {
  try {
    const raw = localStorage.getItem(TS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(Number(v))) {
        out[k] = Number(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveWeekUpdatedAt(map, minWeekStartStr = null) {
  const out = {};
  if (map && typeof map === 'object') {
    for (const [k, v] of Object.entries(map)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      if (minWeekStartStr && k < minWeekStartStr) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
  }
  try {
    localStorage.setItem(TS_KEY, JSON.stringify(out));
  } catch {
    /* 容错 */
  }
  return out;
}
