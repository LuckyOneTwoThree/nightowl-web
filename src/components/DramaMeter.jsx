import { Chip } from './atoms.jsx';
import { WATCH_HINT_LEVEL } from '../core/reveal.js';

/**
 * 无剧透剧情心电图（Drama Meter）
 *
 * 严格约束：
 *   · 仅展示由 src/core/drama.js 脱敏产出的标签与中性分钟脉冲点
 *   · 禁止在 DOM/aria-label/title 中暴露任何具体比分、胜负方或球队归属
 */
export default function DramaMeter({ drama, fallbackHint = null, compact = false }) {
  const tags = drama?.tags || [];
  const pulses = drama?.hasEvents ? drama.pulseMinutes || [] : [];

  if (tags.length === 0 && !fallbackHint && pulses.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length > 0 ? (
          tags.map(tag => (
            <Chip
              key={tag.id}
              tone={tag.tone === 'accent' ? 'accent' : tag.tone === 'warn' ? 'warn' : 'neutral'}
            >
              {tag.label}
            </Chip>
          ))
        ) : fallbackHint ? (
          <Chip tone={fallbackHint.level === WATCH_HINT_LEVEL.HIGH ? 'accent' : 'neutral'}>
            {fallbackHint.label}
          </Chip>
        ) : null}
        {!compact && drama?.degradedReason === 'no-events' && tags.length > 0 && (
          <span className="text-2xs text-text-faint">暂无时间轴，仅按赛果烈度标记</span>
        )}
      </div>

      {!compact && pulses.length > 0 && (
        <div
          className="mt-0.5 flex items-center gap-2"
          aria-label={`全场高能时间点脉冲共 ${pulses.length} 处`}
        >
          <span className="font-num text-[10px] text-text-faint">0&apos;</span>
          <div className="relative h-1.5 flex-1 rounded-full bg-surface-raised">
            {pulses.map(min => {
              const leftPct = Math.max(2, Math.min(98, Math.round((min / 100) * 100)));
              return (
                <span
                  key={min}
                  style={{ left: `${leftPct}%` }}
                  className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface-card"
                />
              );
            })}
          </div>
          <span className="font-num text-[10px] text-text-faint">90&apos;+</span>
        </div>
      )}
    </div>
  );
}
