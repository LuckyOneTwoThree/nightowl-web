import { useMemo, useState } from 'react';
import { datePart, zhDate, weekdayOf } from '../core/format.js';
import { narrativeOf } from '../core/narrative.js';
import { evalOne, stateOf, heroTier, groupTonight } from '../core/owl.js';
import { decisionStrip } from '../core/decision-strip.js';
import { storylines, teamName } from '../data/index.js';
import HeroCard, { NoMatchCard } from './HeroCard.jsx';
import MatchRow from './MatchRow.jsx';
import { Button, Chip, IndexTag, LiveDot, Meta, SectionLabel, SleepBadge } from './atoms.jsx';
import { formatSleepHours } from '../core/sleep.js';
import { queueStatusOf } from '../core/queue.js';
import { sameNightLighterPicks } from '../core/owl.js';
import { sleepLedgerFor } from './SleepNote.jsx';
import { useScrollMemory } from '../hooks/useScrollMemory.js';

/** 夜猫指数口径说明 —— 从常驻版面收进 Hint（P2：界面不再解释自己） */
export const INDEX_HINT =
  '夜猫指数 = 看点权重 ÷（1 + 睡眠成本 + 观看占用）。看点权重由星级、故事线、主队与联赛偏好合成；分母是熬夜代价。指数越高，性价比越高。';

/**
 * 同开球对比（FR-10）
 *
 * 只在「当前主展示那场」存在同开球对手时出现 —— 周日 23:00 可能有七八场同开，
 * 全量列出只会变成第二份列表；用户要做的判断是「我选的这场，同时还有谁、另一场怎么办」。
 *
 * 每行只给取舍需要的四项：双方 / 指数 / 档位 / 剩余睡眠；
 * 动作只有两个：「看这场」（切右栏预览，不改算法计划）与「明早看」（进补看队列）。
 */
function SameKickoffPanel({ group, activeMatchId, prefs, onSelect, onWatchLater, watchLater = [] }) {
  const [hint, setHint] = useState(null);
  // 同开球最多同时出现 7 场（欧冠整轮 04:00 一起开）。逐条铺开会吃掉近 500px，
  // 把 Hero 和下面的赛程列表一起挤死 —— 默认只留一行摘要（场次 + 同组最高指数），
  // 展开后才逐条对比。判断"要不要看别的"并不需要先看到七行。
  const [expanded, setExpanded] = useState(false);
  if (group.length < 2) return null;
  const kickoff = String(group[0].t || '').split('T')[1] || '';
  const indexed = group.map(m => ({ m, index: evalOne(m, prefs).index }));
  const topIndex = indexed.reduce((max, x) => Math.max(max, x.index), 0);
  const visible = expanded ? group : [];

  return (
    <section
      aria-label="同开球对比"
      className="shrink-0 rounded-xl border border-line-hairline bg-surface-card/70 p-2.5"
    >
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="min-w-0 truncate text-2xs font-medium text-text-muted">
          {kickoff} 同开球 · {group.length} 场 · 最高 {topIndex.toFixed(1)}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="shrink-0 rounded px-1 py-0.5 text-2xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          {expanded ? '收起' : `展开 ${group.length}`}
        </button>
      </div>
      {expanded && (
        <div className="scrollbar-thin -mr-1 mt-1.5 max-h-[260px] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
          {visible.map(m => {
          const { index } = evalOne(m, prefs);
          const ledger = sleepLedgerFor(m, prefs);
          const active = m.id === activeMatchId;
          const queueState = queueStatusOf(watchLater, m.id);
          return (
            <div
              key={m.id}
              className={`rounded-lg px-2 py-1.5 ${
                active ? 'bg-surface-raised ring-1 ring-accent/40' : 'bg-surface-panel/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-text-primary">
                  {teamName(m.h)} vs {teamName(m.a)}
                </span>
                <IndexTag value={index} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <SleepBadge match={m} compact />
                  {ledger && !ledger.overWake && <Meta num>剩 {formatSleepHours(ledger.remainingHours)}</Meta>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={() => onSelect(m.id)} disabled={active}>
                    {active ? '展示中' : '看这场'}
                  </Button>
                  {onWatchLater && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        const r = onWatchLater(m);
                        if (!r?.ok) {
                          setHint(r?.reason === 'full' ? '补看队列已满，请先在设置里移除旧条目' : '更新补看失败');
                        } else {
                          setHint(null);
                        }
                      }}
                      data-watch-later-action="toggle"
                      title={
                        queueState === 'pending'
                          ? '点击移出补看'
                          : queueState === 'watched'
                            ? '已看过，点击重新加入待补看'
                            : '不熬夜，赛后补看这场'
                      }
                    >
                      {queueState === 'pending'
                        ? '已入补看 · 取消'
                        : queueState === 'watched'
                          ? '已看过 · 重新补看'
                          : '加入补看'}
                    </Button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        </div>
      )}
      {hint && <p className="mt-1 px-0.5 text-2xs text-warn">{hint}</p>}
    </section>
  );
}

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
  countdownText,
  replayPicks = [],
  onWatchLater,
  watchLater = [],
  onOpenSettings
}) {
  const { night, slice, hero, focal, minefieldIds } = tonight;

  const narrative = useMemo(
    () => (hero ? narrativeOf(hero.m, hero.ev, storylines) : null),
    [hero]
  );

  const tier = heroTier(hero);

  /**
   * 决策条（P1-1）：同一屏只出现一次，只给结论，不重算算法。
   * 替代场次用“同夜且更早结束”的候选池，而不是同夜推荐的前 4 ——
   * 后者按指数排序，Hero 通常就是最高分，早结束的场次会被挤掉。
   * 已标记看过的场次不进入替代，避免让人“换”到一场已经看掉的比赛。
   */
  const decision = useMemo(() => {
    if (!hero) return null;
    const alternatives = sameNightLighterPicks(hero.m, prefs, 50, now).filter(
      alt => queueStatusOf(watchLater, alt.m.id) !== 'watched'
    );
    const strip = decisionStrip({
      match: hero.m,
      index: hero.index,
      prefs,
      now,
      alternatives,
      followed: hero.ev?.isFollowed === true,
      spoilerFree: prefs.spoilerFree === true,
      revealed: revealed?.has ? revealed.has(hero.m.id) : false
    });
    const picked = strip.alternativeId
      ? alternatives.find(alt => alt.m.id === strip.alternativeId) || null
      : null;
    return { strip, alternative: picked };
  }, [hero, prefs, now, watchLater, revealed]);

  const heroQueueState = hero ? queueStatusOf(watchLater, hero.m.id) : 'none';

  // 按状态分区：进行中置顶（最该看）、未开赛按时间、已结束默认折叠不占屏。
  // 此前三类混在一个列表里 —— 用户分不清当前状态，刚终场还显示待录比分的
  // 场次会和真正未开赛的排在一起。
  // Hero 已在左栏单独展示，列表不再重复同一场；手机端一直是这个口径。
  const listSlice = useMemo(
    () => (hero ? slice.filter(m => m.id !== hero.m.id) : slice),
    [slice, hero]
  );
  const groups = useMemo(() => groupTonight(listSlice, now), [listSlice, now]);
  const [showFinished, setShowFinished] = useState(false);
  const listRef = useScrollMemory('tonight:list');

  /**
   * 同开球组（FR-10）：只取「当前主展示那场」所在的同开球组。
   * 只看还没开球的场次 —— 已经开球的两场谈不上「只能看一场」。
   */
  const sameKickoff = useMemo(() => {
    const focusId = activeMatchId || hero?.m?.id || null;
    if (!focusId) return [];
    const focus = slice.find(m => m.id === focusId);
    if (!focus || focus.tbd) return [];
    return slice.filter(m => !m.tbd && m.t === focus.t && stateOf(m, now) === 'sched');
  }, [slice, activeMatchId, hero, now]);

  const jumpToReplay = () => {
    const el = listRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  };

  const renderRow = m => {
    const { ev, index } = evalOne(m, prefs);
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
        rivalry={ev.rivalry}
        minefield={minefieldIds.has(m.id)}
        followedTeams={prefs.followedTeams}
        index={index}
      />
    );
  };

  const renderReplayRow = p => (
    <MatchRow
      key={p.m.id}
      m={p.m}
      state="finished"
      active={p.m.id === activeMatchId}
      now={now}
      onSelect={onSelect}
      spoilerFree={prefs.spoilerFree}
      revealed={revealed.has(p.m.id)}
      onReveal={onReveal}
      rivalry={p.ev.rivalry}
      minefield={false}
      dateLabel={zhDate(datePart(p.m.t))}
      badge={<Chip tone="neutral">{p.reason}</Chip>}
      showSleep={false}
      followedTeams={prefs.followedTeams}
    />
  );

  const SectionHead = ({ label, count, live }) => (
    <div className="flex items-center gap-1.5 pt-2 pb-1">
      {live && <LiveDot />}
      <span className={`text-xs font-semibold tracking-wide ${live ? 'text-live' : 'text-text-muted'}`}>
        {label}
      </span>
      <span className="font-num text-xs tabular-nums text-text-faint">· {count}</span>
    </div>
  );

  const listed = groups.live.length + groups.upcoming.length + groups.finished.length;
  const heroLive = !!hero && stateOf(hero.m, now) === 'live';
  const liveCount = groups.live.length + (heroLive ? 1 : 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {hero ? (
        <HeroCard
          hero={hero}
          tier={tier}
          narrative={narrative}
          state={stateOf(hero.m, now)}
          active={hero.m.id === activeMatchId}
          now={now}
          onWatch={onSelect}
          indexHint={INDEX_HINT}
          prefs={prefs}
          decision={decision?.strip || null}
          alternative={decision?.alternative || null}
          onSelectAlternative={onSelect}
          onOpenSettings={onOpenSettings}
          watchLaterState={heroQueueState}
          onWatchLater={onWatchLater}
        />
      ) : (
        <NoMatchCard focal={focal} countdown={countdownText} onSelect={onSelect} />
      )}

      {sameKickoff.length >= 2 && (
        <SameKickoffPanel
          group={sameKickoff}
          activeMatchId={activeMatchId}
          prefs={prefs}
          onSelect={onSelect}
          onWatchLater={onWatchLater}
          watchLater={watchLater}
        />
      )}

      <SectionLabel
        hint="06:00 前开球的凌晨场次归入今晚观赛"
        right={
          <span className="inline-flex items-center gap-2">
            {replayPicks.length > 0 && (
              <button
                type="button"
                onClick={jumpToReplay}
                aria-label="跳到最近值得补看"
                className="text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
              >
                补看 {replayPicks.length}
              </button>
            )}
            {replayPicks.length > 0 && (liveCount > 0 || listed > 0) && (
              <span className="text-text-faint" aria-hidden="true">·</span>
            )}
            {liveCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-live">
                <LiveDot />
                {liveCount} 场进行中
              </span>
            ) : listed > 0 ? (
              <span className="font-num text-xs tabular-nums text-text-faint">
                {hero ? `其余 ${listed} 场` : `${listed} 场`}
              </span>
            ) : null}
          </span>
        }
      >
        今晚赛程 · {zhDate(night)} {weekdayOf(night)}
      </SectionLabel>

      <div
        ref={listRef}
        className={`scrollbar-thin -mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 ${
          listed > 0 || replayPicks.length > 0 ? 'min-h-[180px]' : ''
        }`}
      >
        {listed === 0 && hero && (
          <p className="rounded-lg border border-line-hairline bg-surface-card px-3 py-3 text-center text-xs text-text-muted">
            今晚仅此一场焦点战。
          </p>
        )}
        {listed > 0 && (
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
                  className="flex w-full items-center gap-1.5 rounded-md pt-2 pb-1 text-left transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
                  aria-expanded={showFinished}
                >
                  <span className="text-xs font-semibold tracking-wide text-text-muted">
                    已结束
                  </span>
                  <span className="font-num text-xs tabular-nums text-text-faint">
                    · {groups.finished.length}
                  </span>
                  <span className="text-xs text-text-faint underline underline-offset-2">
                    {showFinished ? '收起' : '展开'}
                  </span>
                </button>
                {showFinished && groups.finished.map(renderRow)}
              </>
            )}
          </>
        )}

        {replayPicks.length > 0 && (
          <>
            <SectionHead label="最近值得补看 · 近 4 天" count={replayPicks.length} />
            {replayPicks.map(renderReplayRow)}
          </>
        )}
      </div>
    </div>
  );
}
