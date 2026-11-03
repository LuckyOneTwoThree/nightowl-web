import { useMemo, useState } from 'react';
import { zhDate, hmCost, hm } from '../core/format.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { stateOf } from '../core/owl.js';
import { owlDay, sleepTier, PRODUCT_PLAN_OPTS } from '../core/engine.js';
import { weekRiskBands } from '../core/week-risk.js';
import { Chip, Crest, Hint, IndexTag, Meta, SectionLabel, SleepBadge, Stars } from './atoms.jsx';
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconClose, IconWarn } from './icons.jsx';
import MatchRow from './MatchRow.jsx';
import { useScrollMemory } from '../hooks/useScrollMemory.js';

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

/** 精选名额上限以算法配置为唯一出处，界面不再手写 /5 */
const PLAN_MAX_PICKS = PRODUCT_PLAN_OPTS.maxPicks;

/**
 * 档位分布色阶。
 * 复用 tier-0…tier-4 连续色阶，使「时间轴上的色块」与「徽章上的 S0–S4」完全一致。
 */
const BUCKET_CLASS = ['bg-tier-0', 'bg-tier-1', 'bg-tier-2', 'bg-tier-3', 'bg-tier-4'];

/* ------------------------------------------------------------------ */
/* 一周熬夜时间轴                                                      */
/* ------------------------------------------------------------------ */

/**
 * 一周熬夜时间轴
 *
 * 数学口径全部来自 `core/week-risk.js`（夜坐标 / 睡眠底线 / 自适应轴），桌面只负责「分道画色块」。
 * 同一件事两端各算一遍，早晚会出现「手机说越线 3 小时、电脑说 2 小时」。
 *
 * 行 = 周一到周日（夜猫日口径），列 = 本周实际覆盖的夜里时段；色块按开球时刻定位、
 * 宽约 2 小时；亮色 = 本周精选入选，暗色 = 未入选。
 *
 * **只画「未开赛且开球时间已定」的场次** —— 与下方精选/零成本/备选列表、与移动风险带同口径。
 * 已结束的场次不再画：这张表回答的是「还要熬到几点」，历史归赛程页。
 * `tbd` 场次同样不画：占位时间（04:00 / 02:00）不是结论，画上去等于编一个时间出来。
 */
function WeekTimeline({ risk, matchById, bestIds, selectedDay, onToggleDay }) {
  const { domain, floor, bands, tbdCount } = risk;
  const pct = min => ((min - domain.startMin) / (domain.endMin - domain.startMin)) * 100;
  const floorInRange = floor != null;

  return (
    <div className="border-t border-line-hairline px-2.5 pt-2 pb-2">
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span className="text-2xs font-medium text-text-muted">7 晚时间轴（点击单晚筛选）</span>
        {selectedDay ? (
          <button
            type="button"
            onClick={() => onToggleDay(selectedDay)}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-medium text-accent transition-colors hover:bg-surface-accent focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
          >
            <span>清除 {selectedDay.slice(5).replace('-', '/')}</span>
            <IconClose size={10} />
          </button>
        ) : (
          <Hint
            content="每行一晚，横向是这一夜的时间轴。色块按开球时刻定位、宽度约 2 小时，颜色对应 S0–S4；亮色是本周精选入选场次。虚线是「起床时间 − 最低睡眠」的底线，越线即低于个人底线。只画未开赛场次。"
            align="end"
          />
        )}
      </div>

      {/* 刻度行：与下方轨道列对齐（左侧留出周标签宽度、右侧留出场次数宽度） */}
      <div className="flex items-center gap-1.5 pl-0.5">
        <span className="w-6 shrink-0" aria-hidden="true" />
        <span className="relative flex-1 font-num text-[10px] leading-none tabular-nums text-text-faint">
          {domain.ticks.map(tick => (
            <span
              key={tick.min}
              className="absolute -translate-x-1/2"
              style={{ left: `${pct(tick.min)}%` }}
              aria-hidden="true"
            >
              {tick.label}
            </span>
          ))}
        </span>
        <span className="w-4 shrink-0" aria-hidden="true" />
      </div>

      <div className="mt-1 space-y-1">
        {bands.map((band, i) => {
          const items = band.segments
            .map(seg => {
              const m = matchById.get(seg.id);
              if (!m) return null;
              return { m, s: seg.startMin, e: seg.endMin, tier: sleepTier(m.t) };
            })
            .filter(Boolean);

          // 贪心分道：同一条轨道内不重叠；超过 3 道后回到第 0 道叠画——
          // 「一晚上挤了十几场」这件事本身就该看起来是糊的。
          const laneEnds = [];
          for (const it of items) {
            let lane = laneEnds.findIndex(end => end <= it.s);
            if (lane < 0) {
              if (laneEnds.length < 3) {
                lane = laneEnds.length;
                laneEnds.push(it.e);
              } else {
                lane = 0;
              }
            } else {
              laneEnds[lane] = it.e;
            }
            it.lane = lane;
          }
          const lanes = Math.max(1, laneEnds.length || 1);
          // 没有待安排场次的夜晚只占一条细线：整周应有 7 行（周口径不能缺），
          // 但「周一已经过去了」不该和「周六有四场」占同样高度。
          const rowHeight = items.length ? lanes * 8 + 2 : 4;
          const isSelected = selectedDay === band.date;
          const hasBest = items.some(it => bestIds.has(it.m.id));

          return (
            <button
              key={band.date}
              type="button"
              onClick={() => onToggleDay(band.date)}
              aria-pressed={isSelected}
              aria-label={`${zhDate(band.date)} 周${WEEKDAY_SHORT[i]}，${band.count} 场${
                band.latestEndClock ? `，最晚到 ${band.latestEndClock}` : ''
              }${band.belowFloor ? `，越过底线 ${band.overMinutes} 分钟` : '，未越线'}${
                band.current ? '，今夜' : ''
              }${hasBest ? '，含本周精选' : ''}`}
              title={`${zhDate(band.date)} · ${band.count} 场${
                band.latestEndClock ? ` · 最晚到 ${band.latestEndClock}` : ''
              }${band.belowFloor ? ` · 越过底线 ${band.overMinutes} 分钟` : ''}`}
              className={`flex w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer ${
                isSelected ? 'bg-surface-raised ring-1 ring-accent/50' : 'hover:bg-surface-raised/60'
              }`}
            >
              <span
                className={`w-6 shrink-0 text-2xs leading-none ${
                  isSelected ? 'font-semibold text-accent' : 'text-text-secondary'
                }`}
              >
                周{WEEKDAY_SHORT[i]}
              </span>

              <span className="relative flex-1" style={{ height: rowHeight }} aria-hidden="true">
                {domain.ticks.map(tick => (
                  <span
                    key={tick.min}
                    className="absolute inset-y-0 w-px bg-line-hairline/60"
                    style={{ left: `${pct(tick.min)}%` }}
                  />
                ))}
                {floorInRange && (
                  <span
                    className={`absolute inset-y-0 w-px border-l border-dashed ${
                      floor.assumed ? 'border-text-faint/60' : 'border-accent/60'
                    }`}
                    style={{ left: `${pct(floor.nightMin)}%` }}
                  />
                )}
                {items.length === 0 && (
                  <span className="absolute inset-x-0 top-1/2 h-px bg-line-hairline/70" />
                )}
                {items.map(it => {
                  const best = bestIds.has(it.m.id);
                  return (
                    <span
                      key={it.m.id}
                      className={`absolute rounded-[2px] ${BUCKET_CLASS[it.tier.tier] || 'bg-tier-1'}`}
                      style={{
                        left: `${pct(it.s)}%`,
                        width: `${Math.max(1.5, pct(it.e) - pct(it.s))}%`,
                        top: it.lane * 8,
                        height: 7,
                        opacity: best ? 1 : 0.5
                      }}
                      title={`${teamName(it.m.h)} vs ${teamName(it.m.a)} · ${hm(it.m.t)} · ${it.tier.label} ${hmCost(it.tier.cost)}${best ? ' · 本周精选' : ''}`}
                    />
                  );
                })}
              </span>

              <span
                className={`w-4 shrink-0 text-right font-num text-[10px] leading-none tabular-nums ${
                  band.belowFloor ? 'text-warn' : 'text-text-faint'
                }`}
              >
                {band.count || ''}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-1 px-0.5 text-[10px] leading-relaxed text-text-faint">
        亮色 = 本周精选 · 虚线 = {floor ? `${floor.clock} 底线` : '睡眠底线'}
        {floor?.assumed ? '（未设作息，按默认起床 / 睡眠画的）' : ''} ·
        {risk.riskNights > 0 ? ` ${risk.riskNights} 晚越过底线` : ' 没有越线'}
        {risk.worst ? ` · 最晚到 ${risk.worst.latestEndClock}（周${WEEKDAY_SHORT[risk.worst.weekday]}）` : ''}
        {tbdCount > 0 ? ` · 另有 ${tbdCount} 场开球时间待定，没有画进来` : ''}
      </p>
    </div>
  );
}


/** 背包规划要解释口径，但不该占版面 */
const PLAN_HINT =
  '零成本（S0）场次不进背包：不占睡眠额度，但同一时段仍只能看一场。背包只有 5 个名额，是本周可安排的场次上限，不是睡眠额度。';

/**
 * 本周视图（Week）
 *
 * 结构：
 *   · 顶部仪表盘卡片：睡眠预算（预算 / 已排 / 剩余）+ 可折叠滑杆 + 内嵌 7 晚熬夜负荷柱（点击单晚过滤）
 *   · 下方三段式 Tab 列表：本周精选 (N/5) | 零成本顺带 (N) | 备选与雷区 (N)
 */
export default function WeekView({
  week,
  prefs,
  now,
  activeMatchId,
  onSelect,
  onBudgetChange,
  weekOffset = 0,
  onWeekOffsetChange,
  revealed,
  onReveal
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('best');
  const [selectedDay, setSelectedDay] = useState(null);
  /* 滚动位置按「页签 + 日期筛选」分桶：切走再切回能回到原处，
     换页签本来就是换了一份内容，沿用上一份的位置才是错的。 */
  const listRef = useScrollMemory(`week:${activeTab}:${selectedDay || 'all'}`);

  const { plan, minefield, days, advice } = week;
  const remaining = Math.max(0, plan.budget - plan.used);

  /* 周切换：只平移锚点，可排性仍按真实 now（口径见 core/owl.js 的 weekOffset）。
     历史周没有「还要熬到几点」的风险语义，风险带与底线结论一律不显示。 */
  const weekTitle =
    weekOffset === 0 ? '本周熬夜规划' : weekOffset > 0 ? '未来周熬夜规划' : '历史周规划';
  const showRisk = weekOffset >= 0;
  const changeWeek = delta => {
    setSelectedDay(null);
    onWeekOffsetChange?.(delta === 0 ? 0 : weekOffset + delta);
  };

  /* 一周风险带：夜坐标 / 睡眠底线 / 自适应轴全部来自 core/week-risk.js。
     结论行与时间轴共用同一份计算 —— 早先这里另有一套「精选有几晚低于底线」的摘要，
     分母只算精选、而轴上画的是全周，同屏两个「低于底线」会让人不知道该信哪个。 */
  const risk = useMemo(
    () =>
      weekRiskBands(
        week,
        {
          enabled: prefs.sleepEnabled,
          wakeTime: prefs.sleepWakeTime,
          minSleep: prefs.sleepMinHours
        },
        now
      ),
    [week, prefs.sleepEnabled, prefs.sleepWakeTime, prefs.sleepMinHours, now]
  );
  const hasScheduledMatches = risk.bands.some(b => !b.empty);

  // 时间轴要高亮「入选的那几场」而不是「入选的夜晚」：同一晚可能既有精选也有落选。
  const bestIds = useMemo(() => new Set(plan.best.map(e => e.m.id)), [plan.best]);

  const matchById = useMemo(() => {
    const map = new Map();
    for (const m of week.matches || []) map.set(m.id, m);
    return map;
  }, [week]);

  const kickoffGroupByMatch = useMemo(() => {
    const map = new Map();
    for (const group of plan.kickoffGroups || []) {
      for (const entry of group.entries) map.set(entry.m.id, group);
    }
    return map;
  }, [plan.kickoffGroups]);

  // 筛选横幅的场次数必须和时间轴同一口径（未开赛且开球已定），
  // 不然会出现「横幅写 9 场、时间轴画 5 块」的分裂。
  const activeBand = useMemo(
    () => (selectedDay ? risk.bands.find(b => b.date === selectedDay) || null : null),
    [selectedDay, risk]
  );

  const weekRange = days.length
    ? `${days[0].date.slice(5).replace('-', '/')} – ${days[days.length - 1].date.slice(5).replace('-', '/')}`
    : '';

  const filteredBest = useMemo(
    () => (selectedDay ? plan.best.filter(e => owlDay(e.m.t) === selectedDay) : plan.best),
    [plan.best, selectedDay]
  );
  const filteredZero = useMemo(
    () => (selectedDay ? plan.zeroList.filter(e => owlDay(e.m.t) === selectedDay) : plan.zeroList),
    [plan.zeroList, selectedDay]
  );
  const filteredMinefield = useMemo(
    () => (selectedDay ? minefield.filter(e => owlDay(e.m.t) === selectedDay) : minefield),
    [minefield, selectedDay]
  );
  const filteredAlt = useMemo(
    () => (selectedDay ? plan.alt.filter(e => owlDay(e.m.t) === selectedDay) : plan.alt),
    [plan.alt, selectedDay]
  );

  // Tab 计数必须与当前列表口径一致：单晚筛选生效时显示当晚数量，
  // 否则会出现「标签写 21 场、列表只渲染 9 行」的静默截断。
  const tabCounts = {
    best: selectedDay ? `${filteredBest.length}/${PLAN_MAX_PICKS}` : `${plan.best.length}/${PLAN_MAX_PICKS}`,
    zero: selectedDay ? `${filteredZero.length}` : `${plan.zeroCount}`,
    alt: selectedDay
      ? `${filteredAlt.length + filteredMinefield.length}`
      : `${plan.alt.length + minefield.length}`
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      {/* 夜猫周口径标题行：左标题 + 右周导航（上一周 / 本周 / 下一周） */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <SectionLabel
          hint="周一格从周一 06:00 起，含周二凌晨；周日格含周一凌晨（06:00 前归前一夜）。"
          right={<Meta num>{weekRange} 夜</Meta>}
          className="min-w-0 flex-1"
        >
          {weekTitle}
        </SectionLabel>
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="切换周">
          <button
            type="button"
            onClick={() => changeWeek(-1)}
            aria-label="上一周"
            title="上一周"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
          >
            <IconChevronLeft />
          </button>
          <button
            type="button"
            onClick={() => changeWeek(0)}
            disabled={weekOffset === 0}
            aria-label="回到本周"
            className={`rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
              weekOffset === 0
                ? 'cursor-default text-text-faint'
                : 'cursor-pointer text-text-secondary hover:bg-surface-raised hover:text-text-primary'
            }`}
          >
            本周
          </button>
          <button
            type="button"
            onClick={() => changeWeek(1)}
            aria-label="下一周"
            title="下一周"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
          >
            <IconChevronRight />
          </button>
        </div>
      </div>

      {/* 睡眠底线结论：口径 = 整周未开赛场次，与下方时间轴完全同源（core/week-risk.js） */}
      {showRisk && risk.floor && (
        <div className={`px-0.5 text-2xs ${risk.riskNights > 0 ? 'text-warn' : 'text-text-muted'}`}>
          按 <span className="font-num tabular-nums">{risk.floor.wakeTime}</span> 起床 · 底线{' '}
          <span className="font-num tabular-nums">{risk.floor.clock}</span>
          {risk.floor.assumed ? '（未设作息，按默认画）' : ''} ·
          {risk.riskNights > 0
            ? ` ${risk.riskNights} 晚越过底线${risk.worst ? `，最晚到 ${risk.worst.latestEndClock}` : ''}`
            : ' 全周未越线'}
          {risk.tbdCount > 0 ? ` · 另有 ${risk.tbdCount} 场开球待定未计入` : ''}
        </div>
      )}

      {/* ---- 顶部仪表盘卡片：睡眠预算 + 7 晚熬夜负荷柱 ---- */}
      <section className="shrink-0 overflow-hidden rounded-xl border border-line-hairline bg-surface-card shadow-card">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-raised/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-num text-xs tabular-nums">
              <span className="font-semibold text-text-primary">
                预算 <span className="text-resource">{plan.budget.toFixed(1)}h</span>
              </span>
              <span className="text-text-faint">·</span>
              <span className="text-text-secondary">已排 {plan.used.toFixed(1)}h</span>
              <span className="text-text-faint">·</span>
              <span className="text-text-muted">剩余 {remaining.toFixed(1)}h</span>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-text-muted">
            {expanded ? '收起' : '调整预算'}
            {expanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          </span>
        </button>

        {plan.budget > 0 && (
          <div className="px-3 pb-2">
            <div
              className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-panel"
              role="img"
              aria-label={`预算已用 ${hmCost(plan.used)} / ${hmCost(plan.budget)}`}
            >
              {plan.best.map(e => {
                const t = sleepTier(e.m.t);
                if (t.cost <= 0) return null;
                const pct = Math.min(100, (t.cost / plan.budget) * 100);
                return (
                  <span
                    key={e.m.id}
                    style={{ width: `${pct}%` }}
                    title={`${teamName(e.m.h)} vs ${teamName(e.m.a)} · ${t.label} (${t.cost}h)`}
                    className={`h-full rounded-full ${BUCKET_CLASS[t.tier] || 'bg-resource'}`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {expanded && (
          <div className="border-t border-line-hairline bg-surface-raised/30 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-2xs text-text-secondary">每周熬夜预算上限</span>
              <span className="font-num text-sm font-bold tabular-nums text-resource">
                {plan.budget.toFixed(1)} 小时 / 周
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="8"
              step="0.5"
              value={plan.budget}
              onChange={e => onBudgetChange(Number(e.target.value))}
              className="mt-2 w-full accent-[rgb(var(--resource-rgb))]"
              aria-label="每周熬夜预算（小时）"
            />

            <div className="mt-1 flex justify-between font-num text-2xs tabular-nums text-text-faint">
              <span>0h</span>
              <span>4h</span>
              <span>8h</span>
            </div>
          </div>
        )}

        {/* 7 晚时间轴：把「熬到几点」画回时间上 */}
        {!hasScheduledMatches ? (
          <div className="border-t border-line-hairline px-2.5 py-3">
            <p className="text-center text-2xs text-text-faint">
              {showRisk ? '本周暂无未开赛场次' : '历史周不显示熬夜风险，仅列出赛程'}
            </p>
          </div>
        ) : (
          <WeekTimeline
            risk={risk}
            matchById={matchById}
            bestIds={bestIds}
            selectedDay={selectedDay}
            onToggleDay={date => setSelectedDay(cur => (cur === date ? null : date))}
          />
        )}
      </section>

      {/* ---- 三段式列表切换 Tab ---- */}
      <div
        role="tablist"
        aria-label="本周列表切换"
        className="flex shrink-0 items-center justify-between gap-1 rounded-lg border border-line-hairline bg-surface-card p-1"
      >
        {[
          { id: 'best', label: '本周精选', count: tabCounts.best },
          { id: 'zero', label: '零成本顺带', count: tabCounts.zero },
          { id: 'alt', label: '备选与雷区', count: tabCounts.alt }
        ].map(t => {
          const on = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActiveTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-2xs transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer ${
                on
                  ? 'bg-surface-raised font-semibold text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <span className="truncate">{t.label}</span>
              <span className={`font-num tabular-nums ${on ? 'text-accent' : 'text-text-faint'}`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---- 列表内容区 ---- */}
      <div
        ref={listRef}
        key={`${activeTab}-${selectedDay || 'all'}`}
        className="scrollbar-thin -mr-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
      >
        {selectedDay && activeBand && (
          <div className="rounded-lg border border-accent/30 bg-surface-accent px-2.5 py-1.5 text-2xs text-text-primary">
            正在筛选：<span className="font-semibold text-accent">{zhDate(activeBand.date)} 夜</span>（共{' '}
            {activeBand.count} 场） · 点上方「清除」取消
          </div>
        )}

        {activeTab === 'best' && (
          <div>
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <Meta>{advice || '按夜猫指数与预算上限自动排程'}</Meta>
              <Hint content={PLAN_HINT} align="end" />
            </div>
            {filteredBest.length === 0 ? (
              <div className="rounded-lg border border-line-hairline bg-surface-raised/30 px-3 py-4 text-center">
                <p className="text-xs font-medium text-text-secondary">
                  {selectedDay
                    ? '当晚没有入选本周精选的场次'
                    : !showRisk
                      ? '历史周没有可计划的未开赛场次'
                      : risk.tbdCount > 0 && plan.evs.length === 0
                        ? `本周 ${risk.tbdCount} 场开球时间待定，公布开球时间后会自动进入规划`
                        : !hasScheduledMatches
                          ? '本周暂无比赛'
                          : plan.evs.length === 0
                            ? '本周暂无可安排的未开赛场次'
                            : '当前预算下暂未选出场次'}
                </p>
                {!selectedDay && plan.evs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onBudgetChange(Math.min(8, plan.budget + 1))}
                    disabled={plan.budget >= 8}
                    className="mt-2 rounded-md border border-accent/40 bg-surface-accent px-2.5 py-1 text-2xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    {plan.budget >= 8 ? '预算已达上限' : '预算增加 1 小时'}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredBest.map(e => {
                  const group = kickoffGroupByMatch.get(e.m.id);
                  return (
                    <div key={e.m.id}>
                      <PickRow
                        e={e}
                        active={e.m.id === activeMatchId}
                        kickoffGroup={group}
                        onSelect={onSelect}
                      />
                      <KickoffAlternatives
                        group={group}
                        selectedId={e.m.id}
                        activeMatchId={activeMatchId}
                        onSelect={onSelect}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'zero' && (
          <div>
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <Meta>睡前开球（0h 睡眠代价），不占本周预算与名额</Meta>
              <Meta num>可执行 {plan.zeroCount} 场</Meta>
            </div>
            {filteredZero.length === 0 ? (
              <div className="rounded-lg border border-line-hairline bg-surface-raised/30 px-3 py-4 text-center">
                <p className="text-xs text-text-secondary">
                  {selectedDay ? '当晚暂无零成本顺带场次' : '本周暂无零成本顺带场次'}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredZero.map(e => (
                  <MatchRow
                    key={e.m.id}
                    m={e.m}
                    state={stateOf(e.m, now)}
                    active={e.m.id === activeMatchId}
                    now={now}
                    onSelect={onSelect}
                    spoilerFree={prefs.spoilerFree}
                    revealed={revealed.has(e.m.id)}
                    onReveal={onReveal}
                    rivalry={e.ev.rivalry}
                    followedTeams={prefs.followedTeams}
                    index={e.index}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'alt' && (
          <div className="space-y-3">
            {filteredMinefield.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className="text-2xs font-semibold text-warn">本周雷区（高代价低看点）</span>
                  <Meta num>{filteredMinefield.length} 场</Meta>
                </div>
                <div className="space-y-1">
                  {filteredMinefield.map(e => (
                    <button
                      key={e.m.id}
                      type="button"
                      onClick={() => onSelect(e.m.id)}
                      className="w-full rounded-lg border border-line-hairline bg-surface-card px-2.5 py-2 text-left transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Meta num className="shrink-0">
                          {zhDate(e.m.t.split('T')[0])} {e.m.t.split('T')[1]}
                        </Meta>
                        <Chip tone="warn" className="ml-auto shrink-0">
                          <IconWarn size={11} />
                          雷区
                        </Chip>
                      </div>
                      <p className="mt-1 truncate text-xs font-medium text-text-primary">
                        {teamName(e.m.h)} vs {teamName(e.m.a)}
                      </p>
                      <p className="mt-0.5 truncate text-2xs text-text-muted">{e.reason}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between px-0.5">
                <span className="text-2xs font-semibold text-text-secondary">备选场次（因额度或同开球落选）</span>
                <Meta num>{filteredAlt.length} 场</Meta>
              </div>
              {filteredAlt.length === 0 ? (
                <div className="rounded-lg border border-line-hairline bg-surface-raised/30 px-3 py-4 text-center">
                  <p className="text-xs text-text-secondary">暂无备选场次</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredAlt.map(e => (
                    <button
                      key={e.m.id}
                      type="button"
                      onClick={() => onSelect(e.m.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-transparent bg-surface-card px-2.5 py-1.5 text-left transition-colors hover:border-line-hairline hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
                    >
                      <Meta num className="shrink-0">
                        {e.m.t.slice(5, 10).replace('-', '/')} {e.m.t.split('T')[1]}
                      </Meta>
                      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {teamName(e.m.h)} vs {teamName(e.m.a)}
                      </span>
                      <IndexTag value={e.index} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 同开球组的落选场次。默认收起，避免把「精选 2 场」扩成 6 行；
 * 展开后只切换右侧预览，不改变算法精选（计划不是手动编辑列表）。
 */
function KickoffAlternatives({ group, selectedId, activeMatchId, onSelect }) {
  const [open, setOpen] = useState(false);
  const others = (group?.entries || []).filter(e => e.m.id !== selectedId);
  if (others.length === 0) return null;
  return (
    <div className="pl-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        title="仅切换右侧预览，不改变本周精选"
        className="inline-flex items-center gap-1 pt-0.5 text-2xs text-text-faint transition-colors hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none cursor-pointer"
      >
        同开球其他 {others.length} 场
        {open ? <IconChevronUp size={11} /> : <IconChevronDown size={11} />}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {others.map(x => (
            <button
              key={x.m.id}
              type="button"
              onClick={() => onSelect?.(x.m.id)}
              aria-current={x.m.id === activeMatchId ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors cursor-pointer ${
                x.m.id === activeMatchId ? 'bg-surface-raised' : 'hover:bg-surface-raised/60'
              }`}
            >
              <span className="w-9 shrink-0 font-num text-2xs tabular-nums text-text-faint">
                {x.m.t.split('T')[1]}
              </span>
              <span className="min-w-0 flex-1 truncate text-2xs text-text-secondary">
                {teamName(x.m.h)} vs {teamName(x.m.a)}
              </span>
              <IndexTag value={x.index} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 背包入选行
 */
function PickRow({ e, active, kickoffGroup, onSelect }) {
  const m = e.m;
  const night = owlDay(m.t);
  const crossesMidnight = night !== m.t.slice(0, 10);
  const dateLabel = crossesMidnight
    ? `${night.slice(5).replace('-', '/')} 夜`
    : m.t.slice(5, 10).replace('-', '/');
  const conflictCount = kickoffGroup?.entries?.length || 0;
  const reason = e.ev.isFollowed
    ? '主队出战'
    : e.ev.rivalry
      ? e.ev.rivalry
      : e.ev.keyNode
        ? '故事线关键节点'
        : e.ev.star >= 3
          ? '焦点战'
          : '跨联赛焦点';

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      aria-current={active ? 'true' : undefined}
      className={`relative w-full overflow-hidden rounded-lg py-2 pr-2.5 pl-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer ${
        active
          ? 'border border-accent/45 bg-surface-raised shadow-card'
          : 'border border-transparent bg-surface-card hover:border-line-hairline hover:bg-surface-raised/70'
      }`}
    >
      <span
        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
        style={{ backgroundColor: leagueColor(m.l) }}
        aria-hidden="true"
      />

      <div className="flex gap-2.5">
        <span className="w-10 shrink-0 pt-px font-num text-xs font-semibold tabular-nums text-text-secondary">
          {m.t.split('T')[1]}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-2xs text-text-muted">{leagueName(m.l)}</span>
            <SleepBadge match={m} compact />
            {conflictCount > 1 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-warn/12 px-1.5 py-px font-num text-2xs font-medium text-warn">
                <IconWarn size={10} />
                同时开球 ({conflictCount})
              </span>
            )}
            <IndexTag value={e.index} className="ml-auto" />
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
              <span className="truncate text-xs font-medium text-text-primary">{teamName(m.h)}</span>
              <Crest id={m.h} size={16} />
            </div>
            <span className="shrink-0 font-num text-2xs text-text-faint">vs</span>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Crest id={m.a} size={16} />
              <span className="truncate text-xs font-medium text-text-primary">{teamName(m.a)}</span>
            </div>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <Stars star={e.ev.star} />
            <span className="min-w-0 truncate text-2xs text-text-faint">{reason}</span>
            <span
              className="ml-auto shrink-0"
              title={`开球 ${m.t.slice(5, 10).replace('-', '/')} ${m.t.split('T')[1]}${crossesMidnight ? ` · 归属 ${dateLabel}` : ''}`}
            >
              <Meta num>
                {dateLabel} · {sleepTier(m.t).cost}h
              </Meta>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
