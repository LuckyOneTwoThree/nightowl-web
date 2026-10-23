import { useMemo } from 'react';
import { upcomingForTeams } from '../core/owl.js';
import { hm, weekdayOf, zhDate } from '../core/format.js';
import { teamName } from '../data/index.js';
import { tierOf } from '../core/engine.js';
import { TIER_MAP } from '../core/narrative.js';
import { Crest } from './atoms.jsx';

const TIER_TONE = Object.fromEntries(
  Object.entries(TIER_MAP).map(([label, tier]) => [label, tier.text])
);

/**
 * 左栏底部的“接下来”：列表内容不足时，用真实后续赛程补足纵向空间，
 * 同时把当前选中场次之后的决策信息放在手边。
 */
export default function NextUpRail({ match, onSelect, onOpenWeek, onOpenSchedule }) {
  const items = useMemo(() => {
    if (!match) return [];
    const { home, away } = upcomingForTeams(match);
    const seen = new Set();
    return [...home, ...away]
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => String(a.t).localeCompare(String(b.t)))
      .slice(0, 3);
  }, [match]);

  return (
    <section className="rounded-xl bg-surface-card/40 p-3 ring-1 ring-white/[0.05]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold tracking-wide text-text-muted">接下来</span>
        {onOpenWeek && (
          <button
            type="button"
            onClick={onOpenWeek}
            className="rounded-md px-1.5 py-0.5 text-2xs font-medium text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-primary focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
          >
            本周规划 →
          </button>
        )}
      </div>

      {match && (
        <p className="mt-1 truncate text-2xs text-text-faint">
          {teamName(match.h)} / {teamName(match.a)} 的下一场
        </p>
      )}

      {items.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {items.map(item => {
            const tier = tierOf(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(item.id)}
                  aria-label={`查看 ${teamName(item.h)} 对 ${teamName(item.a)} 的比赛`}
                  title="查看这场比赛"
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.05] focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
                >
                  <span className="w-[5.5rem] shrink-0 whitespace-nowrap font-num text-2xs tabular-nums text-text-faint">
                    {item.t.slice(5, 10).replace('-', '/')} {hm(item.t)}
                  </span>
                  <Crest id={item.h} size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-2xs text-text-secondary">
                    {teamName(item.h)} <span className="text-text-faint">vs</span> {teamName(item.a)}
                  </span>
                  <span className={`shrink-0 font-num text-2xs font-semibold tabular-nums ${TIER_TONE[tier.label] || ''}`}>
                    {tier.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-2xs text-text-faint">
            {match ? '暂无已排期的后续比赛' : '选中一场比赛后查看后续赛程'}
          </span>
          {onOpenSchedule && (
            <button
              type="button"
              onClick={onOpenSchedule}
              className="shrink-0 text-2xs font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
            >
              查看赛程
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2">
          <span className="text-2xs text-text-faint">
            {zhDate(items[0].t.slice(0, 10))} {weekdayOf(items[0].t.slice(0, 10))} 起
          </span>
          {onOpenSchedule && (
            <button
              type="button"
              onClick={onOpenSchedule}
              className="text-2xs font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
            >
              全季赛程
            </button>
          )}
        </div>
      )}
    </section>
  );
}
