import { useMemo } from 'react';
import { VList } from 'virtua';
import { zhDate, weekdayOf } from '../core/format.js';
import { fixtures, LEAGUE_ORDER, LEAGUE_NAMES, leagueName } from '../data/index.js';
import { evalOne, stateOf } from '../core/owl.js';
import MatchRow from './MatchRow.jsx';
import { Pill, EmptyState } from './atoms.jsx';

/** 各联赛场次总数（静态，算一次） */
const LEAGUE_TOTALS = fixtures.reduce((acc, m) => {
  acc[m.l] = (acc[m.l] || 0) + 1;
  return acc;
}, {});

/**
 * 赛程视图（Schedule）
 * 全季 1,897 场的检索与浏览。长列表走虚拟滚动。
 */
export default function ScheduleView({
  rows,
  filters,
  onFiltersChange,
  prefs,
  now,
  activeMatchId,
  onSelect,
  revealed,
  onReveal
}) {
  const allSelected = filters.leagues.length === LEAGUE_ORDER.length;
  const matchCount = useMemo(() => rows.filter(r => r.type === 'match').length, [rows]);

  const set = patch => onFiltersChange({ ...filters, ...patch });

  const toggleLeague = code => {
    const has = filters.leagues.includes(code);
    const next = has ? filters.leagues.filter(x => x !== code) : [...filters.leagues, code];
    set({ leagues: next });
  };

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-hidden">
      {/* 搜索 */}
      <input
        type="text"
        value={filters.query}
        onChange={e => set({ query: e.target.value })}
        placeholder="搜索 111 支球队 / 联赛 / 场次 ID…"
        className="w-full rounded-md border border-border-subtle bg-surface-card px-3 py-2 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-border-strong focus:outline-none"
      />

      {/* 联赛筛选（七大联赛，含 SCG） */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => set({ leagues: [...LEAGUE_ORDER] })}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            allSelected
              ? 'border-primary-gold/50 bg-primary-gold/15 text-primary-gold'
              : 'border-border-subtle bg-surface-card text-slate-400 hover:text-slate-200'
          }`}
        >
          全部 {fixtures.length.toLocaleString()}
        </button>

        {LEAGUE_ORDER.map(code => {
          const on = filters.leagues.includes(code);
          return (
            <button
              key={code}
              type="button"
              onClick={() => toggleLeague(code)}
              title={code}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                on
                  ? 'border-primary-gold/50 bg-primary-gold/15 text-primary-gold'
                  : 'border-border-subtle bg-surface-card text-slate-500 hover:text-slate-300'
              }`}
            >
              {LEAGUE_NAMES[code]} {LEAGUE_TOTALS[code] ?? 0}
            </button>
          );
        })}
      </div>

      {/* 开关 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Toggle
            on={filters.onlyFollowed}
            onChange={v => set({ onlyFollowed: v })}
            label="只看关注球队"
            disabled={prefs.followedTeams.length === 0}
            hint={prefs.followedTeams.length === 0 ? '尚未设置关注球队' : undefined}
          />
          <Toggle
            on={prefs.spoilerFree}
            onChange={v => set({ spoilerFree: v })}
            label="防剧透模式"
          />
        </div>
        <span className="font-mono text-[10px] text-slate-500">命中 {matchCount.toLocaleString()} 场</span>
      </div>

      {/* 虚拟长列表 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="没有匹配的场次"
            desc="试着放宽筛选条件，或清空搜索关键词。"
          />
        ) : (
          <VList style={{ height: '100%' }} className="scrollbar-thin-dark">
            {rows.map(row => {
              if (row.type === 'date') {
                return (
                  <div key={row.key} className="sticky top-0 z-10 bg-surface-panel/95 py-1.5 backdrop-blur">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-slate-300">
                        {row.date} {weekdayOf(row.date)}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">{row.count} 场</span>
                    </div>
                  </div>
                );
              }

              const m = row.m;
              const { ev } = evalOne(m, prefs);
              return (
                <div key={row.key} className="pb-2">
                  <MatchRow
                    m={m}
                    state={stateOf(m, now)}
                    active={m.id === activeMatchId}
                    now={now}
                    onSelect={onSelect}
                    spoilerFree={prefs.spoilerFree}
                    revealed={revealed.has(m.id)}
                    onReveal={onReveal}
                    star={ev.star}
                    rivalry={ev.rivalry}
                  />
                </div>
              );
            })}
          </VList>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label, disabled = false, hint }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={hint}
      className={`flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
        disabled
          ? 'cursor-not-allowed border-border-subtle bg-surface-card text-slate-600'
          : on
            ? 'border-accent-teal/50 bg-accent-teal/15 text-accent-teal'
            : 'border-border-subtle bg-surface-card text-slate-400 hover:text-slate-200'
      }`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          disabled ? 'bg-slate-700' : on ? 'bg-accent-teal' : 'bg-slate-600'
        }`}
      />
      {label}
    </button>
  );
}
