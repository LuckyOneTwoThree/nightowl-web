/**
 * 欧洲联赛本地墙钟 → 北京墙钟的时区换算
 *
 * 为什么需要：openfootball 给的 date/time 是**联赛所在地的当地墙钟、不带时区**
 * （如西甲 "2026-10-04 21:00" 是马德里时间）。直接当北京时间用会整体偏移 6~7 小时，
 * 于是 openfootball 一直被标为 kickoffTrusted: false，它的开球时间从未被采信。
 *
 * 本模块把当地墙钟按「联赛基础偏移 + 欧洲夏令时」换算成北京墙钟，
 * 让 openfootball 升级为可信时间源，从而能清除 tbd 占位（见 OPTIMIZATION-PLAN.md P1）。
 *
 * 口径：北京墙钟串 'YYYY-MM-DDTHH:mm'（与 fixtures / engine.ts() 一致）。
 */

/** 各联赛的时区：base = 冬令时 UTC 偏移，dst = 夏令时 UTC 偏移 */
const LEAGUE_TZ = {
  PL: { base: 0, dst: 1 }, // 英超：GMT / BST
  PD: { base: 1, dst: 2 }, // 西甲：CET / CEST
  SA: { base: 1, dst: 2 }, // 意甲：CET / CEST
  BL: { base: 1, dst: 2 }, // 德甲：CET / CEST
  FL: { base: 1, dst: 2 }  // 法甲：CET / CEST
};

const pad = n => String(n).padStart(2, '0');

/**
 * 某年某月的最后一个周日（UTC 日期）
 * @param {number} y 年
 * @param {number} m 月（1-12）
 * @returns {number} 该月最后周日的日期号
 */
function lastSunday(y, m) {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wd = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay(); // 0 = 周日
  return lastDay - wd;
}

/**
 * 欧洲夏令时判定（EU 规则：3 月最后一个周日开始，10 月最后一个周日结束）
 *
 * ⚠️ 转换时刻精确到 01:00 UTC，但足球开球基本在当地时间晚间，
 *    用「日期」判定对晚间赛事足够精确。唯一的理论误差是发生在
 *    转换当晚 01:00–03:00 本地之间的比赛——五大联赛没有这个时段的开球。
 *
 * @param {string} localDateStr 当地墙钟日期 'YYYY-MM-DD'
 * @returns {boolean} 是否处于夏令时
 */
export function isEuroDST(localDateStr) {
  const f = String(localDateStr || '').split('-');
  if (f.length < 3) return false;
  const y = Number(f[0]);
  const m = Number(f[1]);
  const d = Number(f[2]);
  if (!y || !m || !d) return false;

  const dstStart = lastSunday(y, 3);  // 3 月最后周日
  const dstEnd = lastSunday(y, 10);   // 10 月最后周日

  const value = m * 100 + d;
  return value >= 3 * 100 + dstStart && value < 10 * 100 + dstEnd;
}

/**
 * 联赛在某当地日期的 UTC 偏移（小时）
 * @returns {number|null} 偏移小时数；未知联赛返回 null
 */
export function utcOffsetHours(league, localDateStr) {
  const tz = LEAGUE_TZ[league];
  if (!tz) return null;
  return isEuroDST(localDateStr) ? tz.dst : tz.base;
}

/**
 * 当地墙钟 → 北京墙钟
 *
 * @param {string} localDateStr 'YYYY-MM-DD'（联赛所在地日期）
 * @param {string} localTimeStr 'HH:mm'（联赛所在地时间）；**缺失时返回 null**
 * @param {string} league 联赛码
 * @returns {string|null} 北京墙钟串 'YYYY-MM-DDTHH:mm'；无法换算返回 null
 *
 * ⚠️ 时间缺失时绝不默认 00:00：openfootball 对未公布时间的场次只给 date、不给 time
 *    （实测德甲 261/306 场如此）。默认成 00:00 会凭空造出「06:00 北京时间」的假时刻，
 *    若再被标为可信时间源，会覆盖真实时间并清掉 tbd —— 占位值伪装成真实值，
 *    比不更新危险得多。缺时间就返回 null，交给上层保持 tbd。
 */
export function localToBeijingWall(localDateStr, localTimeStr, league) {
  const f = String(localDateStr || '').split('-');
  if (f.length < 3) return null;
  const y = Number(f[0]);
  const m = Number(f[1]);
  const d = Number(f[2]);

  if (!localTimeStr || !/^\d{1,2}:\d{2}/.test(String(localTimeStr))) return null;
  const hm = String(localTimeStr).slice(0, 5).split(':');
  const hh = Number(hm[0]);
  const mm = Number(hm[1]);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const off = utcOffsetHours(league, localDateStr);
  if (off == null) return null;

  // 当地墙钟 → UTC 时间戳 → 北京墙钟分量（纯 UTC 算术，禁止本地时区介入）
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - off * 3600000;
  const b = new Date(utcMs + 8 * 3600000);
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}T${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`;
}
