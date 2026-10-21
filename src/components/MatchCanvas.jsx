import { useMemo } from 'react';
import { hm, zhDate, weekdayOf, datePart } from '../core/format.js';
import { teamName, teamColor, leagueName } from '../data/index.js';
import { computeMatchStats } from '../core/stats.js';
import { eventSummary } from '../core/live-events.js';
import { Button, Chip, Crest, Meta } from './atoms.jsx';
import { IconPlay, IconReset, IconSignal } from './icons.jsx';

const FORM_DOT = {
  W: 'bg-result-win',
  D: 'bg-result-draw',
  L: 'bg-result-loss'
};

function FormDots({ form }) {
  if (!form?.length) return <Meta>暂无近况</Meta>;
  return (
    <div className="flex items-center gap-1" aria-label="近 5 场战绩">
      {form.map(x => (
        <span
          key={`${x.matchId}-${x.date}`}
          title={`${x.isHome ? '主' : '客'} vs ${teamName(x.opponent)} ${x.score}`}
          className={`h-2 w-2 rounded-full ${FORM_DOT[x.result] || 'bg-line-control'}`}
        />
      ))}
    </div>
  );
}

function StatCell({ title, children }) {
  return (
    <div className="min-w-0 border-l border-white/[0.06] pl-3 first:border-l-0 first:pl-0">
      <Meta className="block">{title}</Meta>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * 赛前 / 进行中 / 终场的 Match Center 画布
 *
 * 只在没有视频流时出现，替代此前的“黑底 + 一个比分”。全部使用真实数据：
 * 近况来自已完赛 fixtures，交锋来自 computeHeadToHead，赛季来自 computeSeasonStats。
 * 不使用虚构阵型 / xG / 控球率。
 */
export default function MatchCanvas({
  match,
  state,
  stageCountdown,
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
  onScrollToHighlights
}) {
  const finished = state === 'finished' || state === 'ended_pending';
  const hasFinal = match.st === 'done';
  const live = state === 'live';
  const postponed = state === 'pp';
  const hidden = spoilerFree && !revealed;
  const stats = useMemo(() => computeMatchStats(match), [match]);

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

  const h2h = stats?.h2h;
  const homeForm = stats?.home?.form || [];
  const awayForm = stats?.away?.form || [];
  const homeSeason = stats?.home?.season;
  const awaySeason = stats?.away?.season;
  const lastEvent = live && liveData?.events?.length ? liveData.events[liveData.events.length - 1] : null;
  const ticker = lastEvent
    ? `${lastEvent.clock || ''} ${eventSummary(lastEvent, match)}`.trim()
    : finished
      ? hasFinal
        ? '比赛已结束，查看回顾或集锦'
        : '已终场，等待比分录入'
      : live
        ? '等待实时事件'
        : '赛前情报与线路已就绪';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* 低饱和主客色分屏 + 极简中圈，提供转播台氛围 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-y-0 left-0 w-1/2 opacity-[0.20]"
          style={{ background: `linear-gradient(135deg, ${homeColor}, transparent 68%)` }}
        />
        <div
          className="absolute inset-y-0 right-0 w-1/2 opacity-[0.20]"
          style={{ background: `linear-gradient(225deg, ${awayColor}, transparent 68%)` }}
        />
        <div className="absolute left-1/2 top-1/2 h-[42%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.055]" />
        <div className="absolute left-1/2 top-[6%] h-[88%] w-px -translate-x-1/2 bg-white/[0.045]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(7,10,16,0.10)_0%,rgba(7,10,16,0.72)_76%)]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-5 sm:py-4">
        {/* 顶栏：联赛 / 状态 / 开球信息 */}
        <div className="flex items-center justify-between gap-2 pr-9">
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate text-2xs text-text-secondary">
              {leagueName(match.l)} 第 {match.r} 轮
            </span>
            <Chip tone={statusTone} className="shrink-0">
              {statusLabel}
            </Chip>
          </span>
          <Meta num className="shrink-0">
            {match.tbd ? '时间待定' : `${zhDate(datePart(match.t))} ${weekdayOf(datePart(match.t))} ${hm(match.t)}`}
          </Meta>
        </div>

        {/* 主舞台：双方 + 大比分/倒计时 */}
        <div className="flex min-h-0 flex-1 items-center justify-center gap-4 py-1.5 sm:gap-8">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <Crest id={match.h} size={54} className="drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]" />
            <span className="w-full truncate text-center text-base font-semibold text-text-primary sm:text-lg" title={teamName(match.h)}>
              {teamName(match.h)}
            </span>
            <span className="text-2xs text-text-faint">主队</span>
          </div>

          <div className="flex min-w-[128px] shrink-0 flex-col items-center">
            {postponed ? (
              <span className="font-num text-2xl font-semibold text-warn">延期</span>
            ) : finished ? (
              hidden ? (
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
              )
            ) : live ? (
              hidden ? (
                <Button variant="default" onClick={onReveal}>
                  揭晓实时比分
                </Button>
              ) : (
                <span
                  key={score ? `${score.h}-${score.a}` : 'live'}
                  aria-live="polite"
                  aria-atomic="true"
                  className="animate-score-pop font-num text-display font-bold leading-none text-text-primary"
                >
                  {score ? `${score.h} - ${score.a}` : '—'}
                </span>
              )
            ) : match.tbd ? (
              <span className="font-num text-2xl font-semibold text-text-muted">--:--</span>
            ) : (
              <span
                key={stageCountdown}
                aria-live="polite"
                className="font-num text-display font-bold leading-none tracking-tight text-accent"
              >
                {stageCountdown}
              </span>
            )}

            <span className="mt-1.5 text-2xs font-medium text-text-muted">
              {postponed
                ? '本场延期'
                : finished
                  ? hidden
                    ? '比分已隐藏'
                    : '终场'
                  : live
                    ? minuteLabel
                    : match.tbd
                      ? '时间待定'
                      : '距开球'}
            </span>
            {!postponed && !finished && !live && !match.tbd && (
              <span className="mt-0.5 font-num text-2xs text-text-faint">{hm(match.t)} 开球</span>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <Crest id={match.a} size={54} className="drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]" />
            <span className="w-full truncate text-center text-base font-semibold text-text-primary sm:text-lg" title={teamName(match.a)}>
              {teamName(match.a)}
            </span>
            <span className="text-2xs text-text-faint">客队</span>
          </div>
        </div>

        {/* 真实数据三联：近况 / 交锋 / 赛季 */}
        <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-3 border-t border-white/[0.06] pt-2.5">
          <StatCell title="近 5 场">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-2xs text-text-secondary">{teamName(match.h)}</span>
                <FormDots form={homeForm} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-2xs text-text-secondary">{teamName(match.a)}</span>
                <FormDots form={awayForm} />
              </div>
            </div>
          </StatCell>

          <StatCell title="历史交锋">
            {h2h?.summary?.total ? (
              <div className="space-y-1">
                <div className="font-num text-2xs text-text-secondary">
                  主 {h2h.summary.t1Wins} · 平 {h2h.summary.draws} · 客 {h2h.summary.t2Wins}
                </div>
                {h2h.meetings?.[0] ? (
                  <Meta num className="block">
                    最近 {h2h.meetings[0].score} · {zhDate(datePart(h2h.meetings[0].date))}
                  </Meta>
                ) : null}
              </div>
            ) : (
              <Meta>暂无交锋</Meta>
            )}
          </StatCell>

          <StatCell title="赛季">
            <div className="space-y-1 font-num text-2xs text-text-secondary">
              <div className="flex items-center justify-between gap-2" title="胜-平-负">
                <span className="truncate">{teamName(match.h)}</span>
                <span>{homeSeason?.played ? `${homeSeason.wins}-${homeSeason.draws}-${homeSeason.losses}` : '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-2" title="胜-平-负">
                <span className="truncate">{teamName(match.a)}</span>
                <span>{awaySeason?.played ? `${awaySeason.wins}-${awaySeason.draws}-${awaySeason.losses}` : '—'}</span>
              </div>
            </div>
          </StatCell>
        </div>

        {/* 叙事 + 操作 */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-text-secondary" title={ticker}>
            {hidden && live ? '比分已隐藏' : ticker}
          </p>
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
                  <Button variant="ghost" onClick={onScrollToIntel}>
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
}
