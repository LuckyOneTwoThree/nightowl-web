/**
 * 数据保鲜：把多源比分数据折算成本地 fixtures 的补丁
 *
 * 为什么必须有：本产品赛程是**动态数据**。
 *   · 全季 1,023 场（53.9%）的开球时间是占位值，官方提前 2–4 周才公布
 *   · 每日产生新的完赛比分
 *   不做保鲜，过半场次的时间与比分永久失真。
 *
 * 数据来源：`server/sources/` 的多源适配层（ESPN 主源 + openfootball 副源），
 *          按优先级合并后交给本模块折算。
 *
 * 铁律（PRD FR-D-01）：**`st` 落库取值域只允许 `sched` / `done` / `pp`**
 *   进行中（live）**一律不落库**——由 `matchState()` 从时间推导。
 *   若写入 `live`，`pickToday` / `planWeek` / `minefield` 的 `st === 'sched'` 硬过滤
 *   会把正在进行的焦点战排除，Hero 卡会在开球那一刻消失。
 */

import { ts, MATCH_DURATION_MS } from '../src/core/engine.js';
import { fetchAllEvents, mergeEvents, DEFAULT_ORDER } from './sources/index.js';
import { SYNC_WINDOW_DAYS } from './data-store.js';

export const ALLOWED_ST = ['sched', 'done', 'pp'];

/** 单场最多允许的匹配时间偏差（天）——超过则视为不同场次，拒绝匹配 */
export const MATCH_WINDOW_DAYS = 4;

/**
 * 改期识别的最大跨度（天）
 *
 * 4 天窗口是为了防止「同对阵不同场次」被错配。但联赛确实存在整场改期
 * （实测 Levante vs Athletic：本地占位 09-17，官方改到 10-22，差 34.9 天）。
 * 仅当「同联赛同主客对阵唯一、本地仍未赛且无比分、上游时间可信」时放宽到 60 天；
 * 其余情况仍按 4 天拒绝，宁可漏配也不静默改错。
 */
export const RESCHEDULE_WINDOW_DAYS = 60;

/**
 * 赛季覆盖的月份（欧洲主流联赛口径：8 月 — 次年 5 月）
 *
 * 由赛季串派生，不再把 `2027-05` 硬编码进逻辑：
 * 2026-27 → 202608…202612 + 202701…202705，共 10 个月。
 *
 * @param {string} season 形如 '2026-27'
 * @returns {string[]} YYYYMM 列表；赛季串非法时返回空数组
 */
export function seasonMonths(season = '2026-27') {
  const m = String(season || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];

  const startYear = Number(m[1]);
  const endYear = startYear + 1;
  // 赛季串必须连续：2026-27 合法，2026-28 视为配置错误，不猜
  if (Number(m[2]) !== endYear % 100) return [];

  const pad = n => String(n).padStart(2, '0');
  const out = [];
  for (let month = 8; month <= 12; month++) out.push(`${startYear}${pad(month)}`);
  for (let month = 1; month <= 5; month++) out.push(`${endYear}${pad(month)}`);
  return out;
}

/**
 * 智能活跃同步月份：
 * 完赛比分与即时改期主要发生于「历史已开球但未录入」或「当前/近期 7 天内」的比赛月份。
 * 避免盲目扫描全季 9 个月（54 次请求），将常态同步请求压缩至 1~2 个月（8 秒极速完成）。
 */
export function activeSyncMonths(fixtures = [], nowTs = Date.now()) {
  const months = new Set();
  const d = new Date(nowTs);
  const curY = d.getUTCFullYear();
  const curM = d.getUTCMonth() + 1;
  const pad = n => String(n).padStart(2, '0');

  // 当前月
  months.add(`${curY}${pad(curM)}`);

  // 上个月
  let prevY = curY;
  let prevM = curM - 1;
  if (prevM < 1) {
    prevM = 12;
    prevY--;
  }
  months.add(`${prevY}${pad(prevM)}`);

  // 扫描 fixtures 中确有过去未完赛或近期 7 天开球的场次所属月份
  const future7Days = nowTs + 7 * 86400000;
  for (const m of fixtures) {
    const t = ts(m.t);
    if (Number.isNaN(t)) continue;
    if (m.st === 'sched' && (t < nowTs || t <= future7Days)) {
      const matchDate = new Date(t);
      const ym = `${matchDate.getUTCFullYear()}${pad(matchDate.getUTCMonth() + 1)}`;
      months.add(ym);
    }
  }

  return Array.from(months).sort();
}

/**
 * tbd（开球时间待定）场次的查询日期展开半径
 *
 * 为什么必须展开：tbd 场次的时间是**整轮共用的占位值**（实测 108/108 个 tbd 轮次
 * 整轮同一个占位时间，如德甲第 5 轮 9 场全是「2026-10-11T02:00」），
 * 但一轮实际跨周五 / 周六 / 周日**三个不同的日子**。ESPN 按精确日期查询，
 * 只查占位日就会漏掉其余日子的场次 —— 它们会永久停在 tbd，
 * 开球后表现为「待录比分 → 上游未提供」。
 *
 * 占位日通常是该轮的某一天，±3 天足以覆盖一整轮的全部日期。
 * 代价：每个进入同步窗口的 tbd 轮从 1 次请求变 7 次，
 * 但同一时刻进入 48h 窗口的 tbd 轮通常只有 1~2 个，增量可接受。
 */
const TBD_EXPAND_DAYS = 3;

/** 存在 stale tbd 时，自动把「tbd 展开闸门」放宽到这么多天（不直接加请求，只放开回看窗口） */
const STALE_TBD_SWEEP_DAYS = 60;

/**
 * 占位日已过、却仍是 tbd 的场次 —— 「补查盲区」的判据。
 *
 * 为什么需要单独一个函数：`activeSyncTargets` 里两条分支对这类场次**交集为空**：
 *   · 分支 A（已开球缺分）显式排除 tbd；
 *   · 分支 B（tbd 展开）有 `t >= now - tbdFloorDays` 守卫，占位日一过就永不回看。
 * 而外层 `add(t)` 是无条件执行的，于是**占位日照查、真实比赛日永不进 targets** ——
 * 界面就永远停在「待定」，而上游明明已经有比分。
 *
 * 实测（2026-11-05 快照）：PD-10 / PD-11 共 12 场，占位日已过 3–10 天，
 * ESPN 早就有完赛比分；用户数据里它们已经是 done（同步是工作的），
 * 只有**内置快照**还停在 tbd —— 全新安装的用户会看到 12 场「待定」。
 */
export function staleTbdMatches(fixtures = [], now = Date.now(), days = TBD_EXPAND_DAYS) {
  const floor = now - Math.max(0, days) * 86400000;
  return (fixtures || []).filter(m => {
    if (!m || m.tbd !== true || m.st !== 'sched') return false;
    const t = ts(m.t);
    return Number.isFinite(t) && t < floor;
  });
}

/**
 * 本轮实际使用的回填天数。
 *
 * 只有**存在 stale tbd** 时才自动放宽：干净时额外开销为 0（与旧行为完全一致），
 * 有积压时才付那 14 个日期请求。放宽本身不产生请求 —— 它只是放开
 * 「哪些 tbd 轮次允许 ±3 展开」的闸门，多查几天由实际存在的 tbd 决定，清掉后自动归零。
 */
export function autoBackfillDays(fixtures = [], backfillDays = 0, now = Date.now()) {
  const explicit = Math.max(0, Number(backfillDays) || 0);
  if (explicit) return explicit;
  return staleTbdMatches(fixtures, now).length ? STALE_TBD_SWEEP_DAYS : 0;
}

/**
 * 增量未同步精准目标：
 * 铁律：**已完赛（st === 'done' 且已有比分）的记录坚决不再重复同步**。
 *
 * 仅获取未同步的数据：
 *   1. 历史已开球但未录入完赛比分的场次（m.st === 'sched' && kickTs < nowTs）
 *   2. 当前正在进行的场次（kickTs <= nowTs && kickTs + 120min >= nowTs）
 *   3. 近期 48 小时内的未来场次（可能刚刚确定精确开球时间或改期）
 *
 * tbd 场次按占位日 ± TBD_EXPAND_DAYS 展开（见上）。
 *
 * 返回：Map<league, Set<string(YYYYMMDD)>>（转为 UTC 日期以匹配上游 API）
 */
export function activeSyncTargets(fixtures = [], nowTs = Date.now(), opts = {}) {
  const targets = new Map();
  const future48h = nowTs + 48 * 3600000;
  const pad = n => String(n).padStart(2, '0');
  // 回填模式：允许把「过去 N 天内」的 tbd 占位轮也按 ±3 天展开。
  // 常态同步用默认 3 天守卫防止积压放大请求；只在数据快照落后或手动回填时调大。
  const backfillDays = Math.max(0, Number(opts.backfillDays) || 0);
  const tbdFloorDays = Math.max(TBD_EXPAND_DAYS, backfillDays);

  for (const m of fixtures) {
    // 已同步完赛比分的记录，100% 排除，绝不重复同步
    if (m.st === 'done' && m.sc) continue;
    // 延期场次且无确切开球时间的暂不主动扫
    if (m.st === 'pp' && !m.t) continue;

    const t = ts(m.t);
    if (Number.isNaN(t)) continue;

    // 只有已开球（未录入）或未来 48 小时以内的场次才需要保鲜
    if (m.st === 'sched' && t <= future48h) {
      const add = (ms) => {
        const d = new Date(ms);
        const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
        if (!targets.has(m.l)) targets.set(m.l, new Set());
        targets.get(m.l).add(ymd);
      };
      add(t);
      // 已开球但未录入的场次：同时查前后一天。
      // 上游改期或不同源对同一场比赛的日期口径可能差一天（实测 PSG–OL：
      // 本地/openfootball 是 10-26 03:45，ESPN 记在 10-27 03:30），只按本地日期
      // 精确查询会永远查不到这场，界面就会一直显示「待录比分」。
      // 只对同步窗口内的缺分展开，避免历史积压把每个场次永久放大成 3 个请求。
      // 匹配仍走 planPatches 的 4 天窗口 + 60 天唯一对阵改期保护，不会误配。
      // 窗口常量与 freshness 的「上游缺分」统计同源（SYNC_WINDOW_DAYS）：两处各写
      // 一份 14，迟早出现「系统不查、报表却说缺」的矛盾。
      if (!m.tbd && t + MATCH_DURATION_MS < nowTs
          && nowTs - (t + MATCH_DURATION_MS) <= SYNC_WINDOW_DAYS * 86400000) {
        add(t - 86400000);
        add(t + 86400000);

        // 积压：完赛超过 1 天仍没有比分。这类场次最可能是被上游改期或被源记到了
        // 另一天 —— 实测 FL-9-LOR-BRT 本地记 11-01 03:45，ESPN 实际 11-02 19:45Z
        // 已完赛 0-2，而 ±1 天只覆盖 10-31/11-01/11-02(UTC) 的边界，永远命中不了。
        // 所以对积压场次放宽到匹配窗口（MATCH_WINDOW_DAYS = 4，与 planPatches 同口径）。
        // 当天刚完赛的场次仍只查 ±1：不会把所有场次一律放大成 9 个日期请求。
        const backlogDays = (nowTs - (t + MATCH_DURATION_MS)) / 86400000;
        if (backlogDays >= 1) {
          for (let i = 2; i <= MATCH_WINDOW_DAYS; i++) {
            add(t - i * 86400000);
            add(t + i * 86400000);
          }
        }
      }
      // tbd：占位日可能不是真实比赛日，向前后展开覆盖整轮。
      // 只对「占位日仍可能覆盖真实比赛日」的场次展开 —— ESPN 在开球前数日就公布真实时间，
      // 此时占位日在未来或临近。占位日已过去很久仍为 tbd 的场次（积压），展开窗口早已整体
      // 落在过去，再查也查不到，反而把每个这种场次的 1 个请求永久放大成 7 个，拖慢整轮同步。
      if (m.tbd && t >= nowTs - tbdFloorDays * 86400000) {
        for (let i = 1; i <= TBD_EXPAND_DAYS; i++) {
          add(t - i * 86400000);
          add(t + i * 86400000);
        }
      }
    }
  }

  return targets;
}

/**
 * UCL 淘汰赛接管扫描（P2）
 *
 * 背景：欧冠淘汰赛（2027-02 起）的对阵要等 2027-01 抽签后才确定，
 * 本地快照里不可能有这些场次。而 activeSyncTargets 的查询日期
 * **完全由本地场次推导**——本地没有，就不会生成查询，新赛程永远发现不了。
 * 于是欧冠赛程到 2027-01-28 就断了，而淘汰赛恰是深夜观赛的核心场景。
 *
 * 解法：UCL 的查询不依赖本地场次，直接扫「本周的欧冠比赛日」。
 * 欧冠固定在周二/周三/周四进行，扫本周这三天即可覆盖；
 * 拉到本地没有的对阵会进入现有 unmatched 报告（stats.noCounterpart），
 * 由人或脚本决定是否纳入——**不自动新增场次**，守住「数据只走脚本」的铁律。
 *
 * 代价：常态同步每次多 3 个请求（约 +10%），可接受。
 * 欧冠休赛期（6-8 月）这三天没有赛事，ESPN 返回空，无副作用。
 */
// 相对周一的偏移：+1=周二、+2=周三、+3=周四（欧冠固定在这三天）
const UCL_MATCH_OFFSETS = [1, 2, 3];

export function uclWeeklyTargets(nowTs = Date.now(), targets = new Map()) {
  const pad = n => String(n).padStart(2, '0');
  const now = new Date(nowTs);
  // 本周一（UTC，取 UTC 日分量构造，避免本地时区把日期推前一天）
  const wd = now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((wd + 6) % 7));

  if (!targets.has('UCL')) targets.set('UCL', new Set());
  const set = targets.get('UCL');
  for (const offset of UCL_MATCH_OFFSETS) {
    const d = new Date(monday.getTime() + offset * 86400000);
    set.add(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`);
  }
  return targets;
}

/* ------------------------------------------------------------------ */
/* 折算补丁                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把合并后的事件折算成本地 fixtures 的补丁
 *
 * @param {object[]} merged  mergeEvents 的输出
 * @param {object[]} fixtures 本地赛程
 * @returns {{ patches: Map<string, object>, stats: object, unmatched: object[], conflicts: object[] }}
 */
export function planPatches(merged, fixtures, conflicts = []) {
  const patches = new Map();
  const unmatched = [];
  const incompleteScore = [];
  /** 被拒绝的大幅时间位移（副源想改已确认的时间）：暴露出来，不静默 */
  const timeRejected = [];
  const stats = {
    done: 0, timeUpdated: 0, tbdCleared: 0, pp: 0,
    skippedLive: 0, noCounterpart: 0, scoreFromSecondary: 0,
    skippedIncompleteScore: 0, rescheduled: 0, roundFixed: 0, timeRejected: 0
  };

  // 按 (联赛, 主队-客队) 建索引，避免每次全表扫描
  const index = new Map();
  for (const m of fixtures) {
    const k = `${m.l}|${m.h}-${m.a}`;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(m);
  }

  for (const e of merged) {
    // 进行中：不落库（铁律）
    if (e.state === 'live') {
      stats.skippedLive++;
      continue;
    }
    if (!e.kickoff) continue;

    const cands = index.get(`${e.league}|${e.homeId}-${e.awayId}`);
    if (!cands || !cands.length) {
      stats.noCounterpart++;
      unmatched.push({ league: e.league, h: e.homeId, a: e.awayId, at: e.kickoff, sources: e.sources, reason: '本地赛程无此对阵' });
      continue;
    }

    // 取时间最接近的一场（同对阵一季可能主客各一次）
    const evTs = ts(e.kickoff);
    let best = null;
    let bestDiff = Infinity;
    for (const m of cands) {
      const d = Math.abs(ts(m.t) - evTs);
      if (d < bestDiff) {
        bestDiff = d;
        best = m;
      }
    }
    const outOfWindow = !best || bestDiff > MATCH_WINDOW_DAYS * 86400000;
    const canReschedule =
      outOfWindow &&
      best &&
      bestDiff <= RESCHEDULE_WINDOW_DAYS * 86400000 &&
      cands.length === 1 &&
      best.st === 'sched' &&
      !best.sc &&
      e.kickoffTrusted &&
      (e.state === 'sched' || e.state === 'done');

    if (outOfWindow && !canReschedule) {
      stats.noCounterpart++;
      unmatched.push({
        league: e.league, h: e.homeId, a: e.awayId, at: e.kickoff, sources: e.sources,
        reason: `时间差超阈值（${(bestDiff / 86400000).toFixed(1)} 天）`
      });
      continue;
    }
    if (canReschedule) stats.rescheduled++;

    /**
     * 前置校验：声称「完赛」就必须带完整比分
     *
     * 否则会产出一条 { st: 'done' } 的半套补丁，让 fixtures 出现「已完赛却无比分」，
     * 于是写盘前校验失败、sync-scores --apply 整批中止 —— 其余完全合法的补丁一起丢，
     * 而唯一"解法"是手工改数据文件，违反本仓「数据只走脚本」的铁律。
     * 这里改为：**整条事件跳过**（连开球时间也不更新，避免留下半套补丁），并计入统计。
     */
    const scoreStr = `${e.homeScore}-${e.awayScore}`;
    const hasFullScore = e.homeScore != null && e.awayScore != null && /^\d+-\d+$/.test(scoreStr);
    if (e.state === 'done' && !hasFullScore) {
      stats.skippedIncompleteScore++;
      incompleteScore.push({
        league: e.league,
        h: e.homeId,
        a: e.awayId,
        at: e.kickoff,
        got: `homeScore=${e.homeScore} awayScore=${e.awayScore}`,
        sources: e.sources
      });
      continue;
    }

    const patch = {};

    /* 比分：只对完赛且两比分齐全的场次写入，格式必须 H-A */
    if (e.state === 'done') {
      stats.done++;
      if (scoreStr !== best.sc) patch.sc = scoreStr;
      if (e.scoreSource && e.scoreSource !== 'espn') stats.scoreFromSecondary++;
    }

    /* 开球时间：**只信 kickoffTrusted 的源**（副源给的是当地墙钟，直接用会整体偏移） */
    if (e.kickoffTrusted && e.kickoff !== best.t) {
      /**
       * 但「可信」不等于「可覆盖」。
       *
       * 实测（2026-11-05 写盘复现）：ESPN 当轮没查那一天时，簇里只剩 openfootball，
       * 它的 date 会把**已经由 ESPN 确认过**的时间改掉，而且改错：
       *   FL-9-LOR-BRT  11-03 03:45（ESPN: 11-02 19:45Z ✓）→ 11-01 03:45（副源，✗ 差 2 天）
       *   FL-9-OL-ANG   11-02 00:15（ESPN: 11-01 16:15Z ✓）→ 11-01 03:45（副源，✗ 差 21 小时）
       * 这两场都是 `tbd: false` 的已确认时间，被一次性推错两天 —— 而且 done 场次
       * `activeSyncTargets` 直接跳过，错了也不会自愈。
       *
       * 规则：**已确认**（tbd !== true）的时间不接受超过 6 小时的位移，
       * 除非这是真正的改期（canReschedule / state === 'pp'）—— 那些本来就要动日期。
       * 占位时间（tbd === true）不受此限，因为它们本来就不是真实开球时间。
       */
      const CONFIRMED_TIME_SHIFT_MS = 6 * 3600000;
      const confirmed = best.tbd !== true;
      const shiftMs = Math.abs(ts(e.kickoff) - ts(best.t));
      const bigShift = confirmed && Number.isFinite(shiftMs) && shiftMs > CONFIRMED_TIME_SHIFT_MS;
      const allowed = !bigShift || canReschedule || e.state === 'pp';
      if (allowed) {
        patch.t = e.kickoff;
        stats.timeUpdated++;
        if (best.tbd) stats.tbdCleared++;
      } else {
        // 不静默：记数并留给日志，否则「时间没更新」永远查不出原因
        stats.timeRejected++;
        timeRejected.push({
          id: best.id,
          from: best.t,
          to: e.kickoff,
          hours: Math.round(shiftMs / 3600000),
          source: e.timeSource || e.sources?.[0] || 'unknown'
        });
      }
    }

    /* 状态 */
    if (e.state === 'pp' && best.st !== 'pp') {
      patch.st = 'pp';
      stats.pp++;
    } else if (e.state === 'done' && best.st !== 'done') {
      patch.st = 'done';
    } else if (e.state === 'sched' && best.st === 'pp') {
      patch.st = 'sched'; // 之前标了延期，现在又有安排 → 回到 sched
    }

    /* 解除 tbd：
       · 有时间且可信 → 必然解除
       · 已完赛且有比分 → 这场比赛确实发生了，占位时间不再成立（t 保持占位值，
         但 st='done' 后不再参与算法，故无影响） */
    if (best.tbd && (e.state === 'pp' ? false : (patch.t || (e.state === 'done' && patch.sc)))) {
      patch.tbd = false;
      if (!patch.t) stats.tbdCleared++;
    }

    /**
     * 轮次：只信**给出合法轮次**的源（当前只有 openfootball，格式 "Matchday N"）。
     *
     * 为什么必须真修：本地 26 场 PD 的 r 与权威源不一致（全在 R4–R7，呈中段编号置换），
     * 而 planPatches 此前从不写 r —— 所以这个错误**不会自愈**，同步跑多少次都还是错的。
     *
     * 三条硬约束（缺一不可）：
     *   1. 唯一对阵：cands.length === 1 —— 同对阵多候选时分不清是哪一场的轮次；
     *   2. 非改期匹配：canReschedule 为真说明两边日期差已超正常窗口，
     *      此时「轮次不同」可能只是改期的副作用（PD-7-LEV-ATH 就是「合法改期 + 编号错位」叠加），
     *      交给人工判断，脚本不擅自改；
     *   3. **只改 r，绝不改 id** —— id 是稳定主键，用户本地的补看清单 / 线路记忆 / ICS
     *      全以它为键，改 id 会让历史数据全量孤立失效。
     */
    if (Number.isInteger(e.round) && e.round > 0 && e.round !== best.r && !canReschedule && cands.length === 1) {
      patch.r = e.round;
      stats.roundFixed++;
    }

    if (Object.keys(patch).length) patches.set(best.id, patch);
  }

  return { patches, stats, unmatched, conflicts, incompleteScore, timeRejected };
}

/* ------------------------------------------------------------------ */
/* 同步主流程                                                          */
/* ------------------------------------------------------------------ */

/**
 * 执行一次保鲜同步
 * @param {object} opts
 * @param {Array}  opts.fixtures 本地赛程（只读）
 * @param {object} opts.rules    server/rules.json
 * @param {string[]} [opts.months] 限定月份（仅对按月分块的源生效）
 * @param {string[]} [opts.sources] 指定启用的源，默认全部
 */
export async function syncScores({ fixtures, rules, months, allMonths = false, sources, backfillDays = 0, onlyMatchIds = null, log = console }) {
  const cfg = rules.scores || {};
  const season = cfg.season || '2026-27';
  const leagues = Object.keys(cfg.leagues || {});
  const order = (sources && sources.length ? sources : DEFAULT_ORDER).filter(s => DEFAULT_ORDER.includes(s));
  const pad = n => String(n).padStart(2, '0');
  
  let list = null;
  let targets = null;

  if (Array.isArray(onlyMatchIds) && onlyMatchIds.length) {
    /**
     * 单场重查：只查这一场所属联赛的那几天（±1 天）。
     *
     * 窗口与 activeSyncTargets 对「已开球缺分」的处理对齐：常规 ±1 天，但只要这场
     * 已经积压（完赛超过 1 天仍未拿到比分），就按匹配窗口 MATCH_WINDOW_DAYS 展开。
     * 上游对同一场比赛的日期口径实测可达 2–3 天（FL-9-LOR-BRT 本地 11-01、ESPN 11-02），
     * 只查 ±1 天会让「重查该场」这个按钮永远救不回改期场次。
     * 单场重查是用户主动触发，9 个日期请求的代价可以接受。
     */
    const set = new Set(onlyMatchIds);
    targets = new Map();
    for (const m of fixtures) {
      if (!set.has(m.id)) continue;
      const t = ts(m.t);
      if (!Number.isFinite(t)) continue;
      const backlogDays = (Date.now() - (t + MATCH_DURATION_MS)) / 86400000;
      const span = backlogDays >= 1 ? MATCH_WINDOW_DAYS : 1;
      for (let i = -span; i <= span; i++) {
        const d = new Date(t + i * 86400000);
        const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
        if (!targets.has(m.l)) targets.set(m.l, new Set());
        targets.get(m.l).add(ymd);
      }
    }
    list = activeSyncMonths(fixtures);
  } else if (months && months.length && months !== 'all') {
    list = Array.isArray(months) ? months : [months];
    // 指定月份模式：提取指定月份内涉及的比赛日期
    targets = new Map();
    for (const m of fixtures) {
      if (m.st === 'done' && !allMonths) continue;
      const t = ts(m.t);
      if (Number.isNaN(t)) continue;
      const d = new Date(t);
      const ym = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
      if (list.includes(ym)) {
        const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
        if (!targets.has(m.l)) targets.set(m.l, new Set());
        targets.get(m.l).add(ymd);
      }
    }
  } else if (allMonths || months === 'all') {
    list = seasonMonths(season);
    targets = new Map();
    for (const m of fixtures) {
      const t = ts(m.t);
      if (Number.isNaN(t)) continue;
      const d = new Date(t);
      const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
      if (!targets.has(m.l)) targets.set(m.l, new Set());
      targets.get(m.l).add(ymd);
    }
  } else {
    // 默认常态增量同步：精准提取未同步完赛场次与近期 48 小时比赛的日期，已同步场次完全跳过。
    // backfillDays 走 autoBackfillDays：只有存在「占位日已过仍 tbd」的积压时才自动放宽，
    // 否则与旧行为完全一致（0 额外请求）。
    targets = activeSyncTargets(fixtures, Date.now(), {
      backfillDays: autoBackfillDays(fixtures, backfillDays, Date.now())
    });
    list = activeSyncMonths(fixtures);
    // UCL 淘汰赛接管：欧冠查询不依赖本地场次（抽签后才有对阵），直接扫本周比赛日
    if (leagues.includes('UCL')) {
      targets = uclWeeklyTargets(Date.now(), targets);
    }
  }

  const { events, bySource, errors } = await fetchAllEvents({
    leagues, months: list, targets, order, log, season, timeoutMs: cfg.timeoutMs,
    delayMs: Number.isFinite(cfg.requestDelayMs) ? cfg.requestDelayMs : 200
  });

  const { merged, conflicts } = mergeEvents(events, order);
  const { patches, stats, unmatched, incompleteScore, timeRejected } = planPatches(merged, fixtures, conflicts);
  const attempted = Object.values(bySource || {}).some(info => (info.requests || 0) > 0);

  return {
    patches, merged, conflicts, unmatched, incompleteScore, timeRejected,
    bySource, errors,
    attempted,
    stats,
    months: list,
    targets,
    // 占位日已过仍是 tbd 的场次数：>0 说明本轮自动放宽了回看窗口（请求会变多）
    staleTbd: staleTbdMatches(fixtures, Date.now()).length,
    sources: order
  };
}

/** 把补丁应用到 fixtures 数组（返回新数组，不改原对象） */
export function applyPatches(fixtures, patches) {
  let changed = 0;
  const next = fixtures.map(m => {
    const p = patches.get(m.id);
    if (!p) return m;
    changed++;
    return { ...m, ...p };
  });
  return { fixtures: next, changed };
}

/**
 * 写盘前校验：st 取值域 + done 必有比分
 *
 * 列出**具体 offender**（最多 10 个），而不是只给第一个样本 ——
 * 否则排错只能靠猜，而这个校验一旦触发就是整批中止，代价很高。
 */
export function validateFixtures(fixtures) {
  const issues = [];

  const badSt = fixtures.filter(m => !ALLOWED_ST.includes(m.st));
  if (badSt.length) {
    const sample = badSt.slice(0, 10).map(m => `${m.id}=${m.st}`).join('、');
    issues.push(
      `${badSt.length} 场次的 st 不在取值域 ${ALLOWED_ST.join('/')} 内：${sample}${badSt.length > 10 ? ` … 共 ${badSt.length} 场` : ''}`
    );
  }

  const doneNoScore = fixtures.filter(m => m.st === 'done' && !m.sc);
  if (doneNoScore.length) {
    const sample = doneNoScore.slice(0, 10).map(m => m.id).join('、');
    issues.push(
      `${doneNoScore.length} 场次 st=done 但无比分：${sample}${doneNoScore.length > 10 ? ` … 共 ${doneNoScore.length} 场` : ''}`
    );
  }

  // 时间格式：污染后 sleepTier/owlDay 会全部失真，必须在落库前拒绝。
  const badTime = fixtures.filter(m => !Number.isFinite(ts(m.t)));
  if (badTime.length) {
    const sample = badTime.slice(0, 10).map(m => `${m.id}=${m.t}`).join('、');
    issues.push(
      `${badTime.length} 场次开球时间不可解析：${sample}${badTime.length > 10 ? ` … 共 ${badTime.length} 场` : ''}`
    );
  }

  return issues;
}
