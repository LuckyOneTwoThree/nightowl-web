/**
 * 跨端同步时钟容差（桌面 / 手机共用纯逻辑）
 *
 * 限制外部/远端时间戳允许超前本机时钟的最大幅度（5 分钟），
 * 防止对方设备时间调错或恶意数据包用未来时间戳永久锁死 LWW 合并或队列 TTL。
 */
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function clampTimestamp(rawTs, nowTs = Date.now(), fallback = nowTs) {
  const n = Number(rawTs);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, nowTs + MAX_FUTURE_CLOCK_SKEW_MS);
}
