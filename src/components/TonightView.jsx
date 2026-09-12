import { useMemo } from 'react';
import { zhDate, weekdayOf } from '../core/format.js';
import { narrativeOf } from '../core/narrative.js';
import { evalOne, stateOf, heroTier } from '../core/owl.js';
import { storylines } from '../data/index.js';
import HeroCard, { NoMatchCard } from './HeroCard.jsx';
import MatchRow from './MatchRow.jsx';
import { EmptyState, SectionLabel } from './atoms.jsx';

/**
 * 今晚视图（Tonight）
 * 左栏：Hero 卡（分档）+ 今晚场次切片
 * 心智：3 秒决策今晚看哪场
 */
export default function TonightView({
  tonight,
  now,
  activeMatchId,
  onSelect,
  prefs,
  revealed,
  onReveal,
  countdownText
}) {
  const { night, slice, hero, focal, minefieldIds } = tonight;

  const narrative = useMemo(
    () => (hero ? narrativeOf(hero.m, hero.ev, storylines) : null),
    [hero]
  );

  const tier = heroTier(hero);
  const hasAny = slice.length > 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Hero 区 */}
      {hero ? (
        <HeroCard
          hero={hero}
          tier={tier}
          narrative={narrative}
          state={stateOf(hero.m, now)}
          now={now}
          onWatch={onSelect}
        />
      ) : (
        <NoMatchCard focal={focal} countdown={countdownText} onSelect={onSelect} />
      )}

      {/* 今晚全部场次 */}
      <div className="flex items-center justify-between">
        <SectionLabel>
          今晚全部场次 · {zhDate(night)} {weekdayOf(night)}
        </SectionLabel>
        <span className="font-mono text-[10px] text-slate-500">
          {slice.length} 场 · 夜猫口径归属昨夜
        </span>
      </div>

      {/* 列表 */}
      <div className="scrollbar-thin-dark -mr-1 flex-1 space-y-2 overflow-y-auto pr-1">
        {!hasAny && (
          <EmptyState
            icon="🌙"
            title="今晚没有比赛"
            desc="赛程已排至 2027 年 5 月，但当夜无排期。可切到「赛程日历」查看后续安排。"
          />
        )}

        {slice.map(m => {
          const { ev } = evalOne(m, prefs);
          return (
            <MatchRow
              key={m.id}
              m={m}
              state={stateOf(m, now)}
              active={m.id === activeMatchId}
              now={now}
              onSelect={onSelect}
              spoilerFree={prefs.spoilerFree}
              revealed={revealed.has(m.id)}
              onReveal={onReveal}
              star={ev.star}
              rivalry={ev.rivalry}
              locked={minefieldIds.has(m.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
