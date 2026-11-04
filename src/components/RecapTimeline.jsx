import { useEffect, useState } from 'react';
import { teamName } from '../data/index.js';
import { shouldHideScore } from '../core/reveal.js';
import { EVENT_LABEL, EVENT_TONE, eventSummary } from '../core/live-events.js';
import { Button, Chip, Crest, IconButton, Meta, SectionLabel } from './atoms.jsx';
import { IconReset, IconWarn } from './icons.jsx';
import { useRemoteJson } from '../hooks/useRemoteJson.js';
import { reportReviewStatus } from '../hooks/useReviewStatus.js';

/**
 * 赛后关键事件回顾
 *
 * 复用 ESPN summary 的 keyEvents（与实时面板同一份解析），
 * 只对已完赛且已揭晓的场次请求；防剧透时整块不渲染。
 */
export default function RecapTimeline({ match, spoilerFree = true, revealed = false }) {
  const finished = match?.st === 'done';
  const hidden = finished && shouldHideScore(spoilerFree, revealed);
  const [nonce, setNonce] = useState(0);
  // 取数统一走 useRemoteJson（状态机 / Abort 取消 / 空态判定只有一份实现）
  const { status, data } = useRemoteJson({
    url: finished && !hidden
      ? `/api/recap?matchId=${encodeURIComponent(match.id)}${nonce > 0 ? '&refresh=1' : ''}`
      : null,
    listKey: 'events'
  });

  /* 把真实状态上报给连续补看会话：只有「上游确实没有事件」才允许会话条说
     「这场没有回顾资源」。未完成的请求不上报，避免把 loading 当成没有。 */
  useEffect(() => {
    if (!match?.id || !finished) return;
    if (status === 'idle' || status === 'loading') return;
    reportReviewStatus('recap', match.id, status);
  }, [match?.id, finished, status]);

  if (!finished || hidden) return null;

  const events = [...(data?.events || [])].reverse().slice(0, 6);
  const score = data?.score;
  const hasMore = (data?.events?.length || 0) > 6;

  return (
    <div className="mt-2.5 shrink-0 border-t border-line-hairline pt-2.5">
      <SectionLabel
        right={
          <span className="inline-flex items-center gap-1.5">
            <Meta>ESPN · 文字事件</Meta>
            {status !== 'loading' && (
              <IconButton
                label="刷新比赛回顾"
                onClick={() => setNonce(v => v + 1)}
                className="h-5 w-5"
              >
                <IconReset size={11} />
              </IconButton>
            )}
          </span>
        }
      >
        比赛回顾
      </SectionLabel>

      {status === 'loading' && (
        <div className="mt-1.5 space-y-1.5" aria-busy="true" aria-label="正在加载比赛回顾">
          <span className="skeleton block h-7 w-full" />
          <span className="skeleton block h-2.5 w-full" />
          <span className="skeleton block h-2.5 w-4/5" />
        </div>
      )}

      {(status === 'ready' || status === 'empty') && (
        <>
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md bg-surface-raised/40 px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <Crest id={match.h} size={14} />
              <span className="truncate text-2xs font-medium text-text-primary">{teamName(match.h)}</span>
            </span>
            <span className="font-num text-sm font-semibold tabular-nums text-text-primary">
              {score?.h ?? '—'} - {score?.a ?? '—'}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-2xs font-medium text-text-primary">{teamName(match.a)}</span>
              <Crest id={match.a} size={14} />
            </span>
          </div>

          {status === 'ready' ? (
            <div className="mt-1.5 space-y-1">
              {events.map((ev, i) => (
                <div key={`${ev.clock}-${ev.type}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  <span className="w-9 shrink-0 font-num text-2xs tabular-nums text-text-faint">
                    {ev.clock || '—'}
                  </span>
                  <Chip tone={EVENT_TONE[ev.type] || 'neutral'} className="shrink-0">
                    {EVENT_LABEL[ev.type] || '事件'}
                  </Chip>
                  <span className="truncate text-2xs text-text-secondary">
                    {eventSummary(ev, match)}
                  </span>
                </div>
              ))}
              {hasMore && (
                <p className="text-2xs text-text-faint">仅显示最近 6 条关键事件</p>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-2xs text-text-faint">暂无关键事件数据</p>
          )}
        </>
      )}

      {status === 'error' && (
        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md bg-surface-raised/30 px-2.5 py-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
            <IconWarn size={12} className="shrink-0 text-warn" />
            回顾数据暂不可用
          </span>
          <Button variant="text" onClick={() => setNonce(v => v + 1)}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
