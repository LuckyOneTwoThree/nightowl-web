import { MATCH_DURATION_MS, ts } from './engine.js';

/**
 * 还能影响下一步决策的场次：未开赛、时间已定，且尚未过完赛时间。
 *
 * 直播中的场次也算 —— 它仍然占用接下来的睡眠时间；
 * 已过 `kick + 120min` 的「假 sched」不算 —— 它只是比分还没同步。
 */
export function isActionable(match, nowTs) {
  if (!match || match.st !== 'sched' || match.tbd) return false;
  const kick = ts(match.t);
  if (!Number.isFinite(kick)) return false;
  const now = Number.isFinite(nowTs) ? nowTs : Date.now();
  return now < kick + MATCH_DURATION_MS;
}
