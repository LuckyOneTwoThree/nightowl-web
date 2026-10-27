import { useMemo, useState } from 'react';
import { zhDate, hmCost, hm } from '../core/format.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { stateOf } from '../core/owl.js';
import { nightOf, sleepTier } from '../core/engine.js';
import { Chip, Crest, Fieldset, Meta, SleepBadge, Stars } from './atoms.jsx';
import { IconChevronDown, IconChevronUp, IconWarn } from './icons.jsx';
import MatchRow from './MatchRow.jsx';

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 档位分布柱状图的色阶。
 *
 * 此前这里是四个随手挑的十六进制（#FF7A45 / #F59E0B / #0D9488 / #10B981），
 * 与 SleepBadge 上的档位色**对不上** —— 同一根柱子在两个位置表示同一件事却是两种颜色。
 * 改为按 cost 直接查档位，颜色复用 tier-0…tier-4 那条连续色阶，
 * 于是「周历上的红」与「徽章上的 S4」是同一个信号。
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
 * 分区之间用 hairline + 留白分隔，不再每块各套一个圆角盒子 ——
 * 此前"预算卡 + 精选卡 + 零成本卡 + 雷区卡 + 分布卡 + 备选卡"六个盒子并列，
 * 层级语义完全丧失（盒子深浅本来只代表可交互性）。
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
  const [showZero, setShowZero] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const { plan, minefield, days, advice } = week;
  const hasScheduledMatches = days.some(day => day.count > 0);
  const usedRatio = plan.budget > 0 ? plan.used / plan.budget : 0;
  const remain = Math.max(0, plan.budget - plan.used);
  const bestDaySet = useMemo(() => {
    const s = new Set();
    for (const e of plan.best) {
      s.add(nightOf(e.m.t));
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      {/* ---- 睡眠预算 ---- */}
      <section className="overflow-hidden rounded-xl border border-line-hairline bg-surface-card">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="flex h-11 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-surface-raised/50"
        >
          <span className="shrink-0 text-2xs font-medium text-text-muted">睡眠预算</span>
          <span className="shrink-0 font-num text-sm font-semibold tabular-nums text-resource">
            {hmCost(plan.budget)}
          </span>
          <Meta num className="truncate">
            已用 {hmCost(plan.used)}（{(usedRatio * 100).toFixed(0)}%）· 结余 {hmCost(remain)}
          </Meta>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-2xs text-text-muted">
            {expanded ? '收起' : '调整'}
            {expanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          </span>
        </button>

        {plan.budget > 0 && (
          <div className="px-3 pb-2.5">
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
          <div className="border-t border-line-hairline px-3 py-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-num text-xl font-bold tabular-nums text-resource">
                {plan.budget.toFixed(1)}
              </span>
              <span className="text-2xs text-text-muted">小时 / 周</span>
            </div>

            <input
              type="range"
              min="0"
              max="8"
              step="0.5"
              value={plan.budget}
              onChange={e => onBudgetChange(Number(e.target.value))}
              className="mt-2.5 w-full accent-[rgb(69_191_174)]"
              aria-label="每周熬夜预算（小时）"
            />

            <div className="mt-1 flex justify-between font-num text-2xs tabular-nums text-text-faint">
              <span>0h</span>
              <span>4h</span>
              <span>8h</span>
            </div>
          </div>
        )}
      </section>

      <div className="scrollbar-thin -mr-1 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* ---- 算法精选 ---- */}
        <Fieldset
          title="本周精选"
          hint={PLAN_HINT}
          right={<Meta num>{plan.best.length} / 5</Meta>}
        >
          {plan.best.length === 0 ? (
            <div className="rounded-lg border border-line-hairline bg-surface-raised/30 px-3 py-3.5 text-center">
              <p className="text-xs font-medium text-text-secondary">
              {!hasScheduledMatches
                  ? '本周暂无比赛'
                  : plan.evs.length === 0
                    ? '本周暂无可安排的未开赛场次'
                    : '当前预算下暂未选出场次'}
              </p>
              {plan.evs.length > 0 && (
                <button
                  type="button"
                  onClick={() => onBudgetChange(Math.min(8, plan.budget + 1))}
                  disabled={plan.budget >= 8}
                  className="mt-1.5 rounded-md px-2 py-1 text-2xs font-medium text-accent transition-colors hover:bg-surface-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {plan.budget >= 8 ? '预算已达上限' : '预算增加 1 小时'}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {plan.best.map(e => (
                <PickRow
                  key={e.m.id}
                  e={e}
                  active={e.m.id === activeMatchId}
                  kickoffGroup={kickoffGroupByMatch.get(e.m.id)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </Fieldset>

        {/* ---- 零成本顺带 ---- */}
        {plan.zeroCount > 0 && (
          <Fieldset
            title="零成本顺带"
            hint="这些场次开球在睡前，睡眠成本 0 小时：不占额度，也不算精选名额。"
            right={
              <button
                type="button"
                onClick={() => setShowZero(v => !v)}
                aria-expanded={showZero}
                className="inline-flex items-center gap-1 text-2xs text-text-muted transition-colors hover:text-text-primary"
              >
                {plan.zeroCount} 场
                {showZero ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
              </button>
            }
          >
            {showZero && (
              <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto pr-1">
                {plan.zeroList.slice(0, 40).map(e => (
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
                  />
                ))}
              </div>
            )}
          </Fieldset>
        )}

        {/* ---- 雷区预警 ---- */}
        {minefield.length > 0 && (
          <Fieldset
            title="本周雷区"
            hint="高代价但看点不足的场次：熬夜性价比最低，建议放弃或直接睡觉。"
            right={<Meta num>{minefield.length} 场</Meta>}
          >
            <div className="space-y-1">
              {minefield.slice(0, 4).map(e => (
                <button
                  key={e.m.id}
                  type="button"
                  onClick={() => onSelect(e.m.id)}
                  className="w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-raised"
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
                  <p className="mt-1 truncate text-xs text-text-secondary">
                    {teamName(e.m.h)} vs {teamName(e.m.a)}
                  </p>
                  <p className="mt-0.5 truncate text-2xs text-text-faint">{e.reason}</p>
                </button>
              ))}
            </div>
          </Fieldset>
        )}

        {/* ---- 档位分布 ---- */}
        <Fieldset
          title="本周熬夜分布"
          hint="柱子高度 = 当天最晚那场球的睡眠成本；颜色与档位徽章同一色阶。点击单日可查看当日场次。"
          right={<Meta>按当日最高档位</Meta>}
        >
          {!hasScheduledMatches ? (
            <p className="rounded-lg border border-dashed border-line-hairline px-3 py-4 text-center text-xs text-text-muted">
              本周暂无未开赛场次，暂无分布数据
            </p>
          ) : (
            <div className="flex items-end justify-between gap-1.5">
              {days.map((d, i) => {
                const h = d.count === 0 ? 3 : Math.max(8, (d.cost / 4.5) * 60);
                const hasBest = bestDaySet.has(d.date);
                const isSelected = selectedDay === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelectedDay(cur => (cur === d.date ? null : d.date))}
                    aria-pressed={isSelected}
                    className={`flex flex-1 flex-col items-center gap-1 rounded-md py-1 transition-colors ${
                      isSelected ? 'bg-surface-raised ring-1 ring-accent/40' : 'hover:bg-surface-raised/50'
                    }`}
                  >
                    <span className="flex h-2 items-center justify-center">
                      {hasBest && (
                        <span
                          className="h-1 w-1 rounded-full bg-accent"
                          title="包含本周精选场次"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <div className="flex w-full flex-col items-center justify-end gap-0.5 px-1" style={{ height: 60 }}>
                      {d.count > 0 && (
                        <span className="font-num text-2xs tabular-nums text-text-faint">{hmCost(d.cost)}</span>
                      )}
                      <div
                        className={`w-full rounded-sm transition-all ${
                          d.count === 0 ? 'bg-line-hairline' : `${BUCKET_CLASS[bucketOf(d.cost)]} opacity-90`
                        } ${i === 0 && !isSelected ? 'ring-1 ring-accent/35' : ''}`}
                        style={{ height: h }}
                        title={`${zhDate(d.date)} · ${d.count} 场 · 最高 ${hmCost(d.cost)}`}
                      />
                    </div>
                    <span className={`text-2xs ${isSelected ? 'font-semibold text-accent' : 'text-text-faint'}`}>
                      周{WEEKDAY_SHORT[i]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {activeDayObj && (
            <div className="mt-2.5 rounded-lg border border-line-hairline bg-surface-card/70 p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-2xs font-medium text-text-primary">
                  {zhDate(activeDayObj.date)} · {activeDayObj.count} 场未开赛
                </span>
                <Meta num>最高消耗 {hmCost(activeDayObj.cost)}</Meta>
              </div>
              {activeDayObj.matches?.length > 0 ? (
                <div className="space-y-0.5">
                  {activeDayObj.matches.slice(0, 5).map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelect(m.id)}
                      className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                        m.id === activeMatchId ? 'bg-surface-raised' : 'hover:bg-surface-raised/60'
                      }`}
                    >
                      <span className="w-9 shrink-0 font-num text-2xs tabular-nums text-text-secondary">
                        {hm(m.t)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-2xs text-text-primary">
                        {teamName(m.h)} vs {teamName(m.a)}
                      </span>
                      <SleepBadge match={m} compact />
                    </button>
                  ))}
                </div>
              ) : (
                <Meta>当日暂无未开赛场次</Meta>
              )}
            </div>
          )}
          {hasScheduledMatches && (
            <p className="mt-2.5 text-2xs leading-relaxed text-text-secondary">{advice}</p>
          )}
        </Fieldset>

        {/* ---- 备选 ---- */}
        {plan.alt.length > 0 && (
          <Fieldset
            title="备选"
            hint="落选通常是因为本周名额或预算已满，或单场睡眠成本偏高。"
            right={<Meta num>{plan.alt.length}</Meta>}
          >
            <div className="space-y-0.5">
              {plan.alt.map(e => (
                <button
                  key={e.m.id}
                  type="button"
                  onClick={() => onSelect(e.m.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface-raised"
                >
                  <Meta num className="shrink-0">
                    {e.m.t.slice(5, 10).replace('-', '/')} {e.m.t.split('T')[1]}
                  </Meta>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                    {teamName(e.m.h)} vs {teamName(e.m.a)}
                  </span>
                  <span className="shrink-0 font-num text-2xs tabular-nums text-text-muted">
                    {e.index.toFixed(1)}
                  </span>
                </button>
              ))}
            </div>
          </Fieldset>
        )}
      </div>
    </div>
  );
}

/**
 * 背包入选行
 *
 * 与 MatchRow 的区别只有一件事：这里要说明**为什么入选**，
 * 所以多一排列选理由，其余版式与 MatchRow 同构（时刻列 + 对阵 + 右侧数值）。
 */
function PickRow({ e, active, kickoffGroup, onSelect }) {
  const m = e.m;
  const groupAlternatives = kickoffGroup
    ? kickoffGroup.entries.filter(x => x.m.id !== m.id)
    : [];
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
      className={`relative w-full overflow-hidden rounded-lg py-2 pr-2.5 pl-3 text-left transition-all ${
        active
          ? 'border border-accent/35 bg-surface-raised shadow-card'
          : 'border border-transparent hover:border-line-hairline hover:bg-surface-raised/60'
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
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-2xs text-text-muted">{leagueName(m.l)}</span>
            <SleepBadge match={m} compact />
            {/* 列表已按指数排序，行内不需要再用品牌金重复强调 —— 一屏四行同时金色等于没有金色 */}
            <span className="ml-auto shrink-0 font-num text-xs font-semibold tabular-nums text-text-primary">
              {e.index.toFixed(1)}
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
            {/* 入选理由只有一处需要解释，所以用文字而不是又一个胶囊 */}
            <span className="min-w-0 truncate text-2xs text-text-faint">{reason}</span>
            <Meta num className="ml-auto shrink-0">
              {m.t.slice(5, 10).replace('-', '/')} · {sleepTier(m.t).cost}h
            </Meta>
          </div>
          {groupAlternatives.length > 0 && (
            <div className="mt-1 flex items-center gap-1 text-2xs text-warn">
              <IconWarn size={11} />
              <span className="shrink-0">同时开球 · 只能看一场</span>
              <span
                className="min-w-0 truncate text-text-faint"
                title={groupAlternatives
                  .map(x => `${teamName(x.m.h)} vs ${teamName(x.m.a)}`)
                  .join('、')}
              >
                · 组内 {kickoffGroup.entries.length} 场，其余不同时看
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
