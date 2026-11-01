import { describeChange, summarizeChanges } from '../core/schedule-change.js';
import { leagueName, teamName } from '../data/index.js';
import { Button, Meta } from './atoms.jsx';
import { IconClose, IconWarn } from './icons.jsx';

/**
 * 「计划有变」提示条（FR-05）
 *
 * 计划建立在开球时间上：时间变了却静默替换，用户会按旧时间安排睡眠。
 * 这里是应用内的一次性提示——不阻塞、不弹窗，最多列 3 条，其余折叠成「还有 N 场」。
 * 关闭状态由调用方按本轮同步时间记在 sessionStorage，服务端不做已读。
 */
export default function ScheduleChanges({ changes, onDismiss, onSelect }) {
  const list = changes?.items || [];
  const summary = summarizeChanges(list);
  if (!list.length) return null;

  const shown = list.slice(0, 3);

  return (
    <section
      aria-label="计划有变"
      className="shrink-0 rounded-xl border border-warn/35 bg-warn/[0.08] px-2.5 py-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex min-w-0 items-start gap-1.5">
          <IconWarn size={12} className="mt-0.5 shrink-0 text-warn" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-warn">{summary.title}</span>
            <span className="mt-0.5 block text-2xs text-text-muted">{summary.detail}</span>
          </span>
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭计划有变提示"
          className="shrink-0 rounded p-0.5 text-text-faint transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <IconClose size={12} />
        </button>
      </div>

      <ul className="mt-1.5 space-y-1">
        {shown.map(c => (
          <li key={`${c.id}-${c.kind}`}>
            <button
              type="button"
              onClick={() => onSelect?.(c.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-raised/70 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
            >
              <span className="min-w-0 truncate text-2xs text-text-primary">
                {teamName(c.h)} vs {teamName(c.a)}
                <span className="ml-1 text-text-faint">{leagueName(c.league)}</span>
              </span>
              <span className="shrink-0 font-num text-2xs tabular-nums text-warn">{describeChange(c)}</span>
            </button>
          </li>
        ))}
      </ul>

      {list.length > shown.length && (
        <div className="mt-1 flex items-center justify-between px-1.5">
          <Meta>还有 {list.length - shown.length} 场</Meta>
          <Button variant="ghost" size="xs" onClick={onDismiss}>
            知道了
          </Button>
        </div>
      )}
    </section>
  );
}
