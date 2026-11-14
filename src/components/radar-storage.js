/**
 * 下半场切入策略 & 无剧透悬念唤醒雷达本地状态（localStorage）
 */
import { RADAR_MAX_WATCHED, RADAR_VERDICT } from '../core/radar.js';

const KEY = 'nightowl_radar_v1';
const VERDICT_SET = new Set(Object.values(RADAR_VERDICT));

export function defaultRadarState() {
  return {
    enabled: true,
    cutInIds: [],
    watchIds: [],
    firedKeys: [],
    verdicts: {}
  };
}

export function normalizeRadarState(raw) {
  if (!raw || typeof raw !== 'object') return defaultRadarState();
  const cutInIds = Array.isArray(raw.cutInIds)
    ? [...new Set(raw.cutInIds.filter(id => typeof id === 'string' && id))]
    : [];
  const watchIds = Array.isArray(raw.watchIds)
    ? [...new Set(raw.watchIds.filter(id => typeof id === 'string' && id))].slice(0, RADAR_MAX_WATCHED)
    : [];
  const firedKeys = Array.isArray(raw.firedKeys)
    ? [...new Set(raw.firedKeys.filter(k => typeof k === 'string' && k))].slice(-200)
    : [];
  const verdicts = {};
  if (raw.verdicts && typeof raw.verdicts === 'object') {
    for (const [id, v] of Object.entries(raw.verdicts)) {
      if (!v || !VERDICT_SET.has(v.verdict)) continue;
      verdicts[id] = {
        verdict: v.verdict,
        minuteLabel: typeof v.minuteLabel === 'string' ? v.minuteLabel : null,
        updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : 0
      };
    }
  }
  return {
    enabled: raw.enabled !== false,
    cutInIds,
    watchIds,
    firedKeys,
    verdicts
  };
}

export function loadRadarState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultRadarState();
    return normalizeRadarState(JSON.parse(raw));
  } catch {
    return defaultRadarState();
  }
}

export function saveRadarState(state) {
  const clean = normalizeRadarState(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* 容错 */
  }
  return clean;
}

export function toggleCutInId(prev, matchId) {
  const base = normalizeRadarState(prev);
  if (!matchId) return { ok: false, state: base };
  const exists = base.cutInIds.includes(matchId);
  const next = saveRadarState({
    ...base,
    cutInIds: exists ? base.cutInIds.filter(x => x !== matchId) : [...base.cutInIds, matchId]
  });
  return { ok: true, added: !exists, state: next };
}

export function toggleWatchRadarId(prev, matchId) {
  const base = normalizeRadarState(prev);
  if (!matchId) return { ok: false, reason: 'invalid', state: base };
  if (base.watchIds.includes(matchId)) {
    const next = saveRadarState({
      ...base,
      watchIds: base.watchIds.filter(x => x !== matchId)
    });
    return { ok: true, added: false, state: next };
  }
  if (base.watchIds.length >= RADAR_MAX_WATCHED) {
    return { ok: false, reason: 'limit', state: base };
  }
  const next = saveRadarState({
    ...base,
    watchIds: [...base.watchIds, matchId]
  });
  return { ok: true, added: true, state: next };
}
