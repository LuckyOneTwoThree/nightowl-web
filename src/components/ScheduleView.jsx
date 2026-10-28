import { useMemo, useRef, useEffect, useState } from 'react';
import { VList } from 'virtua';
import { weekdayOf } from '../core/format.js';
import { getFixtures, LEAGUE_ORDER, LEAGUE_NAMES, leagueColor } from '../data/index.js';
import { evalOne, stateOf, defaultScheduleFilters, owlDayOffset } from '../core/owl.js';
import * as E from '../core/engine.js';
import MatchRow from './MatchRow.jsx';
import { Button, EmptyState, Hint, Meta, SectionLabel, SwitchField, TogglePill } from './atoms.jsx';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFilter,
  IconSearch,
  IconStandings
} from './icons.jsx';

/**
 * 各联赛场次总数
 *
 * ⚠️ 必须在组件内按当前数据算，不能用模块级 import { fixtures } 算一次：
 * setFixtures 换的是 data/index.js 内部的 _fixtures，模块级绑定永远停在
 * 构建期快照 —— 于是出现「命中 1900 场 / 全部 1897 场」的自相矛盾
 * （列表 rows 走 getFixtures 是新数据，药丸计数是旧的）。
 */

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
  onReveal,
  onOpenStandings
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterBtnRef = useRef(null);
  const filterCloseRef = useRef(null);
  const allSelected = filters.leagues.length === LEAGUE_ORDER.length;
  const activeFilterCount = (allSelected ? 0 : 1) + (filters.onlyFollowed ? 1 : 0);
  const filterKey = `${filters.query}|${filters.leagues.join(',')}|${filters.onlyFollowed ? 1 : 0}`;
  const matchCount = useMemo(() => rows.filter(r => r.type === 'match').length, [rows]);
  const standingsLeague = useMemo(() => {
    const supported = filters.leagues.filter(code => code !== 'SCG');
    return supported.length === 1 ? supported[0] : supported.includes('PL') ? 'PL' : supported[0] || null;
  }, [filters.leagues]);

  // rows 由父组件按 dataRev 重建，数据变化时随之重算，与列表口径保持一致
  const { leagueTotals, total } = useMemo(() => {
    const list = getFixtures();
    const totals = list.reduce((acc, m) => {
      acc[m.l] = (acc[m.l] || 0) + 1;
      return acc;
    }, {});
    return { leagueTotals: totals, total: list.length.toLocaleString() };
  }, [rows]);

  /* ---- 日期导航 ----
     主流产品（FotMob / 懂球帝）的赛程页都是「日期条 + 当日比赛」，
     而不是 1897 场的瀑布流。date=null 表示今天；'all' 保留全季列表（规划视图）。 */
  const todayDate = useMemo(() => owlDayOffset(0, now), [now]);
  const showAll = filters.date === 'all';
  const selDate = filters.date && filters.date !== 'all' ? filters.date : todayDate;

  const datePickerRef = useRef(null);
  const activeBtnRef = useRef(null);
  const stripRef = useRef(null);

  // 滚动聚焦当前选中或今天
  useEffect(() => {
    if (activeBtnRef.current) {
      activeBtnRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest'
      });
    }
  }, [selDate, showAll]);

  // 筛选层打开后把焦点移入面板：否则 Esc / Tab 仍作用在背后的列表上。
  useEffect(() => {
    if (filterOpen) filterCloseRef.current?.focus();
  }, [filterOpen]);

  const closeFilter = () => {
    setFilterOpen(false);
    window.requestAnimationFrame(() => filterBtnRef.current?.focus());
  };

  const dayStrip = useMemo(() => {
    const counts = new Map();
    const followedSet = new Set();
    let curDate = '';
    for (const row of rows) {
      if (row.type === 'date') {
        counts.set(row.date, row.count);
        curDate = row.date;
      } else if (
        curDate &&
        prefs.followedTeams.length > 0 &&
        (prefs.followedTeams.includes(row.m.h) || prefs.followedTeams.includes(row.m.a))
      ) {
        followedSet.add(curDate);
      }
    }
    const list = [];
    for (let i = -14; i <= 28; i++) {
      const d = owlDayOffset(i, now);
      list.push({
        offset: i,
        date: d,
        count: counts.get(d) || 0,
        hasFollowed: followedSet.has(d),
        isToday: i === 0,
        isYesterday: i === -1,
        isBeforeYesterday: i === -2
      });
    }
    return list;
  }, [rows, now, prefs.followedTeams]);

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
    const rest = matches.filter(m => !groups.some(g => g.code === m.l));
    if (rest.length) groups.push({ code: null, list: rest });
    return { matches, groups };
  }, [rows, selDate, showAll]);

  const dayMatchCount = dayGroups?.matches.length ?? 0;

  const nearestMatchDay = useMemo(() => {
    const days = rows
      .filter(row => row.type === 'date')
      .map(row => ({ date: row.date, count: row.count }));
    return days.find(day => day.date > selDate) ||
      [...days].reverse().find(day => day.date < selDate) ||
      null;
  }, [rows, selDate]);

  const set = patch => onFiltersChange({ ...filters, ...patch });
  const setDate = d => set({ date: d });

  const stepDate = direction => {
    const base = selDate || todayDate;
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + direction);
    const nextD = dt.toISOString().slice(0, 10);
    setDate(nextD);
  };

  const toggleLeague = code => {
    if (allSelected) {
      set({ leagues: [code] });
      return;
    }
    const has = filters.leagues.includes(code);
    const next = has ? filters.leagues.filter(x => x !== code) : [...filters.leagues, code];
    set({ leagues: next.length === 0 ? [...LEAGUE_ORDER] : next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      {/* Row 1：紧凑搜索框 + 积分榜按钮 */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex min-w-0 flex-1 items-center">
          <IconSearch size={13} className="pointer-events-none absolute left-2.5 text-text-faint" />
          <input
            type="text"
            value={filters.query}
            onChange={e => set({ query: e.target.value })}
            placeholder="搜索球队 / 联赛 / ID"
            aria-label="搜索球队、联赛或场次 ID"
            className="h-8 w-full rounded-lg border border-line-control bg-surface-card pl-8 pr-7 text-xs text-text-primary placeholder:text-text-faint transition-all focus:border-accent/60 focus:bg-surface-raised focus:outline-none shadow-card"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => set({ query: '' })}
              aria-label="清空搜索"
              title="清空搜索"
              className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:outline-none"
            >
              <IconClose size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => standingsLeague && onOpenStandings?.(standingsLeague)}
          disabled={!standingsLeague}
          title={standingsLeague ? '查看联赛积分榜' : '当前筛选联赛暂无积分榜'}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-control bg-surface-card px-2.5 text-xs font-medium text-text-secondary shadow-card transition-colors hover:border-line-control hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-card disabled:hover:text-text-secondary cursor-pointer"
        >
          <IconStandings size={13} />
          <span>积分榜</span>
        </button>
      </div>

      {/* Row 2：紧凑日期导航 + 全部 + 筛选抽屉开关 */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => stepDate(-1)}
            title="前一天"
            aria-label="前一天"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line-control bg-surface-raised text-text-secondary shadow-card transition-all hover:border-accent/40 hover:bg-surface-press hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
          >
            <IconChevronLeft size={12} />
          </button>
          <input
            ref={datePickerRef}
            type="date"
            value={showAll ? '' : selDate}
            onChange={e => e.target.value && setDate(e.target.value)}
            tabIndex={-1}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => {
              try {
                datePickerRef.current?.showPicker();
              } catch {
                datePickerRef.current?.focus();
              }
            }}
            title="点击按日历选择日期"
            aria-label="按日历选择日期"
            className="inline-flex h-7 min-w-0 items-center gap-1 rounded-md border border-line-control bg-surface-card px-2 font-body text-2xs font-semibold text-text-primary shadow-card transition-colors hover:border-accent/40 hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
          >
            <IconCalendar size={11} className="shrink-0 text-text-faint" />
            <span className="truncate font-num tabular-nums">
              {showAll ? '全季赛程' : `${selDate.slice(5)} ${weekdayOf(selDate)}`}
            </span>
          </button>
          <button
            type="button"
            onClick={() => stepDate(1)}
            title="后一天"
            aria-label="后一天"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line-control bg-surface-raised text-text-secondary shadow-card transition-all hover:border-accent/40 hover:bg-surface-press hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
          >
            <IconChevronRight size={12} />
          </button>
          {!showAll && selDate !== todayDate && (
            <button
              type="button"
              onClick={() => setDate(todayDate)}
              className="inline-flex h-7 shrink-0 items-center rounded-md border border-line-control bg-surface-raised px-2 text-2xs font-medium text-text-secondary shadow-card transition-all hover:bg-surface-press hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
            >
              今天
            </button>
          )}
          <button
            type="button"
            onClick={() => setDate(showAll ? todayDate : 'all')}
            aria-pressed={showAll}
            className={`inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-2xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer ${
              showAll
                ? 'border-accent/50 bg-surface-accent font-semibold text-accent shadow-card'
                : 'border-line-control bg-surface-card text-text-secondary hover:bg-surface-raised hover:text-text-primary'
            }`}
          >
            全部
          </button>
        </div>

        <button
          ref={filterBtnRef}
          type="button"
          onClick={() => setFilterOpen(v => !v)}
          aria-expanded={filterOpen}
          aria-label={filterOpen ? '关闭赛程筛选面板' : '打开赛程筛选面板'}
          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-2xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer ${
            filterOpen || activeFilterCount > 0
              ? 'border-accent/50 bg-surface-accent text-accent shadow-card'
              : 'border-line-control bg-surface-card text-text-secondary hover:bg-surface-raised hover:text-text-primary'
          }`}
        >
          <IconFilter size={11} />
          <span>筛选</span>
          {activeFilterCount > 0 && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-num text-2xs font-bold leading-none text-accent-ink">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* 日期横向滚动导航条（过去 14 天到未来 28 天，自动居中当前日期） */}
      <div className="relative shrink-0">
        <div
          ref={stripRef}
          className="date-strip-mask scrollbar-thin flex items-stretch gap-1 overflow-x-auto rounded-lg border border-line-hairline bg-surface-panel/80 p-1 shadow-card backdrop-blur-sm"
        >
          {dayStrip.map(item => {
            const active = !showAll && item.date === selDate;
            const label = item.isToday
              ? '今天'
              : item.isYesterday
                ? '昨天'
                : item.isBeforeYesterday
                  ? '前天'
                  : item.date.slice(5).replace('-', '/');
            return (
              <button
                key={item.date}
                ref={active ? activeBtnRef : null}
                type="button"
                onClick={() => setDate(item.date)}
                aria-pressed={active}
                className={`relative shrink-0 rounded-md border px-2 py-1 text-center transition-all focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer ${
                  active
                    ? 'border-accent/50 bg-surface-raised shadow-card'
                    : item.isToday
                      ? 'border-line-control/70 bg-surface-raised/40 hover:border-line-control'
                      : 'border-line-hairline bg-surface-card hover:border-line-control hover:bg-surface-raised'
                }`}
              >
                {item.hasFollowed && (
                  <span
                    className="absolute right-1 top-1 h-1 w-1 rounded-full bg-accent"
                    title="有关注球队比赛"
                    aria-hidden="true"
                  />
                )}
                <div
                  className={`font-num text-2xs font-semibold tabular-nums ${
                    active ? 'text-accent' : 'text-text-secondary'
                  }`}
                >
                  {label}
                </div>
                <div className="text-2xs text-text-faint">
                  {item.count > 0 ? `${item.count} 场` : '—'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 已激活筛选与命中数状态条 */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 items-center gap-1.5 truncate text-2xs text-text-muted">
          {!allSelected && (
            <span className="truncate text-accent">
              {filters.leagues.map(c => LEAGUE_NAMES[c]).join(' / ')}
            </span>
          )}
          {filters.onlyFollowed && (
            <span className="shrink-0 text-accent">· 只看关注</span>
          )}
          {allSelected && !filters.onlyFollowed && (
            <span>全部联赛</span>
          )}
        </div>
        <Meta num className="shrink-0">
          {showAll ? `全季命中 ${matchCount.toLocaleString()} 场` : `当日 ${dayMatchCount} 场`}
        </Meta>
      </div>

      {/* 列表容器（内嵌左栏全宽滑出筛选层，避免窄气泡被 overflow-hidden 裁切） */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {filterOpen && (
          <div
            role="region"
            aria-label="赛程筛选面板"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeFilter();
              }
            }}
            className="absolute inset-0 z-20 flex flex-col justify-between overflow-y-auto rounded-xl border border-line-control bg-surface-panel/95 p-3.5 shadow-pop backdrop-blur-xl"
          >
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <SectionLabel
                  right={<Hint content={LEAGUE_HINT} align="end" />}
                >
                  联赛筛选
                </SectionLabel>
                <button
                  ref={filterCloseRef}
                  type="button"
                  onClick={closeFilter}
                  aria-label="关闭筛选"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none cursor-pointer"
                >
                  <IconClose size={13} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <TogglePill
                  on={allSelected}
                  onClick={() => set({ leagues: [...LEAGUE_ORDER] })}
                  label="全部"
                  count={total}
                  aria-label="全部联赛"
                />
                {LEAGUE_ORDER.map(code => (
                  <TogglePill
                    key={code}
                    on={!allSelected && filters.leagues.includes(code)}
                    onClick={() => toggleLeague(code)}
                    label={LEAGUE_NAMES[code]}
                    count={leagueTotals[code] ?? 0}
                    color={leagueColor(code)}
                  />
                ))}
              </div>

              <div className="space-y-2.5 border-t border-line-hairline pt-3">
                <SwitchField
                  on={filters.onlyFollowed}
                  onChange={v => set({ onlyFollowed: v })}
                  label="只看关注球队"
                  desc={
                    prefs.followedTeams.length === 0
                      ? filters.onlyFollowed
                        ? '尚未设置关注球队；关闭此筛选后显示全部场次'
                        : '尚未在设置中添加关注球队'
                      : `仅展示已关注的 ${prefs.followedTeams.length} 支球队场次`
                  }
                  disabled={prefs.followedTeams.length === 0 && !filters.onlyFollowed}
                />
                <SwitchField
                  on={prefs.spoilerFree}
                  onChange={v => onPrefsChange({ ...prefs, spoilerFree: v })}
                  label="防剧透模式"
                  desc="已完赛场次默认隐藏比分，点击揭晓"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-line-hairline pt-3">
              <Button
                variant="ghost"
                onClick={() => onFiltersChange(defaultScheduleFilters())}
              >
                重置筛选
              </Button>
              <Button variant="primary" onClick={closeFilter}>
                完成
              </Button>
            </div>
          </div>
        )}

        {!showAll ? (
          dayMatchCount === 0 ? (
            <EmptyState
              icon={<IconSearch size={22} />}
              title={`${selDate}（${weekdayOf(selDate)}）没有匹配的场次`}
              desc="换个日期，或点「全部」查看全季赛程。"
              action={
                <div className="flex flex-col items-center gap-2">
                  {nearestMatchDay && (
                    <button
                      type="button"
                      onClick={() => setDate(nearestMatchDay.date)}
                      className="rounded-md border border-accent/40 bg-surface-accent px-3 py-1.5 text-2xs font-medium text-accent transition-colors hover:border-accent/60 hover:bg-accent/20"
                    >
                      跳到最近有赛日 · {nearestMatchDay.date.slice(5).replace('-', '/')}（{nearestMatchDay.count} 场）
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDate('all')}
                    className="text-2xs text-text-muted underline underline-offset-2 transition-colors hover:text-text-primary"
                  >
                    查看全部赛程
                  </button>
                </div>
              }
            />
          ) : (
            <div key={`${selDate}-${filterKey}`} className="scrollbar-thin h-full overflow-y-auto pr-1">
              {dayGroups.groups.map(g => (
                <div key={g.code || '__rest__'} className="mb-2">
                  {g.code && (
                    <div className="flex items-center gap-2 pb-1 pt-1.5">
                      <span className="h-3 w-0.5 rounded" style={{ background: leagueColor(g.code) }} />
                      <span className="text-xs font-semibold text-text-secondary">
                        {LEAGUE_NAMES[g.code]}
                      </span>
                      <span className="font-num text-2xs tabular-nums text-text-faint">
                        {g.list.length} 场
                      </span>
                    </div>
                  )}
                  {g.list.map(m => {
                    const { ev, index } = evalOne(m, prefs);
                    return (
                      <div className="pb-1" key={m.id}>
                        <MatchRow
                          m={m}
                          state={stateOf(m, now)}
                          active={m.id === activeMatchId}
                          now={now}
                          onSelect={onSelect}
                          spoilerFree={prefs.spoilerFree}
                          revealed={revealed.has(m.id)}
                          onReveal={onReveal}
                          rivalry={ev.rivalry}
                          followedTeams={prefs.followedTeams}
                          index={index}
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
          <VList key={`all-${filterKey}`} data={rows} style={{ height: '100%' }} className="scrollbar-thin">
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
              const { ev, index } = evalOne(m, prefs);
              return (
                <div className="pb-1">
                  <MatchRow
                    m={m}
                    state={stateOf(m, now)}
                    active={m.id === activeMatchId}
                    now={now}
                    onSelect={onSelect}
                    spoilerFree={prefs.spoilerFree}
                    revealed={revealed.has(m.id)}
                    onReveal={onReveal}
                    rivalry={ev.rivalry}
                    followedTeams={prefs.followedTeams}
                    index={index}
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
