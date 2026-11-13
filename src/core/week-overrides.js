/**
 * 周计划手动微调状态（固定、跳过、禁看夜）
 *
 * 纯函数模型，供桌面与移动端共用。
 */

export const EMPTY_WEEK_OVERRIDES = Object.freeze({
  pinnedIds: [],
  excludedIds: [],
  blockedNights: [],
});

function uniqStrings(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (typeof x !== 'string') continue;
    const s = x.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function normalizeWeekOverrides(raw) {
  if (!raw || typeof raw !== 'object') {
    return { pinnedIds: [], excludedIds: [], blockedNights: [] };
  }
  const pinnedIds = uniqStrings(raw.pinnedIds);
  const pinnedSet = new Set(pinnedIds);
  const excludedIds = uniqStrings(raw.excludedIds).filter(id => !pinnedSet.has(id));
  const blockedNights = uniqStrings(raw.blockedNights).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return { pinnedIds, excludedIds, blockedNights };
}

export function hasAnyWeekOverride(ov) {
  const n = normalizeWeekOverrides(ov);
  return n.pinnedIds.length > 0 || n.excludedIds.length > 0 || n.blockedNights.length > 0;
}

export function togglePinnedMatch(ov, matchId) {
  const cur = normalizeWeekOverrides(ov);
  if (!matchId) return cur;
  const id = String(matchId).trim();
  if (!id) return cur;
  const has = cur.pinnedIds.includes(id);
  if (has) {
    return {
      ...cur,
      pinnedIds: cur.pinnedIds.filter(x => x !== id),
    };
  }
  return {
    ...cur,
    pinnedIds: [...cur.pinnedIds, id],
    excludedIds: cur.excludedIds.filter(x => x !== id),
  };
}

export function toggleExcludedMatch(ov, matchId) {
  const cur = normalizeWeekOverrides(ov);
  if (!matchId) return cur;
  const id = String(matchId).trim();
  if (!id) return cur;
  const has = cur.excludedIds.includes(id);
  if (has) {
    return {
      ...cur,
      excludedIds: cur.excludedIds.filter(x => x !== id),
    };
  }
  return {
    ...cur,
    pinnedIds: cur.pinnedIds.filter(x => x !== id),
    excludedIds: [...cur.excludedIds, id],
  };
}

export function toggleBlockedNight(ov, nightStr) {
  const cur = normalizeWeekOverrides(ov);
  if (!nightStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(nightStr))) return cur;
  const d = String(nightStr);
  const has = cur.blockedNights.includes(d);
  return {
    ...cur,
    blockedNights: has
      ? cur.blockedNights.filter(x => x !== d)
      : [...cur.blockedNights, d].sort(),
  };
}

export function pruneWeekOverridesMap(map, minWeekStartStr = null) {
  if (!map || typeof map !== 'object') return {};
  const out = {};
  for (const [wk, raw] of Object.entries(map)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wk)) continue;
    if (minWeekStartStr && wk < minWeekStartStr) continue;
    const norm = normalizeWeekOverrides(raw);
    if (hasAnyWeekOverride(norm)) out[wk] = norm;
  }
  return out;
}
