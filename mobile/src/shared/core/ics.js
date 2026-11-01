/**
 * 日历导出（ICS / RFC 5545）· 纯函数
 *
 * 产品口径（PRD FR-09）：
 *   · 只导出「未来、未开赛、时间确定」的场次：tbd 不导出，已开赛/已结束不导出
 *   · 标题 = 联赛 + 双方队名；描述 = 轮次 + 来源；**不含比分与指数**（防剧透是全局规则）
 *   · 时间按北京时间并带 Asia/Shanghai 时区；提醒可选开球前 15 / 30 分钟
 *   · 导出为空时必须明确报错，不生成空文件
 *
 * 为什么用 TZID + VTIMEZONE 而不是写成 UTC：
 *   UTC 也能被正确换算，但用户在日历里看到的是「UTC 19:30 的场次」这类元数据，
 *   排障与手动核对都别扭。带 TZID 的墙钟时间与产品里「北京时间」的口径一致，
 *   同时因为中国自 1991 年起无夏令时，VTIMEZONE 可以写死 +0800，不需要切换规则。
 */

import { MATCH_DURATION_MS, ts } from './engine.js';
import { teamName, leagueName } from '../data/index.js';

/** ICS 换行必须是 CRLF */
const CRLF = '\r\n';

/**
 * RFC 5545 文本转义：反斜杠、分号、逗号、换行
 * 顺序很重要 —— 先转义反斜杠，否则后面插入的反斜杠会被二次转义。
 */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * 折行：每行不超过 75 个八位组，续行以单个空格开头
 *
 * ⚠️ 必须按**字节**切，不能按字符切：中文队名一个字符 3 字节，
 * 按字符折行会得到 200+ 字节的行，Outlook / Google 日历都可能截断。
 * 切分时不能把多字节字符劈开，所以按码点逐个累加字节数。
 *
 * ⚠️ 不能用 Node 的 Buffer 计字节：本文件同时跑在浏览器里（桌面渲染层），
 * 那里没有 Buffer —— 实测导出会直接抛「Buffer is not defined」。
 * TextEncoder 两端都有（Node ≥ 11 全局可用），是这里唯一安全的字节口径。
 */
const ENCODER = new TextEncoder();
const byteLength = str => ENCODER.encode(str).length;

export function foldLine(line) {
  if (byteLength(line) <= 75) return line;
  const out = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = byteLength(ch);
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = ch;
      currentBytes = chBytes;
      limit = 74; // 续行开头有一个空格，占用 1 字节
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current) out.push(current);
  return out.join(`${CRLF} `);
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/** 时间戳 → 北京墙钟 "YYYYMMDDTHHMMSS"（不带 Z，配合 TZID 使用） */
export function bjStamp(ms) {
  const d = new Date(Number(ms) + 8 * 3600000);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`
  );
}

/** 时间戳 → UTC "YYYYMMDDTHHMMSSZ"（DTSTAMP 用） */
export function utcStamp(ms) {
  const d = new Date(Number(ms));
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Shanghai',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0800',
  'TZOFFSETTO:+0800',
  'TZNAME:CST',
  'END:STANDARD',
  'END:VTIMEZONE'
];

/**
 * 生成一条 VEVENT
 * @param {object} e { match, startTs, durationMs }
 * @param {number} now
 * @param {number} reminderMinutes 0 = 不加提醒
 */
export function buildEvent({ match, startTs, durationMs = MATCH_DURATION_MS }, now = Date.now(), reminderMinutes = 30) {
  const round = match.r ? `第 ${match.r} 轮` : '';
  const summary = `${leagueName(match.l)} ${teamName(match.h)} vs ${teamName(match.a)}`;
  const description = [round, '来自夜猫看台'].filter(Boolean).join(' · ');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${match.id}@nightowl-terrace`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;TZID=Asia/Shanghai:${bjStamp(startTs)}`,
    `DTEND;TZID=Asia/Shanghai:${bjStamp(startTs + durationMs)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT'
  ];
  if (reminderMinutes > 0) {
    lines.splice(
      lines.length - 1,
      0,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(summary)}`,
      `TRIGGER:-PT${Math.round(reminderMinutes)}M`,
      'END:VALARM'
    );
  }
  return lines;
}

/**
 * 生成整份日历
 *
 * @param {object} opts
 * @param {Array}  opts.matches 已筛选好的场次（调用方负责「只给未来未开赛且时间确定」的）
 * @param {number} [opts.reminderMinutes] 0 表示不提醒
 * @param {number} [opts.now]
 * @param {string} [opts.calendarName]
 * @returns {string} ICS 文本
 * @throws {Error} 没有任何可导出场次时抛错（不生成空文件）
 */
export function buildIcs({ matches = [], reminderMinutes = 30, now = Date.now(), calendarName = '夜猫看台' } = {}) {
  const events = [];
  for (const m of matches) {
    const start = ts(m.t);
    if (!Number.isFinite(start)) continue;
    if (start <= now) continue; // 已开赛 / 已结束不导出
    events.push(...buildEvent({ match: m, startTs: start }, now, reminderMinutes));
  }
  if (!events.length) {
    throw new Error('没有可导出的场次：只导出未开赛且开球时间已确定的比赛');
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NightOwl Terrace//Calendar Export//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...VTIMEZONE,
    ...events,
    'END:VCALENDAR'
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/* ------------------------------------------------------------------ */
/* 范围选择                                                            */
/* ------------------------------------------------------------------ */

export const ICS_RANGES = Object.freeze([
  { id: 'tonight', label: '今晚' },
  { id: 'week', label: '本周精选' },
  { id: 'followed', label: '关注球队 7 天' }
]);

/**
 * 按范围筛选可导出的场次
 *
 * 三条过滤对所有范围都成立：未开赛（st=sched）、时间确定（非 tbd）、开球时刻在未来。
 * 差异只在"取哪些"：
 *   tonight  → 今晚这个夜猫日
 *   week     → 本周窗口（调用方传入 weekStartStr，与 computeWeek 同一锚点）
 *   followed → 关注球队在未来 7 天内
 *
 * @param {Array} matches 全量赛程
 * @param {object} opts { range, nowTs, weekStartStr, followedTeams, weekIds }
 */
export function selectIcsMatches(matches, { range = 'tonight', nowTs = Date.now(), weekStartStr = null, followedTeams = [], weekIds = null } = {}) {
  const pool = (matches || []).filter(m => {
    if (!m || m.st !== 'sched' || m.tbd) return false;
    const start = ts(m.t);
    return Number.isFinite(start) && start > nowTs;
  });

  if (range === 'tonight') {
    const night = nightOfTs(nowTs);
    return pool.filter(m => owlDayOf(m.t) === night);
  }
  if (range === 'week') {
    if (weekIds && weekIds.size) return pool.filter(m => weekIds.has(m.id));
    if (!weekStartStr) return [];
    const days = weekDayList(weekStartStr);
    return pool.filter(m => days.includes(owlDayOf(m.t)));
  }
  if (range === 'followed') {
    const followed = new Set(followedTeams || []);
    if (!followed.size) return [];
    const until = nowTs + 7 * 86400000;
    return pool.filter(
      m => (followed.has(m.h) || followed.has(m.a)) && ts(m.t) <= until
    );
  }
  return [];
}

/** 夜猫日：北京时间 06:00 前归前一夜（与 engine.owlDay 同口径，这里独立实现避免循环依赖） */
function owlDayOf(t) {
  const parts = String(t || '').split('T');
  const hm = (parts[1] || '00:00').split(':');
  let day = parts[0];
  if (Number(hm[0]) < 6) {
    const p = day.split('-');
    const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - 86400000);
    day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return day;
}

function nightOfTs(ms) {
  const bj = new Date(Number(ms) + 8 * 3600000);
  const shifted = bj.getUTCHours() < 6 ? new Date(bj.getTime() - 86400000) : bj;
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function weekDayList(weekStartStr) {
  const base = Date.parse(`${weekStartStr}T00:00:00Z`);
  if (!Number.isFinite(base)) return [];
  const out = [];
  for (let i = 0; i < 7; i++) out.push(new Date(base + i * 86400000).toISOString().slice(0, 10));
  return out;
}
