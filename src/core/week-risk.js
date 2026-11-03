/**
 * 一周风险带 · 桌面 / 手机共用纯函数
 *
 * 存在的理由：柱状图只回答「哪晚消耗大」，回答不了「到几点、会不会越过睡眠底线」。
 * 而对熬夜的人来说后者才是决策依据 —— 「周六 5 场、消耗 4.5h」不如「周六要看到 05:20，
 * 比你的底线晚 4 小时 50 分」有用。所以这里把「一晚」画成时间轴上的一段，而不是一根柱子。
 *
 * 口径（勿改）：
 *   · 一条「夜」= 当日 18:00 → 次日 08:00，坐标为「距 18:00 的分钟数」，与 owlDay 同源
 *   · 睡眠底线 = 起床时间 − 最低睡眠，取自用户作息；未启用作息时用默认值并标 `assumed`
 *   · `tbd` 场次**不归属任何一晚**，只在周级报总数 —— 开球待定的场次连属于哪一夜都不知道，
 *     按占位时间把它摊到某晚，等于凭空造出一个时间结论
 *   · 不产出任何中文文案，只出语义（weekday 序号、overMinutes、clock），文案归各端
 */

import { MATCH_DURATION_MS, owlDay, ts } from './engine.js';
import { normalizeSleepProfile, parseClockTime } from './sleep.js';

const DAY_MIN = 1440;
/** 夜从 18:00 起算；坐标 0 就是 18:00 */
const NIGHT_START_MIN = 18 * 60;
const NIGHT_SPAN_MIN = 14 * 60; // 到次日 08:00
const DURATION_MIN = Math.round(MATCH_DURATION_MS / 60000);

/** 默认域：18:00 → 次日 08:00。数据越界时由 computeDomain 撑开，不裁剪 */
export const BAND_DOMAIN = Object.freeze({ startMin: 0, endMin: NIGHT_SPAN_MIN });

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/** 夜坐标（距 18:00 的分钟数）→ 墙钟 HH:mm */
export function clockOfNightMinute(nightMin) {
  const abs = (((NIGHT_START_MIN + nightMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** 某场比赛属于哪一个夜（owlDay），以及它在那一夜坐标里的开球分钟 */
export function nightMinuteOf(matchTime, night) {
  const startTs = ts(`${night}T18:00`);
  const matchTs = ts(matchTime);
  if (!Number.isFinite(startTs) || !Number.isFinite(matchTs)) return null;
  return Math.round((matchTs - startTs) / 60000);
}

/**
 * 睡眠底线：最晚几点必须睡。
 *
 * 就是「起床 − 最低睡眠」。00:30 之后才睡，7 小时就睡不满 07:30 起床。
 * 未启用作息时仍给出默认值（否则整张图没有参照物），但 `assumed: true`
 * 让界面必须说明这是默认底线，而不是用户自己的。
 */
export function sleepFloorOf(profile) {
  const p = normalizeSleepProfile(profile);
  if (!p.valid) return null;
  const wakeMin = parseClockTime(p.wakeTime);
  if (wakeMin == null) return null;
  const abs = ((wakeMin - Math.round(p.minSleep * 60)) % DAY_MIN + DAY_MIN) % DAY_MIN;
  // 18:00 之前的钟点算作次日凌晨（00:30 属于这一夜，不属于上一夜）
  const nightMin = abs < NIGHT_START_MIN ? abs + DAY_MIN - NIGHT_START_MIN : abs - NIGHT_START_MIN;
  return {
    nightMin,
    clock: clockOfNightMinute(nightMin),
    wakeTime: p.wakeTime,
    minSleep: p.minSleep,
    assumed: p.enabled !== true
  };
}

function ticksBetween(startMin, endMin) {
  const ticks = [];
  for (let min = startMin; min <= endMin; min += 240) {
    ticks.push({ min, label: clockOfNightMinute(min) });
  }
  return ticks;
}

/**
 * 横轴范围按数据自适应，不用固定的 18:00–08:00。
 *
 * 固定域在真实数据上会留下两小时空白（一场 04:00 的比赛收在 06:00，右边还空到 08:00）。
 * 域只保证三件事：左右各留 30 分钟、刻度落在整点、睡眠底线一定在域内（否则线会被画在框外）。
 *
 * 导出给桌面用：桌面时间轴画的是它自己那一套分道色块，但「轴怎么取」不该再写第二遍。
 *
 * @param {Array<{startMin: number, endMin: number}>} segments 参与绘制的场次段
 * @param {ReturnType<typeof sleepFloorOf>} floor
 */
export function nightDomain(segments, floor) {
  let min = Infinity;
  let max = -Infinity;
  for (const seg of segments || []) {
    if (!seg || !Number.isFinite(seg.startMin) || !Number.isFinite(seg.endMin)) continue;
    if (seg.startMin < min) min = seg.startMin;
    if (seg.endMin > max) max = seg.endMin;
  }
  if (!Number.isFinite(min)) {
    // 一晚都没有已定场次：给一段标准夜，此时界面只显示结论行，不画轨道
    return {
      startMin: BAND_DOMAIN.startMin,
      endMin: BAND_DOMAIN.endMin,
      ticks: ticksBetween(BAND_DOMAIN.startMin, BAND_DOMAIN.endMin)
    };
  }
  if (floor) {
    min = Math.min(min, floor.nightMin);
    max = Math.max(max, floor.nightMin + 30);
  }
  const startMin = min <= 0 ? Math.floor(min / 60) * 60 : Math.floor((min - 30) / 60) * 60;
  let endMin = Math.ceil((max + 30) / 60) * 60;
  // 一晚只排一场时轴会被压成一条缝，给个最小跨度
  if (endMin - startMin < 4 * 60) endMin = startMin + 4 * 60;
  return { startMin, endMin, ticks: ticksBetween(startMin, endMin) };
}

/**
 * 一周 7 晚的风险带。
 *
 * @param {{days?: Array<{date: string, cost?: number, matches?: Array}>,
 *          matches?: Array}} week computeWeek 的返回值（只需要 days 与 matches）
 * @param {{enabled?: boolean, wakeTime?: string, minSleep?: number}} profile
 * @param {number} [now] 毫秒时间戳，用于标记「今夜」与「已过」
 */
export function weekRiskBands(week, profile, now) {
  const days = Array.isArray(week?.days) ? week.days : [];
  const all = Array.isArray(week?.matches) ? week.matches : [];
  const floor = sleepFloorOf(profile);
  const nowTs = Number.isFinite(now) ? Number(now) : null;

  // 与 buildWeekDays 同口径：只算已定开球时间、未开赛的场次。
  // tbd 单独计数 —— 它们不属于任何一晚。
  const scheduled = all.filter(m => m && typeof m.t === 'string' && m.st === 'sched');
  const tbdCount = scheduled.filter(m => m.tbd).length;

  const bands = days.map((day, index) => {
    const known = scheduled.filter(m => !m.tbd && Number.isFinite(ts(m.t)) && owlDay(m.t) === day.date);

    const segments = known
      .map(m => {
        const startMin = nightMinuteOf(m.t, day.date);
        if (!Number.isFinite(startMin)) return null;
        const endMin = startMin + DURATION_MIN;
        return { id: m.id, t: m.t, startMin, endMin, endClock: clockOfNightMinute(endMin) };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMin - b.startMin);

    const latest = segments.reduce((acc, seg) => (!acc || seg.endMin > acc.endMin ? seg : acc), null);
    const startTs = ts(`${day.date}T18:00`);
    const deltaMin = Number.isFinite(startTs) && nowTs != null ? (nowTs - startTs) / 60000 : null;
    const current = deltaMin != null && deltaMin >= 0 && deltaMin < NIGHT_SPAN_MIN;

    const overMinutes =
      latest && floor ? Math.max(0, latest.endMin - floor.nightMin) : 0;

    return {
      date: day.date,
      weekday: index,
      cost: Number.isFinite(day.cost) ? day.cost : 0,
      count: segments.length,
      segments,
      firstStartMin: segments.length ? segments[0].startMin : null,
      latestEndMin: latest ? latest.endMin : null,
      latestEndClock: latest ? latest.endClock : null,
      belowFloor: overMinutes > 0,
      overMinutes,
      current,
      empty: segments.length === 0
    };
  });

  const worst = bands.reduce(
    (acc, band) =>
      band.latestEndMin != null && (!acc || band.latestEndMin > acc.latestEndMin) ? band : acc,
    null
  );

  return {
    floor,
    domain: nightDomain(
      bands.flatMap(b => b.segments),
      floor
    ),
    bands,
    worst: worst
      ? {
          date: worst.date,
          weekday: worst.weekday,
          latestEndMin: worst.latestEndMin,
          latestEndClock: worst.latestEndClock
        }
      : null,
    riskNights: bands.filter(b => b.belowFloor).length,
    /** 本周开球时间未定的场次数（不归属任何一晚） */
    tbdCount
  };
}
