/**
 * 净胜球格式化：正数带显式 + 号（0 与负数原样）。
 *
 * 收口原因：比赛详情与积分榜面板此前各写了一份一模一样的 `formatGd`，
 * 一旦要改（例如 0 也显示 0、或负数带括号）就会漏改一处，出现两处口径不一致。
 */
export function formatGd(gd: number): string {
  return gd > 0 ? `+${gd}` : `${gd}`;
}
