/**
 * 「明早补看」队列 · 桌面 / 手机共用纯函数
 *
 * 只保存比赛 ID、所属夜晚、加入时间与状态；不保存比分，避免本地缓存绕过防剧透。
 * 队列最多 10 条、保留 7 天；重复加入幂等；已看/移除后不再出现在待看列表。
 */

import { owlDay } from './engine.js';

export const WATCH_LATER_LIMIT = 10;
export const WATCH_LATER_TTL_MS = 7 * 24 * 3600000;

export const WATCH_LATER_STATUS = Object.freeze({
  PENDING: 'pending',
  WATCHED: 'watched'
});

function isItem(value) {
  return (
    value &&
    typeof value.id === 'string' &&
    value.id &&
    Number.isFinite(value.addedAt) &&
    (value.status === WATCH_LATER_STATUS.PENDING || value.status === WATCH_LATER_STATUS.WATCHED)
  );
}

export function normalizeQueue(items, now = Date.now()) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!isItem(item)) continue;
    if (now - item.addedAt > WATCH_LATER_TTL_MS) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      night: typeof item.night === 'string' ? item.night : '',
      addedAt: item.addedAt,
      status: item.status
    });
    if (out.length >= WATCH_LATER_LIMIT) break;
  }
  return out;
}

/** 加入队列；重复加入幂等，满 10 条返回 full，不静默丢弃旧条目 */
export function addToQueue(items, match, now = Date.now()) {
  const queue = normalizeQueue(items, now);
  if (!match?.id) {
    return { ok: false, reason: 'invalid-match', queue, added: false };
  }
  if (queue.some(item => item.id === match.id)) {
    return { ok: true, reason: 'exists', queue, added: false };
  }
  const pendingCount = queue.filter(item => item.status === WATCH_LATER_STATUS.PENDING).length;
  if (pendingCount >= WATCH_LATER_LIMIT) {
    return { ok: false, reason: 'full', queue, added: false };
  }
  // 已看条目留给后续摘要，但不能永久占住新条目的名额；队列满时先淘汰最旧的已看项。
  let base = queue;
  if (base.length >= WATCH_LATER_LIMIT) {
    const oldestWatched = base
      .filter(item => item.status === WATCH_LATER_STATUS.WATCHED)
      .sort((a, b) => a.addedAt - b.addedAt)[0];
    if (!oldestWatched) return { ok: false, reason: 'full', queue, added: false };
    base = base.filter(item => item.id !== oldestWatched.id);
  }
  const night =
    typeof match.t === 'string' && match.t.includes('T') ? owlDay(match.t) : '';
  return {
    ok: true,
    reason: 'added',
    added: true,
    queue: [
      ...base,
      {
        id: match.id,
        night,
        addedAt: now,
        status: WATCH_LATER_STATUS.PENDING
      }
    ]
  };
}

export function removeFromQueue(items, id, now = Date.now()) {
  return normalizeQueue(items, now).filter(item => item.id !== id);
}

export function markQueueWatched(items, id, now = Date.now()) {
  return normalizeQueue(items, now).map(item =>
    item.id === id ? { ...item, status: WATCH_LATER_STATUS.WATCHED } : item
  );
}

export function pendingQueue(items, now = Date.now()) {
  return normalizeQueue(items, now)
    .filter(item => item.status === WATCH_LATER_STATUS.PENDING)
    .sort((a, b) => a.addedAt - b.addedAt);
}

/** 队列展示：匹配本地 fixtures，按加入时间排序；不返回比分 */
export function queueWithMatches(items, fixtures, now = Date.now()) {
  const map = new Map((fixtures || []).map(m => [m.id, m]));
  return pendingQueue(items, now).map(item => ({
    item,
    match: map.get(item.id) || null
  }));
}
