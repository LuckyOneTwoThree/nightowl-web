import { useMemo, useState } from 'react';
import { zhDate, hmCost, hm } from '../core/format.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { stateOf } from '../core/owl.js';
import { owlDay, sleepTier, PRODUCT_PLAN_OPTS } from '../core/engine.js';
import { formatSleepHours, sleepLedger } from '../core/sleep.js';
import { Chip, Crest, Hint, Meta, SectionLabel, SleepBadge, Stars } from './atoms.jsx';
import { IconChevronDown, IconChevronUp, IconClose, IconWarn } from './icons.jsx';
import MatchRow from './MatchRow.jsx';

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

/** 精选名额上限以算法配置为唯一出处，界面不再手写 /5 */
const PLAN_MAX_PICKS = PRODUCT_PLAN_OPTS.maxPicks;

/**
 * 档位分布柱状图的色阶。
 * 复用 tier-0…tier-4 连续色阶，使「周历上的柱子」与「徽章上的 S0–S4」完全一致。
 */
const BUCKET_CLASS = ['bg-tier-0', 'bg-tier-1', 'bg-tier-2', 'bg-tier-3', 'bg-tier-4'];

function bucketOf(cost) {
  if (cost >= 4.5) return 4;
  if (cost >= 3.5) return 3;
  if (cost >= 2.5) return 2;
  if (cost >= 1) return 1;
  return 0;
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

  const bestDaySet = useMemo(() => {
    const s = new Set();
    for (const e of plan.best) {
      s.add(owlDay(e.m.t));
    }
    return s;
  }, [plan.best]);

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

        {/* 内嵌 7 晚熬夜负荷柱 */}
        <div className="border-t border-line-hairline px-2.5 pt-2 pb-2">
          <div className="mb-1 flex items-center justify-between px-0.5">
            <span className="text-2xs font-medium text-text-muted">7 晚熬夜负荷（点击单晚筛选）</span>
            {selectedDay ? (
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-medium text-accent transition-colors hover:bg-surface-accent focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
              >
                <span>清除 {selectedDay.slice(5).replace('-', '/')}</span>
                <IconClose size={10} />
              </button>
            ) : (
              <Hint
                content="柱子高度代表当晚最晚场次的睡眠成本，颜色对应 S0–S4 档位，圆点代表含本周精选场次。点击任意一晚可过滤下方列表。"
                align="end"
              />
            )}
          </div>

          {!hasScheduledMatches ? (
            <p className="py-2 text-center text-2xs text-text-faint">本周暂无未开赛场次</p>
          ) : (
            <div className="flex items-end justify-between gap-1">
              {days.map((d, i) => {
                const h = d.count === 0 ? 3 : Math.max(6, (d.cost / 4.5) * 38);
                const hasBest = bestDaySet.has(d.date);
                const isSelected = selectedDay === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelectedDay(cur => (cur === d.date ? null : d.date))}
                    aria-pressed={isSelected}
                    aria-label={`${zhDate(d.date)} 周${WEEKDAY_SHORT[i]}，${d.count} 场，最高 ${hmCost(d.cost)}`}
                    className={`flex flex-1 flex-col items-center gap-0.5 rounded-md py-1 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer ${
                      isSelected ? 'bg-surface-raised ring-1 ring-accent/50' : 'hover:bg-surface-raised/60'
                    }`}
                  >
                    <span className="flex h-1.5 items-center justify-center">
                      {hasBest && (
                        <span
                          className="h-1 w-1 rounded-full bg-accent"
                          title="包含本周精选场次"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <div className="flex w-full flex-col items-center justify-end gap-0.5 px-1" style={{ height: 42 }}>
                      {d.count > 0 && (
                        <span className="font-num text-2xs leading-none tabular-nums text-text-faint">
                          {hmCost(d.cost)}
                        </span>
                      )}
                      <div
                        className={`w-full rounded-sm transition-all ${
                          d.count === 0 ? 'bg-line-hairline' : `${BUCKET_CLASS[bucketOf(d.cost)]} opacity-90`
                        }`}
                        style={{ height: h }}
                        title={`${zhDate(d.date)} · ${d.count} 场 · 最高 ${hmCost(d.cost)}`}
                      />
                    </div>
                    <span
                      className={`font-num text-2xs leading-tight tabular-nums ${
                        isSelected ? 'font-semibold text-accent' : 'text-text-secondary'
                      }`}
                    >
                      周{WEEKDAY_SHORT[i]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
                      <span className="shrink-0 font-num text-2xs tabular-nums text-text-secondary">
                        指数 {e.index.toFixed(1)}
                      </span>
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
              <span className="shrink-0 font-num text-2xs tabular-nums text-text-muted">
                指数 {x.index.toFixed(1)}
              </span>
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
            <span className="ml-auto shrink-0 font-num text-xs font-semibold tabular-nums text-text-primary">
              指数 {e.index.toFixed(1)}
            </span>
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
