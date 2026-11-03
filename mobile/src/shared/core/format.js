/**
 * 展示格式化工具
 *
 * 时区口径（PRD §7.4）：数据时间是**北京墙钟、无时区后缀**（形如 `2026-08-16T01:30`）。
 * 因此所有"当前时间"都必须换算成北京墙钟再展示，不能用设备本地时间——
 * 否则设备在非 +8 时区时，界面上显示的"北京时间"是错的。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 时间戳 → 北京墙钟分量 */
export function bjParts(ts = Date.now()) {
  const b = new Date(ts + 8 * 3600000);
  return {
    y: b.getUTCFullYear(),
    m: b.getUTCMonth() + 1,
    d: b.getUTCDate(),
    hh: b.getUTCHours(),
    mm: b.getUTCMinutes(),
    ss: b.getUTCSeconds(),
    wd: b.getUTCDay()
  };
}

/** 北京墙钟时刻串 "02:45:18" */
export function bjClock(ts = Date.now(), withSeconds = true) {
  const p = bjParts(ts);
  const base = `${pad2(p.hh)}:${pad2(p.mm)}`;
  return withSeconds ? `${base}:${pad2(p.ss)}` : base;
}

/** 北京墙钟日期串 "2026-09-12" */
export function bjDate(ts = Date.now()) {
  const p = bjParts(ts);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** 墙钟日期串 → "周六" */
export function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "2026-08-16T01:30" → "01:30" */
export function hm(t) {
  return String(t || '').split('T')[1] || '--:--';
}

/** "2026-08-16T01:30" → "2026-08-16" */
export function datePart(t) {
  return String(t || '').split('T')[0];
}

/** 墙钟日期串 → "9月12日" */
export function zhDate(dateStr) {
  const [, m, d] = String(dateStr).split('-').map(Number);
  return `${m}月${d}日`;
}

/** 睡眠成本展示："3.5h" / "0h" */
export function hmCost(cost) {
  if (!cost) return '0h';
  return `${Number(cost).toFixed(1).replace(/\.0$/, '')}h`;
}

/**
 * 净胜球 / 净胜分：正数带 + 号（`+3` / `0` / `-2`）
 *
 * 情报面板（对方数据）与积分榜（净胜球列）此前各写了一份逐字相同的实现，
 * 两处口径必须一致 —— 同一个数字在两块界面显示成不同格式，用户会以为是两个指标。
 */
export function formatGoalDiff(value) {
  const v = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
  return v > 0 ? `+${v}` : `${v}`;
}

/**
 * 一天中的分钟数 → "HH:mm"（跨零点按 24 小时制回绕）
 *
 * 周时间轴内部用「20:00 = 1200、次日 06:30 = 1830」的连续分钟轴，
 * 因此展示时必须先 normalize，不能把 1500 直接交给只接受小时的格式化函数。
 */
export function formatMinuteOfDay(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return '--:--';
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

/** 秒数 → "00:14:32" */
export function hmsFromSeconds(total) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s % 60)}`;
}

/** 倒计时 → 人类可读："3 天 04:12" / "04:12:30" */
export function humanCountdown(cd) {
  if (!cd) return '--';
  if (cd.over) return '已开球';
  if (cd.d > 0) return `${cd.d} 天 ${pad2(cd.h)}:${pad2(cd.m)}`;
  return hmsFromSeconds(cd.h * 3600 + cd.m * 60 + cd.s);
}

/**
 * 倒计时 → 分钟精度："3 天 04:12" / "04:12"
 *
 * 左栏摘要用这个格式：它每 30 秒才随 App 时钟重算，显示秒会与
 * 播放器内部的秒级倒计时出现肉眼可见的秒差（同一场比赛两个数字）。
 */
export function humanCountdownShort(cd) {
  if (!cd) return '--';
  if (cd.over) return '已开球';
  const hh = pad2(cd.h);
  const mm = pad2(cd.m);
  return cd.d > 0 ? `${cd.d} 天 ${hh}:${mm}` : `${hh}:${mm}`;
}

/** 比赛进行分钟（从开球时间推导） */
export function liveMinute(kickTs, nowTs) {
  const diff = nowTs - kickTs;
  if (diff <= 0) return 0;
  // 上半场 45' + 中场 15' + 下半场；超过 90 分钟后显示补时区间
  const raw = Math.floor(diff / 60000);
  if (raw <= 45) return raw;
  if (raw <= 60) return 45;
  return Math.min(90, raw - 15);
}
