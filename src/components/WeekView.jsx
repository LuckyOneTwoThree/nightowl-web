import { useMemo, useState } from 'react';
import { zhDate, hmCost, hm, formatMinuteOfDay } from '../core/format.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { stateOf } from '../core/owl.js';
import { owlDay, sleepTier, PRODUCT_PLAN_OPTS } from '../core/engine.js';
import { formatSleepHours, sleepLedger } from '../core/sleep.js';
import { Chip, Crest, Hint, IndexTag, Meta, SectionLabel, SleepBadge, Stars } from './atoms.jsx';
import { IconChevronDown, IconChevronUp, IconClose, IconWarn } from './icons.jsx';
import MatchRow from './MatchRow.jsx';

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
 * 时间轴范围：20:00 → 次日 06:30。
 * 20:00 是最早的 S0 场次；最晚的 04:00 开球 + 2h 正好收到 06:00，
 * 右侧再留半小时给"看完到几点"的读数，不再画永远为空的 06–08 区。
 */
const TL_START = 20 * 60;
const TL_END = 30 * 60 + 30;
const TL_SPAN = TL_END - TL_START;
/** 单场占用宽度：2 小时完赛近似，与 engine 的 MATCH_DURATION_MS 同一口径 */
const TL_MATCH_MIN = 120;

/** 墙钟时刻 → 时间轴分钟（凌晨归入次日，避免跨零点断轴） */
function tlMinute(t) {
  const clock = String(t || '').split('T')[1];
  if (!clock) return NaN;
  const h = Number(clock.slice(0, 2));
  const m = Number(clock.slice(3, 5));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  const min = h * 60 + m;
  return min < 12 * 60 ? min + 24 * 60 : min;
}

const tlPct = min => ((min - TL_START) / TL_SPAN) * 100;

/** 刻度：每 2 小时一个，标签用 24 小时制（次日凌晨仍写 00–06，不写 24+） */
const TL_TICKS = [20, 22, 24, 26, 28, 30];
const tickLabel = h => `${String(h % 24).padStart(2, '0')}`;

/**
 * 一周熬夜时间轴（替代原来的 7 根柱子）
 *
 * 为什么换：柱状图只回答「哪晚最重」，回答不了「要熬到几点」。而后者才是用户的
 * 决策问题 —— 睡眠成本是「开球时刻」的函数，把它画回时间轴上，同一晚的场次密度、
 * 同开球重叠、以及是否越过「最低睡眠线」三个事实不用解释就能看出来。
 *
 * 行 = 周一到周日（夜猫日口径），列 = 20:00–次日 06:30；每个色块按开球时刻定位，
 * 宽度按 2 小时完赛近似；亮色 = 本周精选入选，暗色 = 未入选。
 */
function WeekTimeline({ days, bestIds, selectedDay, onToggleDay, sleepEnabled, wakeTime, minSleep }) {
  const wakeMin = (() => {
    const h = Number(String(wakeTime || '').slice(0, 2));
    const m = Number(String(wakeTime || '').slice(3, 5));
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  })();
  // 最低睡眠线 = 起床时间 − 最低睡眠；凌晨时刻归一到次日
  const cutoff = sleepEnabled && wakeMin != null && Number.isFinite(minSleep)
    ? wakeMin - minSleep * 60 + 24 * 60
    : null;
  const cutoffInRange = cutoff != null && cutoff > TL_START && cutoff < TL_END;

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
            content="每行一晚，横向是 20:00–次日 06:30。色块按开球时刻定位、宽度约 2 小时，颜色对应 S0–S4；亮色是本周精选入选场次。虚线是「起床时间 − 最低睡眠」，越线即低于个人底线。"
            align="end"
          />
        )}
      </div>

      {/* 刻度行：与下方时间轴列对齐（左侧留出周标签宽度、右侧留出场次数宽度） */}
      <div className="flex items-center gap-1.5 pl-0.5">
        <span className="w-6 shrink-0" aria-hidden="true" />
        <span className="relative flex-1 font-num text-[10px] leading-none tabular-nums text-text-faint">
          {TL_TICKS.map(h => (
            <span
              key={h}
              className="absolute -translate-x-1/2"
              style={{ left: `${tlPct(h * 60)}%` }}
              aria-hidden="true"
            >
              {tickLabel(h)}
            </span>
          ))}
        </span>
        <span className="w-4 shrink-0" aria-hidden="true" />
      </div>

      <div className="mt-1 space-y-1">
        {days.map((d, i) => {
          const items = (d.matches || [])
            .map(m => {
              const start = tlMinute(m.t);
              if (!Number.isFinite(start)) return null;
              const s = Math.max(TL_START, start);
              const e = Math.min(TL_END, start + TL_MATCH_MIN);
              if (e <= s) return null;
              return { m, s, e, tier: sleepTier(m.t) };
            })
            .filter(Boolean)
            .sort((a, b) => a.s - b.s || a.e - b.e);

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
          const latest = items.length ? items.reduce((mx, it) => Math.max(mx, it.e), 0) : 0;
          const isSelected = selectedDay === d.date;
          const hasBest = items.some(it => bestIds.has(it.m.id));

          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onToggleDay(d.date)}
              aria-pressed={isSelected}
              aria-label={`${zhDate(d.date)} 周${WEEKDAY_SHORT[i]}，${items.length} 场${
                items.length ? `，最晚 ${String(Math.floor(latest / 60) % 24).padStart(2, '0')}:${String(latest % 60).padStart(2, '0')} 结束` : ''
              }${hasBest ? '，含本周精选' : ''}`}
              title={`${zhDate(d.date)} · ${items.length} 场 · 最晚 ${hmCost(d.cost)} 档`}
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
                {TL_TICKS.map(h => (
                  <span
                    key={h}
                    className="absolute inset-y-0 w-px bg-line-hairline/60"
                    style={{ left: `${tlPct(h * 60)}%` }}
                  />
                ))}
                {cutoffInRange && (
                  <span
                    className="absolute inset-y-0 w-px border-l border-dashed border-accent/60"
                    style={{ left: `${tlPct(cutoff)}%` }}
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
                        left: `${tlPct(it.s)}%`,
                        width: `${Math.max(1.5, tlPct(it.e) - tlPct(it.s))}%`,
                        top: it.lane * 8,
                        height: 7,
                        opacity: best ? 1 : 0.5
                      }}
                      title={`${teamName(it.m.h)} vs ${teamName(it.m.a)} · ${hm(it.m.t)} · ${it.tier.label} ${hmCost(it.tier.cost)}${best ? ' · 本周精选' : ''}`}
                    />
                  );
                })}
              </span>

              <span className="w-4 shrink-0 text-right font-num text-[10px] leading-none tabular-nums text-text-faint">
                {items.length || ''}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-1 px-0.5 text-[10px] leading-relaxed text-text-faint">
        亮色 = 本周精选 · 虚线 = 最低睡眠线
        {cutoffInRange ? ` ${formatMinuteOfDay(cutoff)}` : ''}
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
  revealed,
  onReveal
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('best');
  const [selectedDay, setSelectedDay] = useState(null);

  const { plan, minefield, days, advice } = week;
  const hasScheduledMatches = days.some(day => day.count > 0);
  const remaining = Math.max(0, plan.budget - plan.used);
  const sleepSummary = useMemo(() => {
    if (!prefs.sleepEnabled) return null;
    const profile = {
      enabled: true,
      wakeTime: prefs.sleepWakeTime,
      minSleep: prefs.sleepMinHours
    };
    const ledgers = plan.best
      .map(e => sleepLedger(e.m.t, profile))
      .filter(l => l.valid && l.ready);
    if (!ledgers.length) return null;
    const below = ledgers.filter(l => l.belowFloor);
    const lowest = ledgers.reduce((a, b) => (a.remainingHours <= b.remainingHours ? a : b));
    return {
      wakeTime: ledgers[0].profile.wakeTime,
      minSleep: ledgers[0].profile.minSleep,
      below: below.length,
      lowest: lowest.remainingHours
    };
  }, [plan.best, prefs.sleepEnabled, prefs.sleepWakeTime, prefs.sleepMinHours]);

  // 时间轴要高亮「入选的那几场」而不是「入选的夜晚」：同一晚可能既有精选也有落选。
  const bestIds = useMemo(() => new Set(plan.best.map(e => e.m.id)), [plan.best]);

  const kickoffGroupByMatch = useMemo(() => {
    const map = new Map();
    for (const group of plan.kickoffGroups || []) {
      for (const entry of group.entries) map.set(entry.m.id, group);
    }
    return map;
  }, [plan.kickoffGroups]);

  const activeDayObj = useMemo(
    () => (selectedDay ? days.find(d => d.date === selectedDay) || null : null),
    [selectedDay, days]
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
      {/* 夜猫周口径标题行 */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <SectionLabel
          hint="周一格从周一 06:00 起，含周二凌晨；周日格含周一凌晨（06:00 前归前一夜）。"
          right={<Meta num>{weekRange} 夜</Meta>}
          className="w-full"
        >
          本周熬夜规划
        </SectionLabel>
      </div>

      {sleepSummary && (
        <div className={`px-0.5 text-2xs ${sleepSummary.below > 0 ? 'text-warn' : 'text-text-muted'}`}>
          按 <span className="font-num tabular-nums">{sleepSummary.wakeTime}</span> 起床 ·{' '}
          {sleepSummary.below > 0
            ? `精选有 ${sleepSummary.below} 晚低于 ${sleepSummary.minSleep}h 底线，最低约剩 ${formatSleepHours(sleepSummary.lowest)}`
            : `精选均在 ${sleepSummary.minSleep}h 底线内`}
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
            <p className="text-center text-2xs text-text-faint">本周暂无未开赛场次</p>
          </div>
        ) : (
          <WeekTimeline
            days={days}
            bestIds={bestIds}
            selectedDay={selectedDay}
            onToggleDay={date => setSelectedDay(cur => (cur === date ? null : date))}
            sleepEnabled={prefs.sleepEnabled}
            wakeTime={prefs.sleepWakeTime}
            minSleep={prefs.sleepMinHours}
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
        key={`${activeTab}-${selectedDay || 'all'}`}
        className="scrollbar-thin -mr-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
      >
        {selectedDay && activeDayObj && (
          <div className="rounded-lg border border-accent/30 bg-surface-accent px-2.5 py-1.5 text-2xs text-text-primary">
            正在筛选：<span className="font-semibold text-accent">{zhDate(activeDayObj.date)} 夜</span>（共{' '}
            {activeDayObj.count} 场） · 点上方「清除」取消
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
