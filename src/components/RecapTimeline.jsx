import { useEffect, useState } from 'react';
import { teamName } from '../data/index.js';
import { EVENT_LABEL, EVENT_TONE, eventSummary } from '../core/live-events.js';
import { Button, Chip, Crest, IconButton, Meta, SectionLabel } from './atoms.jsx';
import { IconReset, IconWarn } from './icons.jsx';

/**
 * 赛后关键事件回顾
 *
 * 复用 ESPN summary 的 keyEvents（与实时面板同一份解析），
 * 只对已完赛且已揭晓的场次请求；防剧透时整块不渲染。
 */
export default function RecapTimeline({ match, spoilerFree = true, revealed = false }) {
  const finished = match?.st === 'done';
  const hidden = finished && spoilerFree && !revealed;
  const [status, setStatus] = useState('idle');
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!finished || hidden) {
      setStatus(hidden ? 'hidden' : 'idle');
      setData(null);
      return undefined;
    }

    const ac = new AbortController();
    let alive = true;
    setStatus('loading');
    setData(null);

    (async () => {
      try {
        const refresh = nonce > 0 ? '&refresh=1' : '';
        const res = await fetch(
          `/api/recap?matchId=${encodeURIComponent(match.id)}${refresh}`,
          { signal: ac.signal }
        );
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        if (!alive) return;
        if (j?.ok) {
          setData(j);
          setStatus(j.events?.length ? 'ready' : 'empty');
        } else {
          setStatus('error');
        }
      } catch (err) {
        if (alive && err?.name !== 'AbortError') setStatus('error');
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [finished, hidden, match?.id, nonce]);

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
        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-raised/30 px-2.5 py-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
            <IconWarn size={12} className="shrink-0 text-warn" />
            回顾数据暂不可用
          </span>
          <Button variant="ghost" onClick={() => setNonce(v => v + 1)}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
