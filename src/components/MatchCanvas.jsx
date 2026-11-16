import { memo, useEffect, useMemo, useState } from 'react';
import { shouldHideScore } from '../core/reveal.js';
import { hm, humanCountdown, zhDate, weekdayOf, datePart } from '../core/format.js';
import { countdown as engineCountdown, MATCH_DURATION_MS, ts } from '../core/engine.js';
import { teamName, teamColor, leagueName } from '../data/index.js';
import { eventSummary } from '../core/live-events.js';
import { Button, Chip, Crest, LiveDot, Meta } from './atoms.jsx';
import { IconPlay, IconReset, IconSignal } from './icons.jsx';

/**
 * 叶子级秒级倒计时子组件：把 1 秒定时器隔离在此叶子内，
 * 避免父级 PlayerStage（1700+ 行）每秒整棵重渲染。
 */
function KickoffCountdown({ matchTime }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = null;
    const tick = () => setNow(Date.now());
    const syncVisibility = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        tick();
        timer = setInterval(tick, 1000);
      }
    };
    syncVisibility();
    document?.addEventListener?.('visibilitychange', syncVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document?.removeEventListener?.('visibilitychange', syncVisibility);
    };
  }, []);

  const text = useMemo(() => humanCountdown(engineCountdown(ts(matchTime), now)), [matchTime, now]);
  const isWithin2Hours = /^(0[01]:\d{2}:\d{2}|02:00:00)$/.test(text);

  if (isWithin2Hours) {
    return (
      <>
        <div
          aria-live="polite"
          aria-label={`倒计时 ${text}`}
          className="flex items-center gap-1 font-num tabular-nums"
        >
          {text.split(':').map((unit, idx) => (
            <span key={idx} className="inline-flex items-center gap-1">
              {idx > 0 && <span className="text-xl font-bold text-text-faint">:</span>}
              <span className="inline-flex min-w-[44px] items-center justify-center rounded-lg border border-line-control bg-surface-panel/80 px-2 py-1 text-2xl font-bold leading-none tracking-tight text-text-primary shadow-inner sm:text-3xl">
                {unit}
              </span>
            </span>
          ))}
        </div>
        <span className="mt-1.5 font-num text-xs text-text-muted">距开球</span>
      </>
    );
  }

  return (
    <>
      <span className="font-num text-display font-bold leading-none tracking-tight text-text-primary">
        {hm(matchTime)}
      </span>
      <span aria-live="polite" className="mt-1.5 font-num text-xs tabular-nums text-text-muted">
        距开球 {text}
      </span>
    </>
  );
}

/**
 * 赛前 / 进行中 / 终场的 Match Center 画布
 *
 * 只在没有视频流时出现，提供纯净的转播台焦点：
 *   · 赛前 > 2h：显示大号开球时刻 + 指数/睡眠档位/星级胶囊，倒计时退居次要辅助文字
 *   · 赛前 ≤ 2h：切换为秒级倒计时翻牌模式
 *   · 进行中 / 终场：大比分（支持防剧透揭晓）与实时状态
 *   · 底部保留完整主操作状态机（播放 / 打开线路 / 检测线路 / 查看线路 / 情报 / 看回顾 / 看集锦）
 */
const MatchCanvas = memo(function MatchCanvas({
  match,
  state,
  isNearKickoff = false,
  liveData,
  lines,
  loadingLines,
  spoilerFree = true,
  revealed = false,
  onReveal,
  onPlay,
  onRefreshLines,
  onShowLines,
  onScrollToIntel,
  onScrollToRecap,
  onScrollToHighlights,
  topControls = null
}) {
  const finished = state === 'finished' || state === 'ended_pending';
  const hasFinal = match.st === 'done';
  const live = state === 'live';
  const postponed = state === 'pp';
  const hidden = shouldHideScore(spoilerFree, revealed);
  // 已过完赛窗口但上游还没给比分：此时没有比分可揭晓。
  // 旧实现仍然渲染「揭晓比分」，点下去只是把 — 露出来，看起来像按钮坏了。
  const endedPending = finished && !hasFinal;
  const stalePending =
    endedPending && Date.now() - (ts(match.t) + MATCH_DURATION_MS) > 24 * 3600000;

  const homeColor = teamColor(match.h);
  const awayColor = teamColor(match.a);

  const score = useMemo(() => {
    if (finished && /^\d+-\d+$/.test(match.sc || '')) {
      const [h, a] = match.sc.split('-').map(Number);
      return { h, a };
    }
    if (live && liveData?.score) return liveData.score;
    return null;
  }, [finished, live, liveData, match.sc]);

  const statusLabel = postponed ? '延期' : finished ? '已终场' : live ? '进行中' : '未开赛';
  const statusTone = postponed ? 'warn' : finished ? 'neutral' : live ? 'live' : 'neutral';
  const minuteLabel = live ? liveData?.minuteLabel || '进行中' : '';

  const directLine = (lines || []).find(l => l.isDirect && l.url);
  const hasLines = (lines || []).length > 0;
  const canPlayNow = live || isNearKickoff;
  const actionLabel = canPlayNow ? (directLine ? '播放' : hasLines ? '打开线路' : '检测线路') : '查看线路';
  const ActionIcon = canPlayNow ? (directLine ? <IconPlay /> : hasLines ? <IconSignal /> : <IconReset />) : <IconSignal />;
  const runPrimary = canPlayNow ? (directLine || hasLines ? onPlay : onRefreshLines) : onShowLines;

  const lastEvent = live && liveData?.events?.length ? liveData.events[liveData.events.length - 1] : null;
  const ticker = lastEvent
    ? `${lastEvent.clock || ''} ${eventSummary(lastEvent, match)}`.trim()
    : finished
      ? hasFinal
        ? '比赛已结束，查看回顾或集锦'
        : stalePending
          ? '上游数据源未提供该场比分，可稍后重新同步'
          : '已终场，等待上游更新比分'
      : live
        ? '等待实时事件'
        : hasLines
          ? '赛前情报与线路已就绪'
          : '赛前情报已就绪 · 直播线路待接入';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* 低饱和主客色分屏 + 极简中圈，提供转播台氛围 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-y-0 left-0 w-1/2 opacity-[0.18]"
          style={{ background: `linear-gradient(135deg, ${homeColor}, transparent 68%)` }}
        />
        <div
          className="absolute inset-y-0 right-0 w-1/2 opacity-[0.18]"
          style={{ background: `linear-gradient(225deg, ${awayColor}, transparent 68%)` }}
        />
        <div className="absolute left-1/2 top-1/2 h-[42%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.055]" />
        <div className="absolute left-1/2 top-[6%] h-[88%] w-px -translate-x-1/2 bg-white/[0.045]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(7,10,16,0.10)_0%,rgba(7,10,16,0.72)_76%)]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-5 sm:py-4">
        {/* 顶栏：联赛 / 状态 / 开球信息 / 舞台工具按钮（同处 Flex 流，避免右上角悬浮控件遮挡开球时间） */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-text-secondary">
              {leagueName(match.l)} 第 {match.r} 轮
            </span>
            <Chip tone={statusTone} className="shrink-0">
              {statusLabel}
            </Chip>
          </span>
          <div className="flex shrink-0 items-center gap-2.5">
            <Meta num data-canvas-kickoff className="shrink-0 whitespace-nowrap">
              {match.tbd ? '时间待定' : `${zhDate(datePart(match.t))} ${weekdayOf(datePart(match.t))} ${hm(match.t)}`}
            </Meta>
            {topControls && (
              <>
                <span className="h-3.5 w-px shrink-0 bg-line-control/70" aria-hidden="true" />
                <div className="flex shrink-0 items-center gap-1.5">{topControls}</div>
              </>
            )}
          </div>
        </div>

        {/* 主舞台：双方 + 大比分/开球时刻/倒计时
            两侧列限宽 200px：此前是 flex-1，在 1440 下把两队推到相隔 600px 的两极，
            中央只剩倒计时，形成「哑铃」结构。限宽后整组居中，视觉重心回到中央。 */}
        <div className="flex min-h-0 flex-1 items-center justify-center gap-6 py-2 sm:gap-10">
          <div className="flex min-w-0 max-w-[200px] flex-1 flex-col items-center gap-2">
            <Crest id={match.h} size={56} className="drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]" />
            <span className="w-full truncate text-center text-base font-semibold text-text-primary sm:text-lg" title={teamName(match.h)}>
              {teamName(match.h)}
            </span>
          </div>

          <div className="flex min-w-[160px] shrink-0 flex-col items-center">
            {postponed ? (
              <>
                <span className="font-num text-2xl font-semibold text-warn">延期</span>
                <span className="mt-1.5 text-xs font-medium text-text-muted">本场延期</span>
              </>
            ) : finished ? (
              endedPending ? (
                <>
                  <span className="font-num text-2xl font-semibold text-text-muted">—</span>
                  <span className="mt-1.5 text-xs font-medium text-text-muted">
                    {stalePending ? '上游数据源未提供该场比分' : '等待上游更新比分'}
                  </span>
                </>
              ) : (
                <>
                  {hidden ? (
                    <Button variant="default" onClick={onReveal}>
                      揭晓比分
                    </Button>
                  ) : (
                    <span
                      key={match.sc}
                      className="animate-score-pop font-num text-display font-bold leading-none text-text-primary"
                    >
                      {score ? `${score.h} - ${score.a}` : '—'}
                    </span>
                  )}
                  <span className="mt-1.5 text-xs font-medium text-text-muted">
                    {hidden ? '比分已隐藏' : '终场'}
                  </span>
                </>
              )
            ) : live ? (
              !score ? (
                <>
                  <span className="font-num text-2xl font-semibold text-text-muted">—</span>
                  <span className="mt-1.5 text-xs font-medium text-text-muted">等待实时比分</span>
                </>
              ) : (
                <>
                  {hidden ? (
                    <Button variant="default" onClick={onReveal}>
                      揭晓实时比分
                    </Button>
                  ) : (
                    <span
                      key={`${score.h}-${score.a}`}
                      aria-live="polite"
                      aria-atomic="true"
                      className="animate-score-pop font-num text-display font-bold leading-none text-text-primary"
                    >
                      {score.h} - {score.a}
                    </span>
                  )}
                  <span className="mt-1.5 text-xs font-medium text-live">{minuteLabel}</span>
                </>
              )
            ) : match.tbd ? (
              <>
                <span className="font-num text-2xl font-semibold text-text-muted">--:--</span>
                <span className="mt-1.5 text-xs font-medium text-text-muted">时间待定</span>
              </>
            ) : (
              <KickoffCountdown matchTime={match.t} />
            )}
          </div>

          <div className="flex min-w-0 max-w-[200px] flex-1 flex-col items-center gap-2">
            <Crest id={match.a} size={56} className="drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]" />
            <span className="w-full truncate text-center text-base font-semibold text-text-primary sm:text-lg" title={teamName(match.a)}>
              {teamName(match.a)}
            </span>
          </div>
        </div>

        {/* 叙事 + 操作 */}
        <div className="mt-auto flex items-center justify-between gap-2 rounded-lg border border-line-hairline bg-surface-panel/70 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {live ? (
              <LiveDot />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" aria-hidden="true" />
            )}
            <p className="min-w-0 truncate text-xs text-text-secondary" title={ticker}>
              {hidden && live ? '比分已隐藏' : ticker}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {finished ? (
              hasFinal ? (
                <>
                  <Button variant="ghost" onClick={onScrollToRecap}>
                    看回顾
                  </Button>
                  <Button variant="ghost" onClick={onScrollToHighlights}>
                    看集锦
                  </Button>
                </>
              ) : null
            ) : (
              <>
                <Button
                  variant="default"
                  icon={ActionIcon}
                  onClick={runPrimary}
                  disabled={loadingLines}
                >
                  {loadingLines ? '检测中…' : actionLabel}
                </Button>
                {onScrollToIntel && (
                  <Button variant="text" onClick={onScrollToIntel} title="定位到赛前情报">
                    情报
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default MatchCanvas;
