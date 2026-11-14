import { useState } from 'react';
import {
  DIARY_NOTE_MAX_LEN,
  DIARY_STAMPS,
  MODE_META,
  STAMP_META,
  WATCH_MODES
} from '../core/diary.js';
import { Button, Meta } from './atoms.jsx';

const TONE_ACTIVE = {
  gold: 'border-accent/55 bg-accent/15 text-accent',
  teal: 'border-resource/55 bg-resource/15 text-resource',
  muted: 'border-line-control bg-surface-raised text-text-primary',
  danger: 'border-danger/55 bg-danger/15 text-danger'
};

/**
 * 观赛情绪印章单行控件（1 秒盖章 + 观赛模式 + 可选 ≤60 字笔记）
 */
export default function DiaryStampBar({
  matchId,
  entry = null,
  defaultMode = 'live',
  onSave,
  onRemove,
  onOpenReport,
  compact = false
}) {
  const [noteState, setNoteState] = useState(() => ({ matchId, open: false, text: entry?.note || '' }));
  const scoped = noteState.matchId === matchId ? noteState : { matchId, open: false, text: entry?.note || '' };

  if (!matchId) return null;
  const activeMode = entry?.mode || defaultMode;

  return (
    <div className={`rounded-lg border border-line-hairline bg-surface-card/70 ${compact ? 'p-2.5' : 'p-3'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">观赛情绪印章</span>
          {entry && (
            <button
              type="button"
              onClick={() => setNoteState({ matchId, open: !scoped.open, text: entry.note || '' })}
              className="text-2xs text-text-muted underline underline-offset-2 transition-colors hover:text-text-secondary"
            >
              {scoped.open ? '收起笔记' : entry.note ? '编辑短评' : '+ 写一句'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {WATCH_MODES.map(mode => {
            const on = activeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (entry) {
                    onSave?.({ matchId, mode, stamp: entry.stamp, note: entry.note });
                  } else {
                    onSave?.({ matchId, mode, stamp: 'epic' });
                  }
                }}
                className={`rounded px-1.5 py-0.5 text-2xs transition-colors ${
                  on
                    ? 'bg-surface-raised font-medium text-text-primary'
                    : 'text-text-faint hover:text-text-secondary'
                }`}
              >
                {MODE_META[mode].shortLabel}
              </button>
            );
          })}
          {onOpenReport && (
            <button
              type="button"
              onClick={onOpenReport}
              className="ml-1 rounded border border-line-control px-2 py-0.5 text-2xs text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
            >
              赛季账单
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {DIARY_STAMPS.map(stampId => {
          const meta = STAMP_META[stampId];
          const active = entry?.stamp === stampId;
          return (
            <button
              key={stampId}
              type="button"
              onClick={() => {
                if (active && onRemove) {
                  onRemove(matchId);
                } else {
                  onSave?.({ matchId, mode: activeMode, stamp: stampId, note: entry?.note || '' });
                }
              }}
              aria-pressed={active}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                active
                  ? TONE_ACTIVE[meta.tone]
                  : 'border-line-hairline bg-surface-panel text-text-secondary hover:border-line-control hover:text-text-primary'
              }`}
            >
              <span className="font-num">{meta.glyph}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {entry && scoped.open && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            onSave?.({ matchId, mode: activeMode, stamp: entry.stamp, note: scoped.text });
            setNoteState({ matchId, open: false, text: scoped.text.slice(0, DIARY_NOTE_MAX_LEN) });
          }}
        >
          <input
            type="text"
            maxLength={DIARY_NOTE_MAX_LEN}
            value={scoped.text}
            onChange={e => setNoteState({ matchId, open: true, text: e.target.value })}
            placeholder="记一句熬夜感受（最多 60 字）…"
            className="min-w-0 flex-1 rounded-md border border-line-control bg-surface-panel px-2.5 py-1 text-xs text-text-primary placeholder:text-text-faint focus:border-accent/60 focus:outline-none"
          />
          <Button type="submit" variant="default" size="xs">
            保存
          </Button>
        </form>
      )}
      {entry?.note && !scoped.open && (
        <Meta className="mt-1.5 block truncate text-text-secondary">“{entry.note}”</Meta>
      )}
    </div>
  );
}
