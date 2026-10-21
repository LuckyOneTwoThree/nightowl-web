import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPalette } from '../core/command-palette.js';
import {
  IconCalendar,
  IconClose,
  IconReset,
  IconSchedule,
  IconSearch,
  IconSettings,
  IconTonight,
  IconWeek
} from './icons.jsx';

const KIND_ICON = {
  导航: <IconTonight size={12} />,
  操作: <IconReset size={12} />,
  比赛: <IconCalendar size={12} />
};

function iconFor(item) {
  if (item.action?.type === 'view') {
    return item.action.view === 'week' ? <IconWeek size={13} /> : item.action.view === 'schedule' ? <IconSchedule size={13} /> : <IconTonight size={13} />;
  }
  if (item.action?.type === 'settings') return <IconSettings size={13} />;
  return KIND_ICON[item.kind] || <IconSearch size={12} />;
}

/**
 * 命令面板（Ctrl/Cmd + K）
 *
 * 键盘优先：↑↓ 选择、Enter 执行、Esc 关闭；点击遮罩关闭。
 * 背景已由 App 的 inert 隔离，焦点从输入框开始。
 */
export default function CommandPalette({ items = [], onClose, onRun }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => searchPalette(items, query, 12), [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const run = item => {
    if (!item) return;
    onRun?.(item);
  };

  const onKeyDown = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(results.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      run(results[activeIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-start justify-center bg-black/60 px-4 pt-[11vh] backdrop-blur-sm"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="animate-view-enter w-full max-w-xl overflow-hidden rounded-2xl border border-line-control bg-surface-panel/95 shadow-pop"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-line-hairline px-4 py-3">
          <IconSearch size={15} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索球队、比赛或功能…"
            aria-label="搜索球队、比赛或功能"
            aria-controls="command-results"
            aria-activedescendant={results[activeIndex] ? `command-result-${results[activeIndex].id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-surface-raised hover:text-text-primary"
            >
              <IconClose size={12} />
            </button>
          ) : (
            <kbd className="rounded border border-line-hairline bg-surface-raised px-1.5 py-0.5 font-num text-2xs text-text-faint">
              Esc
            </kbd>
          )}
        </div>

        <div ref={listRef} id="command-results" role="listbox" aria-label="搜索结果" className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <p className="text-sm text-text-secondary">没有找到匹配项</p>
              <p className="mt-1 text-2xs text-text-faint">试试球队名、联赛名、场次 ID 或「设置」</p>
            </div>
          ) : (
            results.map((item, i) => {
              const active = i === activeIndex;
              return (
                <button
                  key={item.id}
                  id={`command-result-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active ? 'true' : undefined}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => run(item)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active ? 'bg-surface-accent text-text-primary' : 'text-text-secondary hover:bg-surface-raised'
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${active ? 'bg-accent/15 text-accent' : 'bg-surface-raised text-text-muted'}`}>
                    {iconFor(item)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-primary">{item.title}</span>
                    <span className="mt-0.5 block truncate text-2xs text-text-faint">{item.subtitle}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-text-faint">{item.kind}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line-hairline px-4 py-2 text-2xs text-text-faint">
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span className="font-num">Ctrl K</span>
        </div>
      </section>
    </div>
  );
}
