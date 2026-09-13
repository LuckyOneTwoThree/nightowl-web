import { useMemo, useState } from 'react';
import { zhDate, weekdayOf } from '../core/format.js';
import { narrativeOf } from '../core/narrative.js';
import { evalOne, stateOf, heroTier, groupTonight } from '../core/owl.js';
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

  // 按状态分区：进行中置顶（最该看）、未开赛按时间、已结束默认折叠不占屏。
  // 此前三类混在一个列表里 —— 用户分不清当前状态，刚终场还显示待录比分的
  // 场次会和真正未开赛的排在一起。
  const groups = useMemo(() => groupTonight(slice, now), [slice, now]);
  const [showFinished, setShowFinished] = useState(false);

  const renderRow = m => {
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
  };

  const SectionHead = ({ label, count, live }) => (
    <div className="flex items-center gap-1.5 pt-2 pb-1">
      {live && <LiveDot />}
      <span className={`text-2xs font-semibold tracking-wide ${live ? 'text-live' : 'text-text-faint'}`}>
        {label}
      </span>
      <span className="font-num text-2xs tabular-nums text-text-faint">· {count}</span>
    </div>
  );

  const total = groups.live.length + groups.upcoming.length + groups.finished.length;

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
          groups.live.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-2xs text-live">
              <LiveDot />
              {groups.live.length} 场进行中
            </span>
          ) : (
            <span className="font-num text-2xs tabular-nums text-text-faint">{total} 场</span>
          )
        }
      >
        今晚赛程 · {zhDate(night)} {weekdayOf(night)}
      </SectionLabel>

      <div className="scrollbar-thin -mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {total === 0 ? (
          <EmptyState
            icon={<IconEmpty size={24} />}
            title="今晚没有比赛"
            desc="赛程已排至 2027 年 5 月，但当夜无排期。"
          />
        ) : (
          <>
            {groups.live.length > 0 && (
              <>
                <SectionHead label="进行中" count={groups.live.length} live />
                {groups.live.map(renderRow)}
              </>
            )}
            {groups.upcoming.length > 0 && (
              <>
                <SectionHead label="未开赛" count={groups.upcoming.length} />
                {groups.upcoming.map(renderRow)}
              </>
            )}
            {groups.finished.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowFinished(v => !v)}
                  className="flex w-full items-center gap-1.5 pt-2 pb-1 text-left"
                  aria-expanded={showFinished}
                >
                  <span className="text-2xs font-semibold tracking-wide text-text-faint">
                    已结束
                  </span>
                  <span className="font-num text-2xs tabular-nums text-text-faint">
                    · {groups.finished.length}
                  </span>
                  <span className="text-2xs text-text-faint underline underline-offset-2">
                    {showFinished ? '收起' : '展开'}
                  </span>
                </button>
                {showFinished && groups.finished.map(renderRow)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
