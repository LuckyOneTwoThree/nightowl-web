import { useState } from 'react';
import { crestUrl, teamColor, leagueColor, leagueName } from '../data/index.js';
import { sleepTier } from '../core/engine.js';
import { TIER_MAP } from '../core/narrative.js';
import { IconClose, IconEmpty, IconInfo, IconReveal, IconStars } from './icons.jsx';

/* ================================================================== */
/* 原子层                                                             */
/*                                                                    */
/* 这一层的职责是"把设计 token 变成可复用件"，因此它是全站唯一可以      */
/* 直接写颜色/圆角/阴影类的地方。业务组件应当用这里的件，而不是自己    */
/* 拼一个圆角盒子 —— 此前每个组件各自发明按钮与胶囊，是视觉发散的根源。 */
/* ================================================================== */

/**
 * 官方品牌图标：严格遵循圆角阶梯、微光描边与高保真防溢出
 * @param {number} size - 图标像素尺寸（如 24, 26, 30, 36, 88）
 * @param {'sm'|'md'|'lg'|'xl'|'2xl'|'3xl'} rounded - 圆角规格（严格受 tailwind.config 约束）
 * @param {boolean} withGlow - 是否带有琥珀微光光晕与金边高光
 * @param {string} className - 额外容器类
 */
export function BrandLogo({ size = 26, rounded = 'md', className = '', withGlow = false }) {
  const roundCls = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
    '3xl': 'rounded-3xl'
  }[rounded] || 'rounded-md';

  return (
    <span
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/15 bg-[#0e121d] shadow-sm transition-transform duration-300 ${roundCls} ${
        withGlow
          ? 'border-accent/40 shadow-[0_0_14px_rgba(245,185,66,0.32)]'
          : 'shadow-[0_2px_8px_rgba(0,0,0,0.5)]'
      } ${className}`}
    >
      <img
        src="/favicon.png"
        alt="夜猫看台"
        width={size}
        height={size}
        className="h-full w-full object-cover select-none pointer-events-none"
        loading="eager"
      />
    </span>
  );
}

/** 队徽：本地 PNG；未收录或加载失败时回退为队色圆标 + 三字码 */
export function Crest({ id, size = 28, className = '' }) {
  const [failed, setFailed] = useState(false);
  const url = crestUrl(id);

  if (!url || failed) {
    return (
      <span
        title={id}
        style={{ width: size, height: size, backgroundColor: teamColor(id) }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-num font-bold text-white ${className}`}
      >
        <span style={{ fontSize: Math.max(9, size * 0.34) }}>{id.slice(0, 3)}</span>
      </span>
    );
  }

  return (
    <span
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
    >
      <img
        src={url}
        alt={id}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 文本与标签                                                          */
/* ------------------------------------------------------------------ */

/**
 * 元信息：纯文字，无边框无底色。
 *
 * 存在的理由：联赛 / 轮次 / 日期 / 时长这类**辅助事实**此前全部装在胶囊里，
 * 一屏几十个盒子互相争抢注意力。它们不需要"被点击的暗示"，降级成文字后
 * 版面立刻安静下来。需要状态语义的才用 Chip。
 */
export function Meta({ children, className = '', num = false }) {
  return (
    <span className={`text-2xs leading-none text-text-muted ${num ? 'font-num tabular-nums' : ''} ${className}`}>
      {children}
    </span>
  );
}

/** 状态标签：只用于**有语义**的状态（档位 / 直播 / 主队 / 警告） */
export function Chip({ tone = 'neutral', children, className = '' }) {
  const tones = {
    neutral: 'bg-white/[0.04] border border-white/[0.06] text-text-muted',
    accent: 'bg-accent/15 border border-accent/30 text-accent shadow-[0_0_8px_rgba(245,185,66,0.15)]',
    live: 'bg-live/15 border border-live/30 text-live shadow-[0_0_8px_rgba(226,86,79,0.15)]',
    warn: 'bg-warn/15 border border-warn/30 text-warn',
    danger: 'bg-danger/15 border border-danger/30 text-danger',
    resource: 'bg-resource/15 border border-resource/30 text-resource'
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium leading-snug ${
        tones[tone] || tones.neutral
      } ${className}`}
    >
      {children}
    </span>
  );
}

/** 睡眠档位徽章（S0–S4）。tbd 场次不显示档位 */
export function SleepBadge({ match, compact = false, className = '' }) {
  if (match.tbd) {
    return <Meta className={className}>时间待定</Meta>;
  }
  const tier = sleepTier(match.t);
  const style = TIER_MAP[tier.label] || TIER_MAP.S0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-px font-num text-2xs font-semibold leading-snug tabular-nums ${style.soft} ${style.text} ${className}`}
      title={`${tier.zh}档 · 睡眠成本 ${tier.cost} 小时`}
    >
      {tier.label}
      {!compact && <span className="opacity-80">{tier.cost}h</span>}
    </span>
  );
}

/** 星级（看点权重） */
export function Stars({ star, className = '' }) {
  return <IconStars count={star} className={className} />;
}

/** 直播状态点：唯一的"动"元素，全站不再叠加 ping / 发光 */
export function LiveDot({ className = '' }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 animate-live-pulse rounded-full bg-live ${className}`}
    />
  );
}

/** 比分 / 状态文本（受防剧透控制） */
export function ScoreText({ match, state, revealed, onReveal, spoilerFree, stalePending = false }) {
  if (match.st === 'done') {
    if (spoilerFree && !revealed) {
      return (
        <button
          type="button"
          onClick={onReveal}
          className="inline-flex items-center gap-1 rounded px-1.5 py-px text-2xs text-text-faint transition-colors hover:bg-surface-press hover:text-text-primary"
          title="点击揭晓比分"
        >
          <IconReveal />
          揭晓
        </button>
      );
    }
    return <span className="font-num text-xs font-semibold tabular-nums text-text-primary">{match.sc || '—'}</span>;
  }

  if (state === 'live') return <LiveDot />;
  if (state === 'ended_pending') {
    // 区分两种「没比分」，否则用户会以为应用坏了：
    //   · 刚终场（< 24h）—— 上游还没更新，正常等待
    //   · 超过 24h 仍无 —— 上游压根没提供这场（如某些联赛的冷门场次）
    return stalePending ? (
      <Meta title="上游数据源未提供该场比分（已超过 24 小时），可尝试在设置中重新同步">上游未提供</Meta>
    ) : (
      <Meta title="比赛刚结束，等待上游更新比分">待录比分</Meta>
    );
  }
  if (state === 'pp') return <Meta>延期</Meta>;
  return <Meta>未开赛</Meta>;
}

/* ------------------------------------------------------------------ */
/* 控件                                                               */
/* ------------------------------------------------------------------ */

/**
 * 按钮：全站唯一按钮实现。
 *
 * variant 只有四种，且**一屏只允许出现一个 primary**。
 * 此前顶栏同时存在虚线金边、实心青边、纯文字三种"按钮"，
 * 用户无法判断哪个是主行动 —— 收敛到这里就不再有这个问题。
 */
export function Button({
  variant = 'default',
  size = 'sm',
  icon = null,
  children,
  className = '',
  type = 'button',
  ...rest
}) {
  const variants = {
    primary: 'bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 text-accent-ink hover:brightness-105 font-semibold shadow-[0_0_16px_rgba(245,185,66,0.25)]',
    default: 'bg-gradient-to-b from-[#1c2436] to-[#121722] border border-white/[0.08] text-text-primary hover:border-white/20 hover:from-[#222c42] hover:to-[#161c2b] shadow-sm',
    ghost: 'border border-white/[0.08] bg-white/[0.03] text-text-secondary hover:bg-white/[0.08] hover:border-white/20 hover:text-text-primary transition-all',
    danger: 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20'
  };
  const sizes = {
    sm: 'px-2.5 py-1 text-2xs',
    md: 'px-3.5 py-1.5 text-xs'
  };
  return (
    <button
      type={type}
      className={`no-drag inline-flex items-center justify-center gap-1.5 rounded-md transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${
        variants[variant] || variants.default
      } ${sizes[size] || sizes.sm} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** 图标按钮（无文字，用于紧凑工具条） */
export function IconButton({ children, label, className = '', ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`no-drag inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 开关 */
export function Switch({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        on ? 'bg-accent' : 'bg-line-control'
      }`}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-card transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** 分段选择器（视图切换 / 线路切换 / 联赛筛选共用） */
export function Segmented({ items, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#101522]/70 p-0.5 shadow-inner backdrop-blur-sm ${className}`} role="tablist">
      {items.map(it => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-all ${
              active
                ? 'border border-accent/40 bg-gradient-to-r from-accent/25 via-accent/15 to-accent/10 font-semibold text-accent shadow-[0_0_12px_rgba(245,185,66,0.2)]'
                : 'border border-transparent text-text-muted hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-text-primary'
            }`}
          >
            {it.icon}
            {it.label}
            {it.trailing}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 筛选条 / 多选条（联赛筛选、球队分类、关注联赛共用）
 *
 * 此前这三处各自手写了一份 pill，字号、内距、选中态颜色已经开始发散。
 * 收敛到这里，选中态全站只有一个表达方式：**同一层底色 + 品牌色文字**。
 */
export function TogglePill({
  on,
  onClick,
  label,
  count = null,
  color = null,
  hint = null,
  disabled = false,
  className = '',
  ...rest
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={hint || undefined}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted ${
        on
          ? 'bg-surface-accent font-medium text-accent'
          : 'text-text-muted hover:bg-surface-raised hover:text-text-secondary'
      } ${className}`}
      {...rest}
    >
      {color && (
        <span
          className="h-2.5 w-0.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      {label}
      {count != null && (
        <span className={`font-num tabular-nums ${on ? 'text-accent/70' : 'text-text-faint'}`}>{count}</span>
      )}
    </button>
  );
}

/**
 * 悬浮说明：把"界面在解释自己"的长句收进这里。
 *
 * 算法公式、口径规则、实现状态这类内容**不是决策信息**，不该常驻版面；
/**
 * 口径说明（Hint）
 *
 * 界面只展示事实，不解释自己。但口径确实需要可查，所以给一个稳定的入口。
 * 默认向上展示，当处于顶部容器时可指定 side="bottom"，避免被顶栏或外层截断。
 */
export function Hint({
  content,
  title = null,
  children = null,
  align = 'center',
  side = 'top',
  className = ''
}) {
  const posAlign = {
    center: 'left-1/2 -translate-x-1/2',
    start: 'left-0',
    end: 'right-0'
  }[align] || 'left-1/2 -translate-x-1/2';

  const posSide = side === 'bottom'
    ? 'top-full mt-2'
    : 'bottom-full mb-2';

  return (
    <span className={`group/hint relative inline-flex items-center ${className}`}>
      {children ? (
        <span
          tabIndex={0}
          role="button"
          aria-label="查看说明"
          className="inline-flex cursor-help items-center outline-none transition-colors focus-visible:text-text-primary"
        >
          {children}
        </span>
      ) : (
        <span
          tabIndex={0}
          role="button"
          aria-label="查看说明"
          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-text-faint outline-none transition-colors hover:text-text-secondary focus-visible:text-text-secondary"
        >
          <IconInfo size={13} />
        </span>
      )}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 ${posSide} ${posAlign} hidden w-max max-w-[240px] rounded-lg border border-white/15 bg-[#1a2336] p-2.5 text-left text-2xs font-normal leading-relaxed text-text-secondary shadow-[0_12px_32px_rgba(0,0,0,0.85)] group-hover/hint:block group-focus-within/hint:block`}
      >
        {title && <div className="mb-1 font-semibold text-accent text-2xs">{title}</div>}
        {content}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 版式                                                               */
/* ------------------------------------------------------------------ */

/** 栏目标题：小、静、只负责分组，不抢内容 */
export function SectionLabel({ children, right = null, hint = null, className = '' }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <span className="inline-flex items-center gap-1 text-2xs font-medium text-text-muted">
        {children}
        {hint ? <Hint content={hint} align="start" /> : null}
      </span>
      {right}
    </div>
  );
}

/** 分区：小标题 + 内容，用留白与 hairline 分隔，而不是再套一层圆角盒子 */
export function Fieldset({ title, right, hint, children, className = '' }) {
  return (
    <section className={`border-t border-line-hairline pt-3 first:border-t-0 first:pt-0 ${className}`}>
      <SectionLabel right={right} hint={hint} className="mb-2">
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

/** 空态：一句话 + 一个出口，不解释原理 */
export function EmptyState({ icon = null, title, desc, action = null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="text-text-faint">{icon || <IconEmpty />}</span>
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {desc && <p className="max-w-[280px] text-xs leading-relaxed text-text-muted">{desc}</p>}
      {action}
    </div>
  );
}

/** 联赛身份：2px 色条 + 文字，取代此前满屏的联赛胶囊 */
export function LeagueMark({ code, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className="h-2.5 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: leagueColor(code) }}
        aria-hidden="true"
      />
      <span className="text-2xs text-text-muted">{leagueName(code)}</span>
    </span>
  );
}

/** 可移除的已选项（关注球队 / 关注联赛共用） */
export function RemovableChip({ children, onRemove, leading = null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-accent py-0.5 pl-2 pr-1 text-2xs text-accent">
      {leading}
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label="移除"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-accent/70 transition-colors hover:bg-accent/20 hover:text-accent"
      >
        <IconClose size={11} />
      </button>
    </span>
  );
}
