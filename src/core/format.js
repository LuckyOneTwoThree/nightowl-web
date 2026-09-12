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
