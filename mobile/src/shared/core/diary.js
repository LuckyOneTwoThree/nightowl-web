/**
 * 观赛情绪印章与「我的熬夜赛季账单」核心计算（桌面 / 手机共用纯函数）
 *
 * 持久化结构 nightowl_diary_v1：
 *   { version: 1, entries: { [matchId]: { matchId, mode, stamp, note, recordedAt, updatedAt } } }
 *
 * 隐私与防剧透守则：
 *   - 全部状态仅存本地；
 *   - spoilerFree=true 且尚未揭示的补看/半场场次，绝不在账单里泄露赛果胜负或总进球数！
 */

import { parseMin, tierOf } from './engine.js';
import { clampTimestamp } from './sync-clock.js';

export const DIARY_VERSION = 1;
export const DIARY_MAX_ENTRIES = 500;
export const DIARY_NOTE_MAX_LEN = 60;

export const WATCH_MODES = Object.freeze(['live', 'second_half', 'replay']);
export const DIARY_STAMPS = Object.freeze(['epic', 'heartbreak', 'sleepy', 'disaster']);

export const MODE_META = Object.freeze({
  live: { id: 'live', label: '全程直播', shortLabel: '直播' },
  second_half: { id: 'second_half', label: '下半场切入', shortLabel: '下半场' },
  replay: { id: 'replay', label: '晨间补看', shortLabel: '补看' }
});

export const STAMP_META = Object.freeze({
  epic: { id: 'epic', label: '神仙名局', glyph: '★', tone: 'gold' },
  heartbreak: { id: 'heartbreak', label: '意难平', glyph: '◐', tone: 'teal' },
  sleepy: { id: 'sleepy', label: '催眠闷战', glyph: '◔', tone: 'muted' },
  disaster: { id: 'disaster', label: '血压拉满', glyph: '!', tone: 'danger' }
});

const MODE_SET = new Set(WATCH_MODES);
const STAMP_SET = new Set(DIARY_STAMPS);

function cleanNote(note) {
  if (typeof note !== 'string') return '';
  return note.trim().slice(0, DIARY_NOTE_MAX_LEN);
}

function normalizeEntry(matchId, raw, fallbackNow = 0, nowTs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.matchId === 'string' && raw.matchId ? raw.matchId : matchId;
  if (!id || typeof id !== 'string') return null;
  const mode = MODE_SET.has(raw.mode) ? raw.mode : 'live';
  const stamp = STAMP_SET.has(raw.stamp) ? raw.stamp : null;
  if (!stamp) return null;
  const recordedAt = clampTimestamp(raw.recordedAt, nowTs, fallbackNow);
  const updatedAt = clampTimestamp(raw.updatedAt, nowTs, recordedAt);
  return {
    matchId: id,
    mode,
    stamp,
    note: cleanNote(raw.note),
    recordedAt,
    updatedAt
  };
}

function trimToMaxEntries(entriesObj) {
  const keys = Object.keys(entriesObj);
  if (keys.length <= DIARY_MAX_ENTRIES) return entriesObj;
  const sorted = keys
    .map(k => entriesObj[k])
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, DIARY_MAX_ENTRIES);
  const next = {};
  for (const e of sorted) next[e.matchId] = e;
  return next;
}

function sanitizeDeletedMap(rawDeleted, entries, nowTs = Date.now()) {
  if (!rawDeleted || typeof rawDeleted !== 'object' || Array.isArray(rawDeleted)) return {};
  const pairs = [];
  for (const [k, tsVal] of Object.entries(rawDeleted)) {
    if (typeof k !== 'string' || !k) continue;
    const rawNum = Number(tsVal);
    if (!Number.isFinite(rawNum) || rawNum <= 0) continue;
    const t = clampTimestamp(rawNum, nowTs, 0);
    if (t <= 0) continue;
    if (entries[k] && (entries[k].updatedAt || 0) > t) continue;
    pairs.push([k, t]);
  }
  pairs.sort((a, b) => b[1] - a[1]);
  const out = {};
  for (const [k, t] of pairs.slice(0, DIARY_MAX_ENTRIES)) out[k] = t;
  return out;
}

/**
 * 规范化 diary 对象
 * @param {any} raw
 * @param {number} [nowTs]
 */
export function normalizeDiary(raw, nowTs = Date.now()) {
  const rawEntries =
    raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object'
      ? raw.entries
      : raw && typeof raw === 'object' && !Array.isArray(raw) && !('version' in raw)
        ? raw
        : {};
  const entries = {};
  for (const [k, val] of Object.entries(rawEntries)) {
    const clean = normalizeEntry(k, val, 0, nowTs);
    if (clean) entries[clean.matchId] = clean;
  }
  const trimmedEntries = trimToMaxEntries(entries);
  const deleted = sanitizeDeletedMap(raw?.deleted, trimmedEntries, nowTs);
  const out = {
    version: DIARY_VERSION,
    entries: trimmedEntries
  };
  if (Object.keys(deleted).length > 0) {
    out.deleted = deleted;
  }
  return out;
}

/**
 * 新增或更新一条观赛印章记录（纯函数，不修改原对象）
 */
export function upsertDiaryEntry(diary, patch, nowTs = Date.now()) {
  const base = normalizeDiary(diary, nowTs);
  if (!patch || !patch.matchId || typeof patch.matchId !== 'string') return base;
  const prev = base.entries[patch.matchId];
  const stamp = STAMP_SET.has(patch.stamp) ? patch.stamp : prev?.stamp || 'epic';
  const mode = MODE_SET.has(patch.mode) ? patch.mode : prev?.mode || 'live';
  const note = patch.note !== undefined ? cleanNote(patch.note) : prev?.note || '';
  const recordedAt = prev?.recordedAt && Number.isFinite(prev.recordedAt) ? prev.recordedAt : nowTs;
  const updatedAt = clampTimestamp(patch.updatedAt, nowTs, nowTs);

  const entries = {
    ...base.entries,
    [patch.matchId]: {
      matchId: patch.matchId,
      mode,
      stamp,
      note,
      recordedAt,
      updatedAt
    }
  };
  const nextDeleted = base.deleted ? { ...base.deleted } : {};
  delete nextDeleted[patch.matchId];
  const out = {
    version: DIARY_VERSION,
    entries: trimToMaxEntries(entries)
  };
  if (Object.keys(nextDeleted).length > 0) {
    out.deleted = nextDeleted;
  }
  return out;
}

/**
 * 移除指定场次的印章记录（写入删除墓碑以防局域网同步误恢复）
 */
export function removeDiaryEntry(diary, matchId, nowTs = Date.now()) {
  const base = normalizeDiary(diary, nowTs);
  if (!matchId || typeof matchId !== 'string') return base;
  const hadEntry = matchId in base.entries;
  const entries = { ...base.entries };
  if (hadEntry) delete entries[matchId];
  const deleted = { ...(base.deleted || {}) };
  const prevDel = deleted[matchId] || 0;
  const delTs = clampTimestamp(Math.max(prevDel, nowTs), nowTs, prevDel);
  if (hadEntry || delTs > 0) {
    deleted[matchId] = delTs;
  }
  return normalizeDiary(
    {
      version: DIARY_VERSION,
      entries,
      deleted
    },
    nowTs
  );
}

function parseMatchScore(sc) {
  if (Array.isArray(sc) && sc.length === 2) {
    const hg = Number(sc[0]);
    const ag = Number(sc[1]);
    if (Number.isInteger(hg) && Number.isInteger(ag) && hg >= 0 && ag >= 0) {
      return [hg, ag];
    }
    return null;
  }
  if (typeof sc === 'string') {
    const matched = sc.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!matched) return null;
    return [Number(matched[1]), Number(matched[2])];
  }
  return null;
}

function resolvePersona(safeSummary, outcomeSummary) {
  const total = safeSummary.totalWatched;
  if (total === 0) {
    return {
      code: 'ROOKIE_OWL',
      title: '待醒夜猫',
      detail: '尚未盖下本赛季第一枚观赛印章，今晚从一场好球开始。'
    };
  }

  const secondHalfRatio = safeSummary.byMode.second_half / total;
  const replayRatio = safeSummary.byMode.replay / total;
  const lateRatio = safeSummary.lateNightCount / total;
  const epicRatio = safeSummary.byStamp.epic / total;

  if (secondHalfRatio >= 0.45 && total >= 3) {
    return {
      code: 'SECOND_HALF_ACTUARY',
      title: '下半场精算师',
      detail: '深谙先睡后看之道，用最少的黑眼圈换取最多的关键阶段。'
    };
  }
  if (replayRatio >= 0.5 && total >= 3) {
    return {
      code: 'SPOILER_FREE_MORNING',
      title: '防剧透晨间集锦党',
      detail: '睡眠优先级至上，清晨零剧透打开心电图一样能品味戏剧张力。'
    };
  }
  if (safeSummary.lateNightCount >= 4 || (lateRatio >= 0.6 && total >= 2)) {
    return {
      code: 'DAWN_SENTINEL',
      title: '04:00 守夜铁军',
      detail: 'S3/S4 重度凌晨档常驻陪看人，夜猫档位表上的资深硬汉。'
    };
  }
  if (epicRatio >= 0.5 && outcomeSummary.worthItCount >= 2) {
    return {
      code: 'NOCTURNAL_CONNOISSEUR',
      title: '深夜名局捕手',
      detail: '选场眼光毒辣，专挑高赔率戏剧名局守到终场哨响。'
    };
  }
  return {
    code: 'STEADY_OWL',
    title: '克制系理性夜猫',
    detail: '按自己的节奏挑选值得熬的夜晚，不被赛程密度牵着走。'
  };
}

/**
 * 构建「我的熬夜赛季账单」
 *
 * @param {object} diaryOrEntries nightowl_diary_v1 对象或 entries 映射
 * @param {Array<object>} fixtures 全量赛程
 * @param {{spoilerFree?: boolean, followedTeams?: string[]}} [prefs]
 * @param {string[]|Set<string>} [revealedIds]
 */
export function buildSeasonReport(diaryOrEntries, fixtures = [], prefs = {}, revealedIds = []) {
  const diary = normalizeDiary(diaryOrEntries);
  const entryList = Object.values(diary.entries).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const matchById = new Map();
  for (const f of fixtures || []) {
    if (f?.id) matchById.set(f.id, f);
  }

  const spoilerFree = Boolean(prefs?.spoilerFree);
  const revealedSet = revealedIds instanceof Set ? revealedIds : new Set(revealedIds || []);
  const followedSet = new Set(Array.isArray(prefs?.followedTeams) ? prefs.followedTeams : []);

  const byMode = { live: 0, second_half: 0, replay: 0 };
  const byStamp = { epic: 0, heartbreak: 0, sleepy: 0, disaster: 0 };
  const hourBuckets = new Array(24).fill(0);
  let lateNightCount = 0;

  let inspectedCount = 0;
  let maskedBySpoilerCount = 0;
  let worthItCount = 0;
  let dullDrawCount = 0;

  const teamMap = new Map();
  const ensureTeam = teamId => {
    if (!teamMap.has(teamId)) {
      teamMap.set(teamId, { teamId, watched: 0, w: 0, d: 0, l: 0, decided: 0, winRate: null });
    }
    return teamMap.get(teamId);
  };

  for (const entry of entryList) {
    byMode[entry.mode] = (byMode[entry.mode] || 0) + 1;
    byStamp[entry.stamp] = (byStamp[entry.stamp] || 0) + 1;

    const m = matchById.get(entry.matchId);
    if (!m) continue;

    if (!m.tbd && typeof m.t === 'string') {
      const tier = tierOf(m);
      if (tier.label === 'S3' || tier.label === 'S4') lateNightCount += 1;
      const min = parseMin(m.t);
      if (Number.isFinite(min)) {
        const hh = Math.floor(min / 60) % 24;
        hourBuckets[hh] += 1;
      }
    }

    // 主队陪看场次计数（不含比分胜负，无剧透风险）
    for (const sideId of [m.h, m.a]) {
      if (followedSet.has(sideId)) {
        ensureTeam(sideId).watched += 1;
      }
    }

    const canInspectScore = !spoilerFree || revealedSet.has(entry.matchId) || entry.mode === 'live';
    const parsedScore = m.st === 'done' ? parseMatchScore(m.sc) : null;

    if (!canInspectScore) {
      maskedBySpoilerCount += 1;
      continue;
    }
    if (!parsedScore) continue;

    inspectedCount += 1;
    const [hg, ag] = parsedScore;
    const totalGoals = hg + ag;
    const diff = Math.abs(hg - ag);

    if (totalGoals >= 3 || (diff <= 1 && totalGoals >= 2)) {
      worthItCount += 1;
    } else if (totalGoals === 0) {
      dullDrawCount += 1;
    }

    for (const sideId of [m.h, m.a]) {
      if (!followedSet.has(sideId)) continue;
      const rec = ensureTeam(sideId);
      const isHome = sideId === m.h;
      const own = isHome ? hg : ag;
      const opp = isHome ? ag : hg;
      rec.decided += 1;
      if (own > opp) rec.w += 1;
      else if (own === opp) rec.d += 1;
      else rec.l += 1;
      rec.winRate = Math.round((rec.w / rec.decided) * 100);
    }
  }

  const safeSummary = {
    totalWatched: entryList.length,
    byMode,
    byStamp,
    lateNightCount,
    hourBuckets
  };

  const outcomeSummary = {
    inspectedCount,
    maskedBySpoilerCount,
    worthItCount,
    dullDrawCount,
    worthItRate: inspectedCount > 0 ? Math.round((worthItCount / inspectedCount) * 100) : null
  };

  const teamRecords = [...teamMap.values()].sort((a, b) => b.watched - a.watched || a.teamId.localeCompare(b.teamId));

  return {
    version: DIARY_VERSION,
    totalEntries: entryList.length,
    safeSummary,
    outcomeSummary,
    teamRecords,
    persona: resolvePersona(safeSummary, outcomeSummary),
    recentEntries: entryList.slice(0, 12)
  };
}
