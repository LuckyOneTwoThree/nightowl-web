import { useEffect, useRef, useState } from 'react';
import { leagueName, teamName } from '../data/index.js';
import { hm } from '../core/format.js';
import { completedWatchHint } from '../core/reveal.js';
import { summarizeDrama } from '../core/drama.js';
import { Button, Chip, Crest, Meta } from './atoms.jsx';
import DramaMeter from './DramaMeter.jsx';
import DiaryStampBar from './DiaryStampBar.jsx';
import { IconClose } from './icons.jsx';
import { useDialogFocus } from '../hooks/useDialogFocus.js';

/**
 * 次日补看摘要
 *
 * 数据只来自「明早补看」队列；比分与事件默认隐藏，必须逐场揭晓。
 * 关闭/稍后再看不会自动揭晓，也不会丢掉队列。
 *
 * 无障碍：模态对话框（`aria-modal`）必须同时满足三件事 —— 背景 inert（由 App 的
 * `overlayOpen` 负责）、Esc 由 App 的浮层栈统一派发、焦点进场与归还。
 * 此前只有 `aria-modal` 属性，Tab 仍能走进背景列表；本组件补上后两项。
 */
export default function MorningDigest({
  open,
  items = [],
  revealed,
  onReveal,
  onMarkRead,
  onOpenMatch,
  onClose,
  onStartSession,
  watchedCount = 0,
  diary = null,
  onSaveDiary = null,
  onRemoveDiary = null,
  onOpenSeasonReport = null
}) {
  const [confirmAll, setConfirmAll] = useState(false);
  const [dramaById, setDramaById] = useState({});
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!open) setConfirmAll(false);
  }, [open]);

  // 仅为当前待揭晓的已完赛条目按需拉取脱敏剧情脉冲（/api/drama 不下发比分与队属）
  useEffect(() => {
    if (!open) return;
    const targets = items
      .map(entry => entry?.match)
      .filter(m => m && m.st === 'done' && !revealed?.has(m.id) && !dramaById[m.id]);
    if (targets.length === 0) return;

    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      for (const m of targets.slice(0, 6)) {
        if (cancelled) break;
        try {
          const res = await fetch(`/api/drama?matchId=${encodeURIComponent(m.id)}`, {
            signal: ac.signal
          });
          if (!res.ok) continue;
          const payload = await res.json();
          if (cancelled || !payload) continue;
          setDramaById(prev => (prev[m.id] ? prev : { ...prev, [m.id]: payload }));
        } catch {
          // 离线或服务未开时静默回落到本地 summarizeDrama(match, null)
        }
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [open, items, revealed, dramaById]);

  /**
   * 焦点进场与归还走统一 hook（与设置抽屉、更新弹窗、积分榜同一份实现）。
   * 摘要多为自动弹出（起床后首次打开），此时 `document.activeElement` 往往是 body；
   * body 不可聚焦，归还时 `focus()` 自然无副作用，不需要特判。
   */
  useDialogFocus(open, closeBtnRef);

  if (!open) return null;

  const total = items.length;
  const allRevealed = total > 0 && items.every(({ match }) => match && revealed?.has(match.id));
  // 「已看」条目会被 pendingQueue 过滤掉，不会出现在 items 里，
  // 因此这个数字必须由调用方按夜晚统计后传入（此前在本地对 items 计数，恒为 0）。
  const done = Math.max(0, Number(watchedCount) || 0);

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
            ref={closeBtnRef}
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
                const watchHint = !shown && hasScore ? completedWatchHint(match, item?.ev || null) : null;
                const localDrama = !shown && match?.st === 'done' ? dramaById[match.id] || summarizeDrama(match, null) : null;
                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-line-hairline bg-surface-card p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Meta num>
                        {match
                          ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)}`
                          : item.id}
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
                        {!shown && (localDrama || watchHint) && (
                          <div className="mt-1.5">
                            <DramaMeter drama={localDrama} fallbackHint={watchHint} />
                          </div>
                        )}
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
                    {shown && match && onSaveDiary && (
                      <div className="mt-2.5">
                        <DiaryStampBar
                          compact
                          matchId={match.id}
                          entry={diary?.entries?.[match.id] || null}
                          defaultMode="replay"
                          onSave={onSaveDiary}
                          onRemove={onRemoveDiary}
                        />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <Meta>{done > 0 ? `${done} 场已看` : '不着急，稍后也能从补看队列进入'}</Meta>
            {onOpenSeasonReport && (
              <Button variant="ghost" size="xs" onClick={onOpenSeasonReport}>
                赛季账单
              </Button>
            )}
          </div>
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
            {/* 主行动从「稍后再看」换成「开始依序补看」：
                摘要里逐条点开、看完再退回来找下一条，是清单的做法，不是连看的做法。 */}
            <Button variant="ghost" size="sm" onClick={onClose}>
              稍后再看
            </Button>
            {total > 0 && (
              <Button variant="primary" size="sm" onClick={onStartSession}>
                开始依序补看
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
