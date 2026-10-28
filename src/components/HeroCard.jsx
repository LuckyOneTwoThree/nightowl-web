import { hm, zhDate, weekdayOf, datePart, liveMinute, humanCountdownShort } from '../core/format.js';
import { teamName, leagueName, teamColor } from '../data/index.js';
import { ts, sleepTier, countdown as engineCountdown } from '../core/engine.js';
import { Button, Chip, Crest, Hint, LiveDot, Meta, SleepBadge, Stars } from './atoms.jsx';
import { IconCalendar, IconInfo, IconPlay, IconSignal, IconWarn } from './icons.jsx';
import { locateSection } from './locate.js';

/**
 * 三档措辞。指数 < 5 时不吹不硬推 —— 这是产品纪律，不是样式分支。
 * `ctaVariant: primary` 意味着它是本屏唯一的实心强调按钮。
 */
const TIER_COPY = {
  highlight: { label: '今晚焦点', cta: '开始观赛', ctaVariant: 'primary' },
  standard: { label: '今晚可看', cta: '开始观赛', ctaVariant: 'default' },
  weak: { label: '今夜无必看', cta: '仍要观看', ctaVariant: 'ghost' }
};

/** 主队色环境光：极低透明度径向光晕，仅作微弱氛围烘托 */
function TeamAura({ color, side }) {
  const pos = side === 'home' ? 'left-[-20%] top-[-30%]' : 'right-[-20%] top-[-30%]';
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute ${pos} h-36 w-36 rounded-full opacity-[0.09] blur-3xl`}
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
  const finished = state === 'finished' || state === 'ended_pending';
  const tierInfo = sleepTier(m.t);
  const tierCost = tierInfo.cost;
  const homeColor = teamColor(m.h);
  const awayColor = teamColor(m.a);

  // 已选中时按钮不能继续只做「再选中一次」：那会让首屏主行动点了毫无变化。
  // 改为直达右侧对应区块（滚动 + 高亮 + 焦点），按钮文案随状态变化。
  const activeAction = live
    ? { label: '查看直播线路', target: 'match-lines', icon: <IconSignal /> }
    : finished
      ? { label: '查看赛后回顾', target: 'match-recap', icon: <IconCalendar /> }
      : { label: '查看赛前情报', target: 'intel-panel', icon: <IconInfo /> };

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
        className={`no-drag card-lift relative overflow-hidden rounded-xl border bg-surface-card p-3 shadow-card transition-all ${
          active ? 'border-line-control' : 'border-line-hairline'
        }`}
      >
        <TeamAura color={homeColor} side="home" />
        <TeamAura color={awayColor} side="away" />
        <div className="relative flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs font-semibold text-text-secondary">{copy.label}</span>
            <Stars star={ev.star} />
            {ev.isFollowed && <Chip tone="neutral">主队</Chip>}
          </div>
          <div className="flex shrink-0 items-baseline gap-1">
            <span className="text-2xs text-text-faint">夜猫指数</span>
            <span className="font-num text-xl font-bold leading-none tabular-nums text-text-secondary">
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
          <div className="flex min-w-[76px] flex-col items-center">
            <span className="font-num text-xl font-bold leading-none tabular-nums text-text-primary">
              {m.tbd ? '--:--' : hm(m.t)}
            </span>
            <span className="mt-0.5 text-2xs text-text-faint">
              {m.tbd ? '时间待定' : countdownLabel ? `距开球 ${countdownLabel}` : `${leagueName(m.l)}`}
            </span>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1">
            <Crest id={m.a} size={30} />
            <span className="w-full truncate text-center text-sm font-semibold text-text-primary" title={teamName(m.a)}>
              {teamName(m.a)}
            </span>
          </div>
        </div>

        <div className="relative mt-2 flex items-center justify-between gap-2 border-t border-line-hairline pt-2">
          <div className="flex items-center gap-2">
            <SleepBadge match={m} />
            <span className="text-xs text-text-muted">指数低于 5.0 推荐线 · 仅供顺带参考</span>
          </div>
          {active && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="右侧展示中" aria-hidden="true" />
          )}
        </div>
        <Button
          variant="ghost"
          size="md"
          icon={active ? activeAction.icon : <IconPlay />}
          onClick={() => (active ? locateSection(activeAction.target, { focus: true }) : onWatch(m.id))}
          className="relative mt-2 w-full"
        >
          {active ? activeAction.label : copy.cta}
        </Button>
      </article>
    );
  }

  return (
    <article
      className={`no-drag card-lift relative overflow-hidden rounded-xl border p-3.5 shadow-card transition-all ${
        isHighlight
          ? `bg-gradient-to-br from-accent/[0.08] via-surface-card to-surface-panel ${
              active ? 'border-accent/55' : 'border-accent/25'
            }`
          : `bg-surface-card ${
              active ? 'border-line-control' : 'border-line-hairline'
            }`
      }`}
    >
      {/* 主客环境光 */}
      <TeamAura color={homeColor} side="home" />
      <TeamAura color={awayColor} side="away" />
      {isHighlight && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/65 to-transparent"
        />
      )}

      {/* 顶部：档位 + 星级 + 主队 + 指数仪表 */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={`text-xs font-semibold tracking-wide ${isHighlight ? 'text-accent' : 'text-text-secondary'}`}>
            {copy.label}
          </span>
          <Stars star={ev.star} />
          <span className="text-xs text-text-muted">· {leagueName(m.l)} 第 {m.r} 轮</span>
          {ev.isFollowed && <Chip tone="neutral">主队</Chip>}
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-live/15 px-2 py-0.5">
              <LiveDot />
              <span className="font-num text-2xs font-semibold tabular-nums text-live">{minute}′</span>
            </span>
          )}
        </div>

        {/* 夜猫指数 · 数字 + 5 格微型能量刻度 */}
        <div className="flex shrink-0 flex-col items-end">
          <div className="flex items-baseline gap-1">
            <span className="text-2xs text-text-faint">指数</span>
            <span className={`font-num text-2xl font-bold leading-none tracking-tight tabular-nums ${isWeak ? 'text-text-secondary' : 'text-accent'}`}>
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
                    : 'bg-line-control'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 对阵舞台：去除重复的「主队/客队」与下方重复时间行 */}
      <div className="relative mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
        {/* 主队 */}
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.h} size={40} />
          <span className="w-full truncate text-center text-base font-semibold tracking-tight text-text-primary" title={teamName(m.h)}>
            {teamName(m.h)}
          </span>
        </div>

        {/* 中央：开球时刻 / 倒计时 / 直播 */}
        <div className="flex min-w-[84px] flex-col items-center px-1">
          {live ? (
            <>
              <span className="font-num text-2xl font-bold leading-none tabular-nums text-live">{minute}′</span>
              <span className="mt-1 text-xs font-medium text-live">进行中</span>
            </>
          ) : (
            <>
              <span className="font-num text-2xl font-bold leading-none tabular-nums text-text-primary">
                {m.tbd ? '--:--' : hm(m.t)}
              </span>
              <span className="mt-1 text-xs text-text-muted">
                {m.tbd
                  ? '时间待定'
                  : countdownLabel
                    ? `距开球 ${countdownLabel}`
                    : `${zhDate(datePart(m.t))} ${weekdayOf(datePart(m.t))}`}
              </span>
            </>
          )}
        </div>

        {/* 客队 */}
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.a} size={40} />
          <span className="w-full truncate text-center text-base font-semibold tracking-tight text-text-primary" title={teamName(m.a)}>
            {teamName(m.a)}
          </span>
        </div>
      </div>

      {/* 主看点（单句短结论） */}
      <div className="relative mt-3 border-t border-line-hairline pt-2.5">
        <p className="line-clamp-2 text-xs font-medium leading-relaxed text-text-secondary">
          {narrative.headline}
        </p>
      </div>

      {/* 底部：睡眠代价 + 全宽主行动 */}
      <div className="relative mt-3 space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <SleepBadge match={m} />
          {tierCost >= 3.5 && (
            <span className="inline-flex items-center gap-1 text-xs text-danger">
              <IconWarn size={12} />
              熬夜代价高
            </span>
          )}
          {active && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              右侧展示中
            </span>
          )}
        </div>
        <Button
          variant={copy.ctaVariant}
          size="md"
          icon={active ? activeAction.icon : <IconPlay />}
          onClick={() => (active ? locateSection(activeAction.target, { focus: true }) : onWatch(m.id))}
          className={`w-full ${copy.ctaVariant === 'primary' ? 'shadow-pop' : ''}`}
        >
          {active ? activeAction.label : live ? '进入直播间' : copy.cta}
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
        <p className="text-sm font-semibold text-text-primary">今夜无赛 · 好好补觉</p>
        <p className="mt-1 text-xs text-text-muted">近期暂无已排期场次，可在「偏好与数据」中检查更新。</p>
      </article>
    );
  }

  const m = focal.m;
  return (
    <article className="no-drag card-lift relative overflow-hidden rounded-xl border border-line-hairline bg-surface-card p-3.5 shadow-card">
      <TeamAura color={teamColor(m.h)} side="home" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-text-secondary">今夜无赛 · 下一场焦点</span>
        <Stars star={focal.ev.star} />
      </div>

      <div className="relative mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.h} size={34} />
          <span className="w-full truncate text-center text-sm font-semibold tracking-tight text-text-primary" title={teamName(m.h)}>
            {teamName(m.h)}
          </span>
        </div>
        <span className="font-num text-xs text-text-faint">VS</span>
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Crest id={m.a} size={34} />
          <span className="w-full truncate text-center text-sm font-semibold tracking-tight text-text-primary" title={teamName(m.a)}>
            {teamName(m.a)}
          </span>
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-2 border-t border-line-hairline pt-2.5 text-xs text-text-muted">
        <span className="font-num tabular-nums">
          {zhDate(datePart(m.t))} {weekdayOf(datePart(m.t))} {hm(m.t)}
        </span>
        <span>
          {leagueName(m.l)} · 距开球 {countdown}
        </span>
      </div>

      <div className="relative mt-2.5 flex items-center justify-between gap-2">
        <SleepBadge match={m} />
        <Button variant="ghost" size="sm" onClick={() => onSelect(m.id)}>
          查看赛前情报
        </Button>
      </div>
    </article>
  );
}
