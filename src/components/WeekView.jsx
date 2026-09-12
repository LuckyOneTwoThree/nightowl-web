import { useState } from 'react';
import { zhDate, weekdayOf, hmCost } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { evalOne, stateOf } from '../core/owl.js';
import { Crest, SleepBadge, Stars, Pill, SectionLabel } from './atoms.jsx';
import MatchRow from './MatchRow.jsx';

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 本周视图（Week）
 *
 * 关键口径（D8）：背包**数量上限 5**，且**零成本场次不进背包**——单独展示为「零成本顺带」。
 * 额度只用来约束熬夜，不约束"顺便看一眼"。
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

  const { plan, minefield, days, advice, weekStartStr } = week;
  const usedRatio = plan.budget > 0 ? plan.used / plan.budget : 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* ---- 预算规划器（手风琴双模态）---- */}
      <section
        className={`rounded-xl transition-all duration-200 shadow-card ${
          expanded
            ? 'bg-surface-card shadow-md'
            : 'bg-surface-card hover:bg-surface-hover'
        }`}
      >
        {/* 紧凑态：单行胶囊 */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex h-10 w-full items-center justify-between px-3.5 text-left"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
            <span className="shrink-0 font-headline text-[12px] font-bold text-text-primary">睡眠预算</span>
            <span className="shrink-0 font-mono text-[13px] font-extrabold tabular-nums text-teal-600 dark:text-accent-teal">
              {hmCost(plan.budget)}
            </span>
            <span className="truncate font-mono text-[10px] text-text-muted">
              · 占 {hmCost(plan.used)}（{(usedRatio * 100).toFixed(0)}%）
            </span>
          </div>
          <span className="shrink-0 font-mono text-[10px] font-medium text-text-muted hover:text-text-primary">
            {expanded ? '收起 ▴' : '规划 ▾'}
          </span>
        </button>

        {/* 展开态 */}
        {expanded && (
          <div className="border-t border-white/[0.04] px-3.5 py-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[22px] font-extrabold tabular-nums text-teal-600 dark:text-accent-teal">
                {plan.budget.toFixed(1)}
                <span className="ml-1 text-[12px] font-normal text-text-muted">小时 / 周</span>
              </span>
              <span className="font-mono text-[10px] font-medium text-text-muted">
                结余 {hmCost(Math.max(0, plan.budget - plan.used))} · 单周上限 5
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="8"
              step="0.5"
              value={plan.budget}
              onChange={e => onBudgetChange(Number(e.target.value))}
              className="mt-2.5 w-full accent-[#0D9488] dark:accent-[#44E2CD]"
              aria-label="每周熬夜预算（小时）"
            />

            {/* 档位刻度 */}
            <div className="mt-1 flex justify-between font-mono text-[9px] font-medium text-text-dim">
              <span>0h</span>
              <span>S1 1h</span>
              <span>S2 2.5h</span>
              <span>S3 3.5h</span>
              <span>S4 4.5h</span>
              <span>8h</span>
            </div>

            <p className="mt-2.5 rounded-lg bg-surface-elevated/50 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-text-secondary">
              DP 规划：预算内入选 <b className="text-text-primary">{plan.best.length}</b> 场 · 占用{' '}
              <b className="text-text-primary">{hmCost(plan.used)}</b> · 结余{' '}
              {hmCost(Math.max(0, plan.budget - plan.used))}
            </p>
          </div>
        )}
      </section>

      <div className="scrollbar-thin -mr-1 flex-1 space-y-3 overflow-y-auto pr-1">
        {/* ---- 算法精选组合 ---- */}
        <section>
          <SectionLabel right={<span className="font-mono text-[10px] text-text-muted">上限 5 场</span>}>
            算法精选组合（预算内）
          </SectionLabel>

          <div className="mt-2 space-y-2">
            {plan.best.length === 0 && (
              <p className="rounded-lg bg-surface-card/50 px-3 py-3 text-center text-[11px] text-text-muted shadow-xs">
                当前额度下没有可入包的场次。试着提高预算，或查看下方的零成本场次。
              </p>
            )}
            {plan.best.map(e => (
              <PickRow
                key={e.m.id}
                e={e}
                active={e.m.id === activeMatchId}
                onSelect={onSelect}
                prefs={prefs}
              />
            ))}
          </div>
        </section>

        {/* ---- 零成本顺带（不占预算）---- */}
        {plan.zeroCount > 0 && (
          <section className="rounded-xl bg-surface-card/60 p-2.5 shadow-xs">
            <SectionLabel
              right={
                <button
                  type="button"
                  onClick={() => setShowZero(v => !v)}
                  className="font-mono text-[10px] font-medium text-text-muted hover:text-text-primary"
                >
                  {showZero ? '收起 ▴' : '展开 ▾'}
                </button>
              }
            >
              零成本顺带 · {plan.zeroCount} 场（不占预算）
            </SectionLabel>

            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
              这些场次睡眠成本为 0，不计入熬夜额度，也不占用精选名额。
            </p>

            {showZero && (
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin-dark">
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
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ---- 雷区预警 ---- */}
        {minefield.length > 0 && (
          <section>
            <SectionLabel>本周雷区预警 · {minefield.length} 场</SectionLabel>
            <div className="mt-2 space-y-1.5">
              {minefield.slice(0, 4).map(e => (
                <div
                  key={e.m.id}
                  className="rounded-lg bg-danger-orange/[0.08] p-2.5 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px] font-semibold text-text-primary">
                      {zhDate(e.m.t.split('T')[0])} {e.m.t.split('T')[1]} {teamName(e.m.h)} vs {teamName(e.m.a)}
                    </span>
                    <Pill tone="warn">⚠ 建议睡觉</Pill>
                  </div>
                  <p className="mt-1 text-[10px] font-medium text-danger-orange/90">{e.reason}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- 周历透视 ---- */}
        <section>
          <SectionLabel right={<span className="font-mono text-[10px] text-text-muted">按当日最高档位</span>}>
            本周档位分布
          </SectionLabel>

          <div className="mt-2 rounded-xl bg-surface-card p-3 shadow-card">
            <div className="flex items-end justify-between gap-1.5" style={{ height: 68 }}>
              {days.map((d, i) => {
                const h = d.count === 0 ? 4 : Math.max(8, (d.cost / 4.5) * 62);
                const color =
                  d.cost >= 3.5
                    ? '#FF7A45'
                    : d.cost >= 2.5
                      ? '#F59E0B'
                      : d.cost >= 1
                        ? '#0D9488'
                        : '#10B981';
                return (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                    <div
                      className={`w-full rounded-sm transition-all ${d.count === 0 ? 'bg-border-subtle opacity-60' : 'opacity-90 hover:opacity-100'}`}
                      style={{
                        height: h,
                        backgroundColor: d.count === 0 ? undefined : color
                      }}
                      title={`${zhDate(d.date)} · ${d.count} 场 · 最高 ${hmCost(d.cost)}`}
                    />
                    <span className="font-mono text-[9px] font-medium text-text-muted">周{WEEKDAY_SHORT[i]}</span>
                  </div>
                );
              })}
            </div>

            <p className="mt-3 border-t border-white/[0.04] pt-2.5 text-[10px] leading-relaxed text-text-secondary">
              {advice}
            </p>
          </div>
        </section>

        {/* ---- 备选 ---- */}
        {plan.alt.length > 0 && (
          <section>
            <SectionLabel>备选（未入包）</SectionLabel>
            <div className="mt-2 space-y-1.5">
              {plan.alt.map(e => (
                <button
                  key={e.m.id}
                  type="button"
                  onClick={() => onSelect(e.m.id)}
                  className="flex w-full items-center justify-between rounded-lg bg-surface-card/70 px-2.5 py-2 text-left transition-colors hover:bg-surface-hover shadow-2xs hover:shadow-xs"
                >
                  <span className="truncate font-mono text-[10px] font-medium text-text-secondary">
                    {e.m.t.split('T')[1]} {teamName(e.m.h)} vs {teamName(e.m.a)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] font-semibold text-text-muted">指数 {e.index.toFixed(1)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** 背包入选行（含入选理由标签） */
function PickRow({ e, active, onSelect, prefs }) {
  const m = e.m;
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
      className={`relative w-full rounded-lg px-3 py-2 text-left transition-all duration-150 ${
        active
          ? 'bg-primary-gold/15 shadow-xs'
          : 'bg-surface-card/70 hover:bg-surface-hover shadow-2xs hover:shadow-xs'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-primary-gold" />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Crest id={m.h} size={20} />
          <span className="truncate text-[12px] font-medium text-text-primary">{teamName(m.h)}</span>
          <span className="shrink-0 font-mono text-[10px] text-text-muted">vs</span>
          <span className="truncate text-[12px] font-medium text-text-primary">{teamName(m.a)}</span>
          <Crest id={m.a} size={20} />
        </div>
        <span className="shrink-0 font-mono text-[11px] font-extrabold tabular-nums text-primary-gold">
          {e.index.toFixed(1)}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <SleepBadge match={m} />
        <Stars star={e.ev.star} />
        <Pill tone="teal">{reason}</Pill>
        <span className="font-mono text-[9px] text-text-muted">
          {zhDate(m.t.split('T')[0])} {m.t.split('T')[1]} · {leagueName(m.l)}
        </span>
      </div>
    </button>
  );
}
