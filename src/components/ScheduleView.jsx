import { useMemo, useState } from 'react';
import { VList } from 'virtua';
import { weekdayOf } from '../core/format.js';
import { fixtures, LEAGUE_ORDER, LEAGUE_NAMES, leagueColor } from '../data/index.js';
import { evalOne, stateOf, defaultScheduleFilters, dayCounts, owlDayOffset } from '../core/owl.js';
import * as E from '../core/engine.js';
import MatchRow from './MatchRow.jsx';
import { EmptyState, Meta, TogglePill } from './atoms.jsx';
import { IconClose, IconSearch } from './icons.jsx';

/** 各联赛场次总数（静态，算一次） */
const LEAGUE_TOTALS = fixtures.reduce((acc, m) => {
  acc[m.l] = (acc[m.l] || 0) + 1;
  return acc;
}, {});

const TOTAL = fixtures.length.toLocaleString();

/** 筛选器口径要能查到，但不该常驻在版面里解释自己 */
const LEAGUE_HINT = '这里是「看哪些联赛」，与设置里的「关注联赛」是两件事：后者影响算法排序加 8 分，前者只是过滤显示。';

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

  /* ---- 日期导航 ----
     主流产品（FotMob / 懂球帝）的赛程页都是「日期条 + 当日比赛」，
     而不是 1897 场的瀑布流。date=null 表示今天；'all' 保留全季列表（规划视图）。 */
  const [showAll, setShowAll] = useState(filters.date === 'all');

  const selDate = filters.date && filters.date !== 'all' ? filters.date : owlDayOffset(0, now);

  const dayStrip = useMemo(() => {
    const counts = dayCounts();
    // 今天排第一（用户要求），只向后看 34 天；「全部」按钮移到日期条末尾
    return Array.from({ length: 34 }, (_, i) => {
      const d = owlDayOffset(i, now);
      return { date: d, count: counts[d] || 0, isToday: i === 0 };
    });
  }, [now]);

  // 当日比赛按联赛分组（date 模式不用虚拟滚动 —— 一天就十几场）
  const dayGroups = useMemo(() => {
    if (showAll) return null;
    const matches = rows
      .filter(r => r.type === 'match')
      .map(r => r.m)
      .filter(m => E.owlDay(m.t) === selDate)
      .sort((a, b) => E.ts(a.t) - E.ts(b.t));
    const groups = [];
    for (const code of LEAGUE_ORDER) {
      const list = matches.filter(m => m.l === code);
      if (list.length) groups.push({ code, list });
    }
    // 筛选后可能剩下非六大联赛的场次（如搜索命中的），兜底一组
    const rest = matches.filter(m => !groups.some(g => g.code === m.l));
    if (rest.length) groups.push({ code: null, list: rest });
    return { matches, groups };
  }, [rows, selDate, showAll]);

  const dayMatchCount = dayGroups?.matches.length ?? 0;

  const set = patch => onFiltersChange({ ...filters, ...patch });

  const setDate = d => {
    if (d === 'all') {
      setShowAll(true);
      set({ date: 'all' });
    } else {
      setShowAll(false);
      set({ date: d });
    }
  };

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
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      {/* 搜索 */}
      <div className="relative flex items-center">
        <IconSearch size={13} className="pointer-events-none absolute left-2.5 text-text-faint" />
        <input
          type="text"
          value={filters.query}
          onChange={e => set({ query: e.target.value })}
          placeholder="搜索球队 / 联赛 / 场次 ID"
          className="w-full rounded-md border border-line-hairline bg-surface-card py-1.5 pl-8 pr-8 text-xs text-text-primary placeholder:text-text-faint focus:border-accent/50 focus:outline-none"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => set({ query: '' })}
            aria-label="清空搜索"
            title="清空搜索"
            className="absolute right-2 inline-flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-raised hover:text-text-primary"
          >
            <IconClose size={12} />
          </button>
        )}
      </div>

      {/* 日期导航条：默认选中今天且**今天排第一**（此前今天落在第 4 位，视线先落在过去几天上）；
          「全部」（全季列表）移到末尾，不抢首位 */}
      <div className="scrollbar-thin -mx-0.5 flex items-stretch gap-1 overflow-x-auto pb-0.5">
        {dayStrip.map(({ date, count, isToday }) => {
          const active = !showAll && date === selDate;
          return (
            <button
              key={date}
              type="button"
              onClick={() => setDate(date)}
              aria-pressed={active}
              className={`relative shrink-0 rounded-md border px-2 py-1 text-center transition-colors ${
                active
                  ? 'border-accent/60 bg-accent/15'
                  : 'border-line-hairline bg-surface-card hover:border-accent/40'
              }`}
            >
              <div
                className={`font-num text-2xs font-semibold tabular-nums ${
                  active ? 'text-accent' : isToday ? 'text-text-primary' : 'text-text-secondary'
                }`}
              >
                {isToday ? '今天' : date.slice(5).replace('-', '/')}
              </div>
              <div className="text-2xs text-text-faint">
                {count > 0 ? `${count} 场` : '—'}
              </div>
            </button>
          );
        })}

        {/* 「全部」放末尾：全季列表是规划视图，不该抢日期条的首位 */}
        <button
          type="button"
          onClick={() => setDate('all')}
          aria-pressed={showAll}
          className={`ml-1 shrink-0 rounded-md border px-2.5 py-1 font-ui text-2xs transition-colors ${
            showAll
              ? 'border-accent/60 bg-accent/15 text-accent'
              : 'border-line-hairline bg-surface-card text-text-secondary hover:border-accent/40'
          }`}
        >
          全部
        </button>
      </div>

      {/* 联赛筛选：色条即 MatchRow 的联赛身份条，两处同一颜色即同一联赛 */}
      <div className="flex flex-wrap items-center gap-1">
        <TogglePill
          on={allSelected}
          onClick={() => set({ leagues: [...LEAGUE_ORDER] })}
          label="全部"
          count={TOTAL}
          hint={LEAGUE_HINT}
        />
        {LEAGUE_ORDER.map(code => (
          <TogglePill
            key={code}
            on={!allSelected && filters.leagues.includes(code)}
            onClick={() => toggleLeague(code)}
            label={LEAGUE_NAMES[code]}
            count={LEAGUE_TOTALS[code] ?? 0}
            color={leagueColor(code)}
          />
        ))}
      </div>

      {/* 开关与命中数 */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <TogglePill
            role="switch"
            aria-checked={filters.onlyFollowed}
            on={filters.onlyFollowed}
            onClick={() => set({ onlyFollowed: !filters.onlyFollowed })}
            label="只看关注"
            disabled={prefs.followedTeams.length === 0}
            hint={prefs.followedTeams.length === 0 ? '尚未设置关注球队' : undefined}
          />
          <TogglePill
            role="switch"
            aria-checked={prefs.spoilerFree}
            on={prefs.spoilerFree}
            onClick={() => onPrefsChange({ ...prefs, spoilerFree: !prefs.spoilerFree })}
            label="防剧透"
            hint="开启后已赛场次只给「揭晓」入口，不直接显示比分"
          />
        </div>
        <Meta num>命中 {matchCount.toLocaleString()} 场</Meta>
      </div>

      {/* 列表区：date 模式按联赛分组渲染当日；all 模式虚拟滚动全季 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!showAll ? (
          dayMatchCount === 0 ? (
            <EmptyState
              icon={<IconSearch size={22} />}
              title={`${selDate}（${weekdayOf(selDate)}）没有匹配的场次`}
              desc="换个日期，或点「全部」查看全季赛程。"
              action={
                <button
                  type="button"
                  onClick={() => setDate('all')}
                  className="text-2xs text-accent underline underline-offset-2"
                >
                  查看全部赛程
                </button>
              }
            />
          ) : (
            <div className="scrollbar-thin h-full overflow-y-auto pr-1">
              {dayGroups.groups.map(g => (
                <div key={g.code || '__rest__'} className="mb-2">
                  {g.code && (
                    <div className="flex items-center gap-2 pb-1 pt-1.5">
                      <span className="h-3 w-0.5 rounded" style={{ background: leagueColor(g.code) }} />
                      <span className="text-2xs font-semibold text-text-secondary">
                        {LEAGUE_NAMES[g.code]}
                      </span>
                      <span className="font-num text-2xs tabular-nums text-text-faint">
                        {g.list.length} 场
                      </span>
                    </div>
                  )}
                  {g.list.map(m => {
                    const { ev } = evalOne(m, prefs);
                    return (
                      <div className="pb-0.5" key={m.id}>
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
                </div>
              ))}
            </div>
          )
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconSearch size={22} />}
            title="没有匹配的场次"
            desc="放宽筛选或清空关键词即可。"
            action={
              <button
                type="button"
                onClick={() => onFiltersChange(defaultScheduleFilters())}
                className="text-2xs text-accent underline underline-offset-2"
              >
                重置筛选
              </button>
            }
          />
        ) : (
          /* data 模式：渲染函数只对**可见行**执行。
             children 模式下 rows.map 会先创建全部 2000+ 个 React 元素 ——
             本组件每次重渲染都要付这笔钱（此前 App 每秒 tick 时实测持续 ~9% CPU）。 */
          <VList data={rows} style={{ height: '100%' }} className="scrollbar-thin">
            {row => {
              if (row.type === 'date') {
                return (
                  <div className="flex items-baseline gap-2 pb-1.5 pt-3">
                    <span className="font-num text-xs font-semibold tabular-nums text-text-secondary">
                      {row.date}
                    </span>
                    <span className="text-2xs text-text-faint">{weekdayOf(row.date)}</span>
                    <span className="ml-auto font-num text-2xs tabular-nums text-text-faint">
                      {row.count} 场
                    </span>
                  </div>
                );
              }

              const m = row.m;
              const { ev } = evalOne(m, prefs);
              return (
                <div className="pb-0.5">
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
            }}
          </VList>
        )}
      </div>
    </div>
  );
}
