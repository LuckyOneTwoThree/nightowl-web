import { useEffect, useMemo, useState } from 'react';
import { leagueName, teamName } from '../data/index.js';
import { hm } from '../core/format.js';
import { Button, Chip, Crest, Meta } from './atoms.jsx';
import { IconClose } from './icons.jsx';

/**
 * 次日补看摘要
 *
 * 数据只来自「明早补看」队列；比分与事件默认隐藏，必须逐场揭晓。
 * 关闭/稍后再看不会自动揭晓，也不会丢掉队列。
 */
export default function MorningDigest({
  open,
  items = [],
  revealed,
  onReveal,
  onMarkRead,
  onOpenMatch,
  onClose
}) {
  const [confirmAll, setConfirmAll] = useState(false);
  useEffect(() => {
    if (!open) setConfirmAll(false);
  }, [open]);
  if (!open) return null;

  const total = items.length;
  const allRevealed = total > 0 && items.every(({ match }) => match && revealed?.has(match.id));
  const done = items.filter(({ item }) => item.status === 'watched').length;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="morning-digest-title"
        className="flex max-h-[min(720px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-hairline bg-surface-panel shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-hairline px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="morning-digest-title" className="text-base font-semibold text-text-primary">
                昨晚补看
              </h2>
              <Chip tone="neutral">{total} 场</Chip>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              比分默认隐藏；逐场揭晓后查看，关闭不会丢掉队列。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭补看摘要"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <IconClose size={15} />
          </button>
        </header>

        <div className="scrollbar-thin overflow-y-auto p-4">
          {total === 0 ? (
            <div className="rounded-lg border border-line-hairline bg-surface-raised/40 px-4 py-8 text-center">
              <p className="text-sm font-medium text-text-primary">昨晚的补看已经清空</p>
              <p className="mt-1 text-xs text-text-muted">可以在比赛详情继续加入「明早补看」。</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(({ item, match }) => {
                const shown = !!match && !!revealed?.has(match.id);
                const hasScore = !!match?.sc && match.st === 'done';
                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-line-hairline bg-surface-card p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Meta num>
                        {match ? `${leagueName(match.l)} · ${hm(match.t)}` : item.id}
                      </Meta>
                      <Meta>{item.status === 'watched' ? '已看' : '待补看'}</Meta>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      {match && <Crest id={match.h} size={30} />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                        </p>
                        <p className="mt-0.5 text-2xs text-text-faint">
                          {match ? (match.st === 'done' ? '已终场' : '比分待录') : '本地赛程中没有这场比赛'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {match && (
                          <span
                            className={`font-num text-sm font-bold tabular-nums ${
                              shown ? 'text-text-primary' : 'text-text-faint'
                            }`}
                            aria-label={shown ? `比分 ${hasScore ? match.sc : '待录'}` : '比分已隐藏'}
                          >
                            {shown ? (hasScore ? match.sc : '待录') : '•• - ••'}
                          </span>
                        )}
                        {match && !shown && (
                          <Button variant="ghost" size="xs" onClick={() => onReveal?.(match.id)}>
                            揭晓
                          </Button>
                        )}
                        {match && (
                          <Button variant="ghost" size="xs" onClick={() => onOpenMatch?.(match.id)}>
                            查看
                          </Button>
                        )}
                        {onMarkRead && (
                          <Button variant="ghost" size="xs" onClick={() => onMarkRead(item.id)}>
                            已看
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line-hairline px-4 py-3">
          <Meta>{done > 0 ? `${done} 场已看` : '不着急，稍后也能从补看队列进入'}</Meta>
          <div className="flex items-center gap-2">
            {allRevealed ? (
              <Meta>已全部揭晓</Meta>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!confirmAll) {
                    setConfirmAll(true);
                    return;
                  }
                  for (const { match } of items) if (match) onReveal?.(match.id);
                  setConfirmAll(false);
                }}
              >
                {confirmAll ? '确认全部揭晓？' : '全部揭晓'}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={onClose}>
              稍后再看
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
