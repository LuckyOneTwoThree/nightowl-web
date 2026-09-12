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
 * 左栏：Hero 卡（分档）+ 进行中置顶专区 + 今晚场次切片
 *
 * 优化重点：
 *   - 正在进行的比赛（LIVE）置顶优先展示，带强视觉呼吸光晕与专区标头
 *   - 其余待开球与已完赛场次紧随其后
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

  // 将当晚场次按是否处于 live 状态分流，进行中比赛绝对优先置顶
  const { liveMatches, otherMatches } = useMemo(() => {
    const live = [];
    const others = [];
    for (const m of slice) {
      if (stateOf(m, now) === 'live') {
        live.push(m);
      } else {
        others.push(m);
      }
    }
    return { liveMatches: live, otherMatches: others };
  }, [slice, now]);

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-hidden">
      {/* Hero 焦点区 */}
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

      {/* 栏目标题 */}
      <div className="flex items-center justify-between px-0.5">
        <SectionLabel>
          今晚赛程 · {zhDate(night)} {weekdayOf(night)}
        </SectionLabel>
        <span className="font-mono text-[10px] font-medium text-text-muted">
          {slice.length} 场 · 凌晨归属昨夜
        </span>
      </div>

      {/* 比赛列表容器 */}
      <div className="scrollbar-thin -mr-1 flex-1 space-y-2 overflow-y-auto pr-1">
        {!hasAny && (
          <EmptyState
            icon="🌙"
            title="今晚没有比赛"
            desc="赛程已排至 2027 年 5 月，但当夜无排期。可切到「赛程日历」查看后续安排。"
          />
        )}

        {/* 🔴 正在进行专区（置顶强标注，无生硬外框） */}
        {liveMatches.length > 0 && (
          <div className="space-y-1.5 rounded-xl bg-live-red/[0.06] p-2.5 shadow-xs">
            <div className="flex items-center justify-between px-1">
              <span className="flex items-center gap-1.5 font-headline text-[11px] font-bold text-live-red">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live-red opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-live-red shadow-[0_0_6px_rgba(226,75,74,0.8)]" />
                </span>
                正在进行 · {liveMatches.length} 场直播中
              </span>
              <span className="rounded bg-live-red/15 px-1.5 py-0.2 font-mono text-[9px] font-extrabold text-live-red">
                LIVE
              </span>
            </div>

            {liveMatches.map(m => {
              const { ev } = evalOne(m, prefs);
              return (
                <MatchRow
                  key={m.id}
                  m={m}
                  state="live"
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
        )}

        {/* 📋 今晚其余场次（待开球与已完赛） */}
        {otherMatches.length > 0 && (
          <div className="space-y-1.5">
            {liveMatches.length > 0 && (
              <div className="px-1 pt-1">
                <span className="font-mono text-[10px] font-semibold text-text-muted">
                  待开球与其余场次 ({otherMatches.length})
                </span>
              </div>
            )}
            {otherMatches.map(m => {
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
        )}
      </div>
    </div>
  );
}
