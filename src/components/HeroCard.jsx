import { hm, zhDate, weekdayOf, datePart, liveMinute, humanCountdownShort } from '../core/format.js';
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
export default function HeroCard({
  hero,
  tier,
  narrative,
  state,
  active = false,
  now,
  onWatch,
  indexHint
}) {
  const m = hero.m;
  const ev = hero.ev;
  const copy = TIER_COPY[tier] || TIER_COPY.standard;
  const isHighlight = tier === 'highlight';
  const isWeak = tier === 'weak';
  const energyFill = Math.max(1, Math.min(5, Math.ceil(hero.index / 6)));

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
      countdownLabel = humanCountdownShort(engineCountdown(ts(m.t), now));
    }
  }

  // 弱夜不占首屏主位：保留「仍要观看」入口，但用结论卡替代大倒计时 Hero，
  // 把纵向空间还给今晚列表（1120/1366 下列表被挤到不可用的直接原因之一）。
  if (isWeak && !live) {
    return (
      <article
        className={`no-drag card-lift relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.035] via-surface-card/90 to-surface-panel p-3 ring-1 transition-all ${
          active ? 'ring-line-control' : 'ring-white/[0.06]'
        }`}
      >
        <TeamAura color={homeColor} side="home" />
        <TeamAura color={awayColor} side="away" />
        <div className="relative flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-2xs font-semibold tracking-wide text-text-muted">{copy.label}</span>
            <Stars star={ev.star} />
            {ev.isFollowed && <Chip tone="neutral">主队</Chip>}
          </div>
          <div className="flex shrink-0 items-baseline gap-1">
            <span className="text-2xs text-text-faint">夜猫指数</span>
            <span className="font-num text-2xl font-bold leading-none tabular-nums text-text-secondary">
              {hero.index.toFixed(1)}
            </span>
            <Hint title="夜猫指数说明" content={indexHint} side="bottom" align="end" />
          </div>
        </div>

        <div className="relative mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex min-w-0 flex-col items-center gap-1">
            <Crest id={m.h} size={30} />
            <span className="w-full truncate text-center text-sm font-semibold text-text-primary" title={teamName(m.h)}>
              {teamName(m.h)}
            </span>
          </div>
          <div className="flex min-w-[72px] flex-col items-center">
            <span className="font-num text-xl font-bold leading-none tabular-nums text-text-primary">
              {m.tbd ? '--:--' : hm(m.t)}
            </span>
            <span className="mt-0.5 text-2xs text-text-faint">
              {m.tbd ? '时间待定' : countdownLabel ? `距开球 ${countdownLabel}` : '开球'}
            </span>
            <span className="mt-0.5 font-num text-2xs text-text-faint">VS</span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1">
            <Crest id={m.a} size={30} />
            <span className="w-full truncate text-center text-sm font-semibold text-text-primary" title={teamName(m.a)}>
              {teamName(m.a)}
            </span>
          </div>
        </div>

        <div className="relative mt-1.5 flex items-center justify-center gap-2 truncate text-2xs text-text-muted">
          <Meta num>
            {m.tbd ? '时间待定' : `${zhDate(datePart(m.t))} ${weekdayOf(datePart(m.t))} ${hm(m.t)}`}
          </Meta>
          <Meta>{leagueName(m.l)} 第 {m.r} 轮</Meta>
        </div>

        <p className="relative mt-2 border-t border-white/[0.06] pt-2 text-2xs leading-relaxed text-text-secondary">
          今晚之选指数低于 5.0 推荐线；如果仍想看，这是今晚相对可接受的一场。
        </p>

        <div className="relative mt-2 flex items-center gap-2">
          <SleepBadge match={m} />
          {active && (
            <span className="ml-auto inline-flex items-center gap-1 text-2xs text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent/80" aria-hidden="true" />
              右侧展示中
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="md"
          icon={<IconPlay />}
          onClick={() => onWatch(m.id)}
          className="relative mt-2 w-full"
        >
          {copy.cta}
        </Button>
      </article>
    );
  }

  return (
    <article
      className={`no-drag card-lift relative overflow-hidden rounded-2xl p-4 transition-all ${
        isHighlight
          ? `bg-gradient-to-br from-accent/[0.10] via-surface-card/95 to-surface-panel ring-1 ${
              active ? 'ring-accent/45' : 'ring-accent/20'
            }`
          : `bg-gradient-to-br from-white/[0.035] via-surface-card/90 to-surface-panel ring-1 ${
              active ? 'ring-line-control' : 'ring-white/[0.06]'
            }`
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
          {ev.isFollowed && <Chip tone="neutral">主队</Chip>}
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-live/12 px-2 py-0.5">
              <LiveDot />
              <span className="font-num text-2xs font-semibold tabular-nums text-live">{minute}′</span>
            </span>
          )}
        </div>

        {/* 夜猫指数 · 数字 + 5 格微型能量刻度 */}
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-2xs tracking-wide text-text-faint">夜猫指数</span>
          <div className="flex items-baseline gap-1">
            <span className={`font-num text-3xl font-bold leading-none tracking-tight tabular-nums ${isWeak ? 'text-text-secondary' : 'text-accent'}`}>
              {hero.index.toFixed(1)}
            </span>
            <Hint title="夜猫指数说明" content={indexHint} side="bottom" align="end" />
          </div>
          <div className="mt-1 flex items-center gap-0.5" aria-hidden="true">
            {[1, 2, 3, 4, 5].map(step => (
              <span
                key={step}
                className={`h-1 w-2.5 rounded-full ${
                  step <= energyFill
                    ? isWeak
                      ? 'bg-text-secondary'
                      : 'bg-accent'
                    : 'bg-white/[0.12]'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 对阵舞台：队名独占整列宽度，避免 330px 左栏把「拜仁慕尼黑」截成「拜仁…」 */}
      <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* 主队 */}
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.h} size={42} className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]" />
          <span className="w-full truncate text-center text-base font-semibold tracking-tight text-text-primary" title={teamName(m.h)}>
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
          ) : (
            <>
              {/* 大倒计时交给右侧 Match Center；Hero 只保留开球时刻与一行短倒计时，避免双大数字 */}
              <span className="font-num text-2xl font-bold leading-none tabular-nums text-text-primary">
                {m.tbd ? '--:--' : hm(m.t)}
              </span>
              <span className="mt-1 text-2xs text-text-faint">
                {m.tbd ? '时间待定' : countdownLabel ? `距开球 ${countdownLabel}` : '开球'}
              </span>
            </>
          )}
          <span className="mt-1 font-num text-2xs text-text-faint">VS</span>
        </div>

        {/* 客队 */}
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.a} size={42} className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]" />
          <span className="w-full truncate text-center text-base font-semibold tracking-tight text-text-primary" title={teamName(m.a)}>
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
      <div className="relative mt-3 border-t border-white/[0.06] pt-3">
        <p className="text-sm font-medium leading-relaxed text-text-primary">{narrative.headline}</p>
      </div>

      {/* 底部：睡眠代价 + 全宽主行动 */}
      <div className="relative mt-3.5 space-y-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SleepBadge match={m} />
          {tierCost >= 3.5 && (
            <span className="inline-flex items-center gap-1 text-2xs text-danger">
              <IconWarn size={11} />
              熬夜代价高
            </span>
          )}
          {active && (
            <span className="ml-auto inline-flex items-center gap-1 text-2xs text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent/80" aria-hidden="true" />
              右侧展示中
            </span>
          )}
        </div>
        <Button
          variant={copy.ctaVariant}
          size="md"
          icon={<IconPlay />}
          onClick={() => onWatch(m.id)}
          className={`w-full ${copy.ctaVariant === 'primary' ? 'shadow-pop' : ''}`}
        >
          {live ? '进入直播间' : active ? `${copy.cta} · 聚焦本场` : copy.cta}
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
    <article className="no-drag card-lift relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.035] via-surface-card/90 to-surface-panel p-4 ring-1 ring-white/[0.06]">
      <TeamAura color={teamColor(m.h)} side="home" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold tracking-wide text-text-muted">今夜无球 · 下一场焦点</span>
        <Stars star={focal.ev.star} />
      </div>

      <div className="relative mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.h} size={34} />
          <span className="w-full truncate text-center text-base font-semibold tracking-tight text-text-primary" title={teamName(m.h)}>
            {teamName(m.h)}
          </span>
        </div>
        <span className="font-num text-2xs text-text-faint">VS</span>
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.a} size={34} />
          <span className="w-full truncate text-center text-base font-semibold tracking-tight text-text-primary" title={teamName(m.a)}>
            {teamName(m.a)}
          </span>
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <Meta num>
          {zhDate(datePart(m.t))} {weekdayOf(datePart(m.t))} {hm(m.t)}
        </Meta>
        <Meta>
          {leagueName(m.l)} · 距开球 {countdown}
        </Meta>
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-2">
        <SleepBadge match={m} />
        <Button variant="ghost" size="md" onClick={() => onSelect(m.id)}>
          查看赛前情报
        </Button>
      </div>
    </article>
  );
}
