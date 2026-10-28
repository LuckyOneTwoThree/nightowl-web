/**
 * 防剧透的唯一视图模型
 *
 * 比分可见性不是某一个页面的局部判断，而是「当前夜猫日 + 已完赛 + 未揭晓」的
 * 共享事实。此前的实现把这段判断复制到 WatchSheet、积分榜、球队页和比赛统计里，
 * 每漏一处就能从聚合数据（积分、净胜球、近况、赛季攻防）反推出赛果。
 *
 * 约定：
 *   · desktop 的 revealed 是 Set；mobile store 的 revealedIds 是对象；
 *   · 这里同时兼容 Set / Array / object，调用方不再各自写 has。
 *   · 只排除「当前夜猫日」已完赛但未揭晓的场次，避免把整季历史都隐藏掉；
 *     历史视图仍由各统计函数自己的 cutoffTs 控制。
 */

import { isFinished, nightOf, owlDay } from './engine.js';

export function hasRevealed(revealed, id) {
  if (!revealed || !id) return false;
  if (typeof revealed.has === 'function') return revealed.has(id);
  if (Array.isArray(revealed)) return revealed.includes(id);
  return !!revealed[id];
}

/** 比分是否允许显示：关掉防剧透，或该场已经揭晓 */
export function isScoreVisible(spoilerFree, revealed) {
  return !spoilerFree || !!revealed;
}

/** 直播比分只在允许显示时返回，供 WatchSheet 等入口复用；不改变调用方状态。 */
export function liveScoreForDisplay(score, spoilerFree, revealed) {
  return isScoreVisible(spoilerFree, revealed) ? score : null;
}

/**
 * 当前夜猫日、已完赛但尚未揭晓的场次 ID 集合。
 *
 * @param {Array} fixtures 全量赛程（必须走 getFixtures()）
 * @param {number} nowTs 当前时间
 * @param {boolean} spoilerFree 是否开启防剧透
 * @param {Set|Array|Object} revealed 已揭晓集合
 */
export function unrevealedTonightIds(fixtures, nowTs, spoilerFree, revealed) {
  const out = new Set();
  if (!spoilerFree) return out;
  const night = nightOf(nowTs);
  for (const m of fixtures || []) {
    if (!m || !m.id || !m.sc) continue;
    if (!isFinished(m)) continue;
    if (owlDay(m.t) !== night) continue;
    if (hasRevealed(revealed, m.id)) continue;
    out.add(m.id);
  }
  return out;
}
