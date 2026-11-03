/**
 * 晨间连续补看 · 游标状态机（纯函数，桌面 / 手机共用）
 *
 * 会话只持有两样东西：一个**固定快照**的 id 列表，和一个游标。
 *
 * 为什么不把「已看」的条目从会话里删掉：
 *   删了编号会跳（第 2/3 场 → 第 2/2 场），用户回头看「刚才那场」时列表已经变形。
 *   已看的呈现交给补看队列（唯一事实源），这里只回答「看到第几场、下一场是谁」。
 *
 * 为什么不在会话里存比赛对象：
 *   数据会热更新（比分同步 / 赛程改期），会话握着旧对象就会显示过期事实。
 *   存 id，渲染时再从 fixtures 取当前值 —— 与队列同一口径。
 */

/** 列表最多 10 条（与补看队列上限同源），这里只做去重与兜底，不负责截断 */
export function createDigestSession(ids, startId = null) {
  const list = Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && id) : [];
  const unique = [];
  for (const id of list) if (!unique.includes(id)) unique.push(id);
  if (!unique.length) return null;
  const at = startId ? unique.indexOf(startId) : -1;
  return { ids: unique, cursor: at >= 0 ? at : 0 };
}

/**
 * @param {object|null} session
 * @param {Set<string>|null} watched 已看集合（来自补看队列，用于统计与跳过）
 */
export function digestPosition(session, watched = null) {
  if (!session || !session.ids.length) {
    return { id: null, index: -1, total: 0, hasPrev: false, hasNext: false, watchedCount: 0, remaining: 0 };
  }
  const total = session.ids.length;
  const index = Math.min(Math.max(session.cursor, 0), total - 1);
  const count = watched && typeof watched.has === 'function'
    ? session.ids.filter(id => watched.has(id)).length
    : 0;
  return {
    id: session.ids[index],
    index,
    total,
    hasPrev: index > 0,
    hasNext: index < total - 1,
    watchedCount: count,
    remaining: total - count
  };
}

/**
 * 移动游标，两端夹住不越界。
 *
 * @param {object|null} session
 * @param {number} direction +1 下一场 / -1 上一场
 * @param {Set<string>|null} skip 这些 id 跳过 —— 「标记已看并看下一场」用它一次跨过已看项，
 *        连续补看时不会连着停在几条已经看过的比赛上
 */
export function stepDigest(session, direction, skip = null) {
  if (!session || !session.ids.length) return session;
  const dir = direction < 0 ? -1 : 1;
  const last = session.ids.length - 1;
  let next = session.cursor + dir;
  if (skip && typeof skip.has === 'function') {
    while (next >= 0 && next <= last && skip.has(session.ids[next])) next += dir;
  }
  if (next < 0) next = 0;
  if (next > last) next = last;
  return { ...session, cursor: next };
}
