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
  onPrefsChange,
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
    if (allSelected) {
      // 全选状态下，点击任一联赛即单选该联赛（符合主流体验）
      set({ leagues: [code] });
      return;
    }
    const has = filters.leagues.includes(code);
    const next = has ? filters.leagues.filter(x => x !== code) : [...filters.leagues, code];
    // 全部取消时兜底重置为全选
    set({ leagues: next.length === 0 ? [...LEAGUE_ORDER] : next });
  };

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-hidden">
      {/* 搜索框（带清空按钮与聚焦光晕，无生硬外框线） */}
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 text-[12px] text-text-dim">🔍</span>
        <input
          type="text"
          value={filters.query}
          onChange={e => set({ query: e.target.value })}
          placeholder="搜索 111 支球队 / 联赛 / 场次 ID…"
          className="w-full rounded-lg bg-surface-card/80 py-2 pl-8 pr-8 text-[12px] font-medium text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary-gold/40 shadow-2xs transition-all"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => set({ query: '' })}
            className="absolute right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface-hover text-[10px] text-text-muted hover:text-text-primary"
            title="清空搜索"
          >
            ✕
          </button>
        )}
      </div>

      {/* 联赛筛选（现代无框胶囊式设计） */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => set({ leagues: [...LEAGUE_ORDER] })}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-mono text-[10px] font-medium transition-all ${
            allSelected
              ? 'bg-primary-gold/20 text-primary-gold font-bold shadow-xs'
              : 'bg-surface-card/60 text-text-muted hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          全部 <span className={allSelected ? 'font-bold opacity-90' : 'opacity-75'}>{fixtures.length.toLocaleString()}</span>
        </button>

        {LEAGUE_ORDER.map(code => {
          const on = !allSelected && filters.leagues.includes(code);
          return (
            <button
              key={code}
              type="button"
              onClick={() => toggleLeague(code)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-mono text-[10px] font-medium transition-all ${
                on
                  ? 'bg-primary-gold/20 text-primary-gold font-bold shadow-xs'
                  : 'bg-surface-card/60 text-text-muted hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              <span>{LEAGUE_NAMES[code]}</span>
              <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${on ? 'bg-primary-gold/30 text-primary-gold' : 'bg-surface-hover text-text-dim'}`}>
                {LEAGUE_TOTALS[code] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* 开关与统计 */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            on={filters.onlyFollowed}
            onChange={v => set({ onlyFollowed: v })}
            label="只看关注"
            disabled={prefs.followedTeams.length === 0}
            hint={prefs.followedTeams.length === 0 ? '尚未设置关注球队' : undefined}
          />
          <Toggle
            on={prefs.spoilerFree}
            onChange={v => onPrefsChange({ ...prefs, spoilerFree: v })}
            label="防剧透"
          />
        </div>
        <span className="font-mono text-[10px] font-medium text-text-muted">
          命中 <b className="text-text-primary font-bold">{matchCount.toLocaleString()}</b> 场
        </span>
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
          <VList style={{ height: '100%' }} className="scrollbar-thin">
            {rows.map(row => {
              if (row.type === 'date') {
                return (
                  <div key={row.key} className="pt-2.5 pb-1.5 px-0.5 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold tracking-tight text-text-primary">
                          {row.date} {weekdayOf(row.date)}
                        </span>
                        <span className="rounded-full bg-surface-elevated/70 px-2 py-0.5 font-mono text-[9px] font-medium text-text-muted">
                          {row.count} 场比赛
                        </span>
                      </div>
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
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] font-medium transition-all ${
        disabled
          ? 'cursor-not-allowed bg-surface-card/30 text-text-dim opacity-50'
          : on
            ? 'bg-teal-500/15 text-accent-teal font-semibold shadow-xs'
            : 'bg-surface-card/60 text-text-muted hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full transition-colors ${
          disabled ? 'bg-text-dim' : on ? 'bg-accent-teal shadow-[0_0_6px_rgba(68,226,205,0.6)]' : 'bg-text-dim/60'
        }`}
      />
      {label}
    </button>
  );
}
