import { useMemo, useState } from 'react';
import { teams, TEAM_MAP, LEAGUE_ORDER, LEAGUE_NAMES, leagueColor } from '../data/index.js';
import { Crest, RemovableChip, TogglePill } from './atoms.jsx';
import { IconCheck, IconClose, IconSearch } from './icons.jsx';

/**
 * 球队选择器（首次引导与设置面板共用）
 *
 * 为什么抽出来：此前引导页和设置面板各写了一份几乎一样的搜索 + 分类 + 网格，
 * 并且已经开始不一致 —— 一份是 `grid-cols-6`、另一份 `grid-cols-5`；
 * 一份用 `t.zh.includes(q)` 区分大小写地匹配中文（英文搜索能命中，中文大小写永远命中不了），
 * 另一份做了 toLowerCase。重复的实现不会一起变好，只会各自变坏。
 *
 * 联赛分类从 teams 实际数据推导，而不是再抄一份写死的 TABS 数组：
 * 数据集里新增联赛时，选择器不会把它悄悄藏起来。
 */
const TABS = (() => {
  const present = new Set(teams.map(t => t.league));
  const known = LEAGUE_ORDER.filter(c => present.has(c));
  const extra = [...present].filter(c => !LEAGUE_ORDER.includes(c));
  return [...known, ...extra];
})();

const COUNTS = teams.reduce((acc, t) => {
  acc[t.league] = (acc[t.league] || 0) + 1;
  return acc;
}, {});

export default function TeamPicker({
  selected,
  onChange,
  gridClass = 'grid-cols-6',
  listClass = 'max-h-64',
  autoFocus = false,
  placeholder = `搜索 ${teams.length} 支球队（中文 / 英文 / 缩写）`
}) {
  const [league, setLeague] = useState('ALL');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter(t => {
      if (league !== 'ALL' && t.league !== league) return false;
      if (!q) return true;
      return (
        t.zh.toLowerCase().includes(q) ||
        t.en.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      );
    });
  }, [league, query]);

  const toggle = id => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-col">
      {/* 已选：放在最前面，选完能立刻看到结果 */}
      {selected.length > 0 ? (
        <div className="scrollbar-thin mb-2 flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
          {selected.map(id => (
            <RemovableChip key={id} leading={<Crest id={id} size={14} />} onRemove={() => toggle(id)}>
              {TEAM_MAP[id]?.zh || id}
            </RemovableChip>
          ))}
        </div>
      ) : (
        <div className="mb-2 flex items-center justify-between rounded-md border border-dashed border-line-hairline bg-surface-panel/60 px-2.5 py-1.5 text-2xs text-text-muted">
          <span>暂未关注主队（主队比赛将获得夜猫指数加成与专属标记）</span>
          <span className="text-text-faint">点击下方添加</span>
        </div>
      )}

      {/* 搜索 */}
      <div className="relative flex items-center">
        <IconSearch size={13} className="pointer-events-none absolute left-2.5 text-text-faint" />
        <input
          autoFocus={autoFocus}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-line-hairline bg-surface-panel py-1.5 pl-8 pr-7 text-xs text-text-primary placeholder:text-text-faint focus:border-accent/50 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清空搜索"
            className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-raised hover:text-text-primary"
          >
            <IconClose size={12} />
          </button>
        )}
      </div>

      {/* 联赛分类 */}
      <div className="mt-2 flex flex-wrap gap-1">
        <TogglePill on={league === 'ALL'} onClick={() => setLeague('ALL')} label="全部" count={teams.length} />
        {TABS.map(code => (
          <TogglePill
            key={code}
            on={league === code}
            onClick={() => setLeague(code)}
            label={LEAGUE_NAMES[code] || code}
            count={COUNTS[code] || 0}
            color={leagueColor(code)}
          />
        ))}
      </div>

      {/* 网格 */}
      <div
        className={`scrollbar-thin mt-2 overflow-y-auto rounded-lg bg-surface-panel p-1.5 ${listClass}`}
      >
        {visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-muted">
            没有匹配的球队
            {league !== 'ALL' && (
              <button
                type="button"
                onClick={() => setLeague('ALL')}
                className="ml-1.5 text-accent underline underline-offset-2"
              >
                切回全部联赛
              </button>
            )}
          </p>
        ) : (
          <div className={`grid ${gridClass} gap-1.5`}>
            {visible.map(t => {
              const on = selected.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  aria-pressed={on}
                  title={`${t.zh} (${t.en}) · ${LEAGUE_NAMES[t.league] || t.league}${t.tag ? ` · ${t.tag}` : ''}`}
                  className={`relative flex flex-col items-center gap-1 rounded-md px-1 py-1.5 transition-all ${
                    on
                      ? 'border border-accent/50 bg-surface-accent text-accent font-medium shadow-sm'
                      : 'border border-transparent bg-surface-card text-text-secondary hover:border-line-hairline hover:bg-surface-raised hover:text-text-primary'
                  }`}
                >
                  {on && (
                    <span className="absolute right-0.5 top-0.5 text-accent">
                      <IconCheck size={10} />
                    </span>
                  )}
                  <Crest id={t.id} size={22} />
                  <span className={`w-full truncate text-center text-2xs leading-tight ${on ? 'font-medium' : ''}`}>
                    {t.zh}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between px-0.5 font-num text-2xs tabular-nums text-text-faint">
        <span>已选 {selected.length}</span>
        <span>当前展示 {visible.length}</span>
      </div>
    </div>
  );
}
