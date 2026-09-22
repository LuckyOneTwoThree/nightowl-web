import { hm, zhDate, weekdayOf, datePart, liveMinute, humanCountdown } from '../core/format.js';
import { teamName, leagueName, teamColor } from '../data/index.js';
import { ts, sleepTier, countdown as engineCountdown } from '../core/engine.js';
import { Button, Chip, Crest, Hint, LiveDot, Meta, SleepBadge, Stars } from './atoms.jsx';
import { IconPlay, IconWarn } from './icons.jsx';

/**
 * 三档措辞。指数 < 5 时不吹不硬推 —— 这是产品纪律，不是样式分支。
 * `ctaVariant: primary` 意味着它是本屏唯一的实心强调按钮。
 */
const TIER_COPY = {
  highlight: { label: '今晚焦点', cta: '开始观赛', ctaVariant: 'primary' },
  standard: { label: '今晚可看', cta: '开始观赛', ctaVariant: 'default' },
  weak: { label: '今夜无必看', cta: '仍要观看', ctaVariant: 'ghost' }
};

/** 主队色环境光：极低透明度径向光晕，让 Hero 有转播台的空气感 */
function TeamAura({ color, side }) {
  const pos = side === 'home' ? 'left-[-20%] top-[-30%]' : 'right-[-20%] top-[-30%]';
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute ${pos} h-40 w-40 rounded-full opacity-[0.14] blur-3xl`}
      style={{ backgroundColor: color || 'var(--accent)' }}
    />
  );
}

/**
 * 今晚之选 Hero 卡 · Broadcast Hero
 *
 * 设计目标：全屏情绪峰值。用户 3 秒内必须感到「今晚就该看这场」。
 * 但仍守纪律：品牌金只出现在描边 / 指数 / CTA，主队色只做 12–14% 环境光，
 * 不引入第二强调色体系。
 */
export default function HeroCard({ hero, tier, narrative, state, now, onWatch, indexHint }) {
  const m = hero.m;
  const ev = hero.ev;
  const copy = TIER_COPY[tier] || TIER_COPY.standard;
  const isHighlight = tier === 'highlight';
  const isWeak = tier === 'weak';

  const live = state === 'live';
  const minute = live ? liveMinute(ts(m.t), now) : 0;
  const tierInfo = sleepTier(m.t);
  const tierCost = tierInfo.cost;
  const homeColor = teamColor(m.h);
  const awayColor = teamColor(m.a);

  // 倒计时：仅未开赛时展示，秒级由父层 30s tick 足够（Hero 不需要秒跳）
  let countdownLabel = null;
  if (!live && state === 'sched' && !m.tbd) {
    const ms = ts(m.t) - now;
    if (ms > 0 && ms < 24 * 3600000) {
      countdownLabel = humanCountdown(engineCountdown(ts(m.t), now));
    }
  }

  return (
    <article
      className={`no-drag relative overflow-hidden rounded-xl p-4 transition-all duration-300 ${
        isHighlight
          ? 'border border-accent/45 bg-surface-card shadow-[0_8px_28px_-6px_rgba(245,185,66,0.18)]'
          : 'border border-line-hairline bg-surface-card shadow-card'
      }`}
    >
      {/* 主客环境光 */}
      <TeamAura color={homeColor} side="home" />
      <TeamAura color={awayColor} side="away" />
      {isHighlight && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent"
        />
      )}

      {/* 顶部：档位 + 星级 + 主队 + 指数仪表 */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`text-2xs font-semibold tracking-wide ${isHighlight ? 'text-accent' : 'text-text-muted'}`}>
            {copy.label}
          </span>
          <Stars star={ev.star} />
          {ev.isFollowed && <Chip tone="accent">主队</Chip>}
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-live/12 px-2 py-0.5">
              <LiveDot />
              <span className="font-num text-2xs font-semibold tabular-nums text-live">{minute}′</span>
            </span>
          )}
        </div>

        {/* 夜猫指数 · 仪表盘式 */}
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-2xs text-text-faint">夜猫指数</span>
          <div className="flex items-baseline gap-0.5">
            <span className={`font-num text-3xl font-bold leading-none tabular-nums ${isWeak ? 'text-text-secondary' : 'text-accent'}`}>
              {hero.index.toFixed(1)}
            </span>
            <Hint title="夜猫指数说明" content={indexHint} side="bottom" align="end" />
          </div>
          {/* 指数刻度条 */}
          <div className="mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-line-control">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isWeak ? 'bg-text-muted' : 'bg-accent'}`}
              style={{ width: `${Math.min(100, (hero.index / 30) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 对阵舞台 */}
      <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* 主队 */}
        <div className="flex min-w-0 flex-col items-end gap-1.5">
          <Crest id={m.h} size={44} className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]" />
          <span className="w-full truncate text-right text-base font-semibold text-text-primary" title={teamName(m.h)}>
            {teamName(m.h)}
          </span>
          <span className="text-2xs text-text-faint">主队</span>
        </div>

        {/* 中央：开球时刻 / 倒计时 / 直播 */}
        <div className="flex min-w-[88px] flex-col items-center px-1">
          {live ? (
            <>
              <span className="font-num text-2xl font-bold leading-none tabular-nums text-live">{minute}′</span>
              <span className="mt-1 text-2xs font-medium text-live">进行中</span>
            </>
          ) : countdownLabel ? (
            <>
              <span className="font-num text-2xl font-bold leading-none tabular-nums text-accent">{countdownLabel}</span>
              <span className="mt-1 text-2xs text-text-faint">距开球</span>
            </>
          ) : (
            <>
              <span className="font-num text-2xl font-bold leading-none tabular-nums text-text-primary">
                {m.tbd ? '--:--' : hm(m.t)}
              </span>
              <span className="mt-1 text-2xs text-text-faint">{m.tbd ? '时间待定' : '开球'}</span>
            </>
          )}
          <span className="mt-1 font-num text-2xs text-text-faint">VS</span>
        </div>

        {/* 客队 */}
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <Crest id={m.a} size={44} className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]" />
          <span className="w-full truncate text-base font-semibold text-text-primary" title={teamName(m.a)}>
            {teamName(m.a)}
          </span>
          <span className="text-2xs text-text-faint">客队</span>
        </div>
      </div>

      {/* 赛事元信息 */}
      <div className="relative mt-2 flex items-center justify-center gap-2">
        <Meta num>
          {m.tbd
            ? '时间待定'
            : `${zhDate(datePart(m.t))} ${weekdayOf(datePart(m.t))} ${hm(m.t)}`}
        </Meta>
        <Meta>
          {leagueName(m.l)} 第 {m.r} 轮
        </Meta>
      </div>

      {/* 主看点 */}
      <div className="relative mt-3 border-t border-line-hairline pt-2.5">
        <p className="text-sm font-medium leading-relaxed text-text-primary">{narrative.headline}</p>
      </div>

      {/* 底部：睡眠代价 + CTA */}
      <div className="relative mt-3.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <SleepBadge match={m} />
            {tierCost >= 3.5 && (
              <span className="inline-flex items-center gap-1 text-2xs text-danger">
                <IconWarn size={11} />
                熬夜代价高
              </span>
            )}
          </div>
          {/* 档位色阶细条：让睡眠成本一眼可感 */}
          <div className="flex h-1 w-28 gap-0.5" aria-hidden="true">
            {[0, 1, 2, 3, 4].map(i => {
              const on = Number((tierInfo.label || 'S0').replace('S', '')) >= i;
              const colors = ['bg-tier-0', 'bg-tier-1', 'bg-tier-2', 'bg-tier-3', 'bg-tier-4'];
              return (
                <span
                  key={i}
                  className={`h-full flex-1 rounded-full ${on ? colors[i] : 'bg-line-control'}`}
                  style={{ opacity: on ? 0.95 : 0.5 }}
                />
              );
            })}
          </div>
        </div>
        <Button
          variant={copy.ctaVariant}
          size="md"
          icon={<IconPlay />}
          onClick={() => onWatch(m.id)}
          className={copy.ctaVariant === 'primary' ? 'min-w-[112px] shadow-pop' : 'min-w-[112px]'}
        >
          {copy.cta}
        </Button>
      </div>
    </article>
  );
}

/** 无球日 / 全部 tbd 降级卡：下一场焦点战倒计时 */
export function NoMatchCard({ focal, countdown, onSelect }) {
  if (!focal) {
    return (
      <article className="no-drag rounded-xl border border-line-hairline bg-surface-card p-4 text-center shadow-card">
        <p className="text-sm font-medium text-text-primary">近期没有可安排的比赛</p>
        <p className="mt-1 text-2xs text-text-muted">赛程数据可能尚未同步，可在「偏好与数据」中手动同步。</p>
      </article>
    );
  }

  const m = focal.m;
  return (
    <article className="no-drag relative overflow-hidden rounded-xl border border-line-hairline bg-surface-card p-4 shadow-card">
      <TeamAura color={teamColor(m.h)} side="home" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold text-text-muted">今夜无球 · 下一场焦点</span>
        <Stars star={focal.ev.star} />
      </div>

      <div className="relative mt-3 flex items-center justify-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Crest id={m.h} size={28} />
          <span className="truncate text-sm font-semibold text-text-primary">{teamName(m.h)}</span>
        </div>
        <span className="font-num text-2xs text-text-faint">VS</span>
        <div className="flex min-w-0 items-center gap-2">
          <Crest id={m.a} size={28} />
          <span className="truncate text-sm font-semibold text-text-primary">{teamName(m.a)}</span>
        </div>
      </div>

      <div className="relative mt-3 flex flex-col items-center border-t border-line-hairline pt-2.5">
        <span className="text-2xs text-text-faint">距开球</span>
        <span className="font-num text-2xl font-bold tabular-nums text-accent">{countdown}</span>
        <Meta num className="mt-0.5">
          {zhDate(datePart(m.t))} {weekdayOf(datePart(m.t))} {hm(m.t)} · {leagueName(m.l)}
        </Meta>
      </div>

      <Button variant="default" size="md" className="relative mt-3 w-full" onClick={() => onSelect(m.id)}>
        查看赛前情报
      </Button>
    </article>
  );
}
