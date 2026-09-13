import { useMemo } from 'react';
import { zhDate, weekdayOf } from '../core/format.js';
import { narrativeOf } from '../core/narrative.js';
import { evalOne, stateOf, heroTier } from '../core/owl.js';
import { storylines } from '../data/index.js';
import HeroCard, { NoMatchCard } from './HeroCard.jsx';
import MatchRow from './MatchRow.jsx';
import { EmptyState, LiveDot, SectionLabel } from './atoms.jsx';
import { IconEmpty } from './icons.jsx';

/** 夜猫指数口径说明 —— 从常驻版面收进 Hint（P2：界面不再解释自己） */
export const INDEX_HINT =
  '夜猫指数 = 看点权重 ÷（1 + 睡眠成本 + 观看占用）。看点权重由星级、故事线、主队与联赛偏好合成；分母是熬夜代价。指数越高，性价比越高。';

/**
 * 今晚视图（Tonight）
 *
 * 左栏职责：今晚之选 Hero 卡 → 当夜全部场次。
 * 正在进行不再单独开一个带底色与呼吸光晕的专区 —— 那会让列表出现两种行高、
 * 两种底色、两套标题，扫描动线被打断。直播行改为在行内用红点与分钟数表达，
 * 并整体置顶排序，位置即优先级。
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

  // 直播场次整体置顶，不再另起容器
  const ordered = useMemo(() => {
    const live = [];
    const rest = [];
    for (const m of slice) {
      (stateOf(m, now) === 'live' ? live : rest).push(m);
    }
    return [...live, ...rest];
  }, [slice, now]);

  const liveCount = ordered.filter(m => stateOf(m, now) === 'live').length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {hero ? (
        <HeroCard
          hero={hero}
          tier={tier}
          narrative={narrative}
          state={stateOf(hero.m, now)}
          now={now}
          onWatch={onSelect}
          indexHint={INDEX_HINT}
        />
      ) : (
        <NoMatchCard focal={focal} countdown={countdownText} onSelect={onSelect} />
      )}

      <SectionLabel
        right={
          liveCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-2xs text-live">
              <LiveDot />
              {liveCount} 场进行中
            </span>
          ) : (
            <span className="font-num text-2xs tabular-nums text-text-faint">{slice.length} 场</span>
          )
        }
      >
        今晚赛程 · {zhDate(night)} {weekdayOf(night)}
      </SectionLabel>

      <div className="scrollbar-thin -mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {ordered.length === 0 ? (
          <EmptyState
            icon={<IconEmpty size={24} />}
            title="今晚没有比赛"
            desc="赛程已排至 2027 年 5 月，但当夜无排期。"
          />
        ) : (
          ordered.map(m => {
            const { ev } = evalOne(m, prefs);
            const st = stateOf(m, now);
            return (
              <MatchRow
                key={m.id}
                m={m}
                state={st}
                active={m.id === activeMatchId}
                now={now}
                onSelect={onSelect}
                spoilerFree={prefs.spoilerFree}
                revealed={revealed.has(m.id)}
                onReveal={onReveal}
                star={ev.star}
                rivalry={ev.rivalry}
                minefield={minefieldIds.has(m.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
