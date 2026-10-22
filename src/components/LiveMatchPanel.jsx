import { teamName } from '../data/index.js';
import { EVENT_LABEL, EVENT_TONE, eventSummary } from '../core/live-events.js';
import { Button, Chip, Crest, IconButton, LiveDot, Meta } from './atoms.jsx';
import { IconReset, IconReveal, IconWarn } from './icons.jsx';

function TeamRow({ id, score }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-surface-raised/40 px-2 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <Crest id={id} size={16} />
        <span className="truncate text-2xs font-medium text-text-primary">{teamName(id)}</span>
      </span>
      <span
        key={score == null ? '—' : score}
        className="animate-score-pop font-num text-sm font-semibold tabular-nums text-text-primary"
      >
        {score == null ? '—' : score}
      </span>
    </div>
  );
}

/**
 * 进行中比赛的实时比分 / 关键事件
 *
 * 数据来自本地 /api/live（ESPN scoreboard + summary），父组件每 30 秒轮询一次。
 * 所有比分/事件都受防剧透开关控制；未揭晓时不渲染任何比分文本。
 */
export default function LiveMatchPanel({
  match,
  data,
  loading = false,
  refreshing = false,
  onRefresh,
  spoilerFree = true,
  revealed = false,
  onReveal
}) {
  if (!match) return null;

  const ok = data?.ok === true;
  const hidden = spoilerFree && !revealed;
  const events = ok ? [...(data.events || [])].reverse().slice(0, 4) : [];
  const finished = ok && data.state === 'finished';
  const postponed = ok && data.state === 'postponed';
  const statusText = ok ? data.statusText : loading ? '同步中' : '暂不可用';
  const minuteLabel = ok ? data.minuteLabel : '';

  return (
    <div className="mb-2.5 shrink-0 rounded-lg border border-line-hairline bg-surface-raised/35 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LiveDot />
          <span className="text-2xs font-medium text-text-primary">实时</span>
          <Chip tone={ok && !finished && !postponed ? 'live' : 'neutral'} className="shrink-0">
            {statusText}
          </Chip>
          {minuteLabel && (
            <Meta num className="shrink-0">
              {minuteLabel}
            </Meta>
          )}
        </span>
        <IconButton
          label={refreshing ? '正在刷新实时数据' : '刷新实时数据'}
          onClick={onRefresh}
          disabled={refreshing}
          className="h-5 w-5"
        >
          <IconReset size={11} className={refreshing ? 'animate-spin text-accent' : ''} />
        </IconButton>
      </div>

      {!ok && loading && (
        <p className="mt-2 text-2xs text-text-muted">正在同步实时比分…</p>
      )}

      {!ok && !loading && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
            <IconWarn size={11} className="shrink-0 text-text-faint" />
            实时数据暂不可用
          </span>
          <Button variant="ghost" onClick={onRefresh}>
            重试
          </Button>
        </div>
      )}

      {ok && hidden && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-surface-raised/50 px-2 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-2xs text-text-muted">
            <IconReveal size={11} />
            实时比分已隐藏
          </span>
          <Button variant="ghost" onClick={onReveal}>
            揭晓实时比分
          </Button>
        </div>
      )}

      {ok && !hidden && !postponed && (
        <>
          <div className="mt-2 space-y-1" aria-live="polite" aria-atomic="true">
            <TeamRow id={match.h} score={data.score?.h} />
            <TeamRow id={match.a} score={data.score?.a} />
          </div>

          {events.length > 0 ? (
            <div className="mt-2 space-y-1 border-t border-line-hairline pt-2">
              {events.map((ev, i) => (
                <div key={`${ev.clock}-${i}`} className="flex min-w-0 items-center gap-1.5">
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
            </div>
          ) : (
            <p className="mt-2 border-t border-line-hairline pt-2 text-2xs text-text-faint">
              {data.warning === 'events-unavailable' ? '关键事件暂不可用，比分仍实时' : '暂无关键事件'}
            </p>
          )}

          <p className="mt-2 text-2xs text-text-faint">
            {finished ? '已终场，等待比分入库 · ' : ''}
            数据：ESPN · 约 30 秒刷新
          </p>
        </>
      )}

      {ok && postponed && (
        <p className="mt-2 text-2xs text-text-muted">本场已延期，暂无实时比分。</p>
      )}
    </div>
  );
}
