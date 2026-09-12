import { useState } from 'react';
import { crestUrl, teamColor } from '../data/index.js';
import { sleepTier } from '../core/engine.js';
import { TIER_STYLE } from '../core/narrative.js';

/** 队徽：本地 PNG；未收录或加载失败时回退为队色圆标 + 三字码 */
export function Crest({ id, size = 28, className = '' }) {
  const [failed, setFailed] = useState(false);
  const url = crestUrl(id);

  if (!url || failed) {
    return (
      <span
        title={id}
        style={{ width: size, height: size, backgroundColor: teamColor(id) }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-black/20 dark:border-white/15 font-mono font-bold text-white shadow-sm ${className}`}
      >
        <span style={{ fontSize: Math.max(8, size * 0.34) }}>{id.slice(0, 3)}</span>
      </span>
    );
  }

  return (
    <span
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-white/5 dark:bg-white/[0.03] p-0.5 ${className}`}
    >
      <img
        src={url}
        alt={id}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className="h-full w-full object-contain filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
      />
    </span>
  );
}

/** 睡眠档位徽章（S0–S4）。tbd 场次不显示档位 */
export function SleepBadge({ match, compact = false }) {
  if (match.tbd) {
    return (
      <span className="rounded border border-dashed border-border-strong px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
        时间待定
      </span>
    );
  }
  const tier = sleepTier(match.t);
  const style = TIER_STYLE[tier.label] || TIER_STYLE.S0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-tight shadow-xs ${style}`}
      title={`睡眠成本 ${tier.cost}h`}
    >
      {tier.label}
      {!compact && <span className="font-normal opacity-85">{tier.cost}h</span>}
    </span>
  );
}

/** 星级 */
export function Stars({ star, className = '' }) {
  return (
    <span className={`font-mono text-[11px] tracking-tight text-primary-gold ${className}`} title={`${star} 星`}>
      {'★'.repeat(Math.max(0, Math.min(3, star)))}
    </span>
  );
}

/** 通用胶囊 */
export function Pill({ children, tone = 'slate', className = '', ...rest }) {
  const tones = {
    slate: 'bg-surface-elevated/80 text-text-muted',
    gold: 'bg-primary-gold-dim text-primary-gold font-bold',
    teal: 'bg-accent-teal/10 text-accent-teal font-semibold',
    purple: 'bg-accent-purple/10 text-accent-purple font-semibold',
    red: 'bg-live-red/15 text-live-red font-bold',
    warn: 'bg-warning-amber/10 text-warning-amber font-semibold'
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${tones[tone] || tones.slate} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

/** 直播中指示点 */
export function LiveDot({ className = '' }) {
  return <span className={`inline-block h-1.5 w-1.5 animate-live-pulse rounded-full bg-live-red shadow-[0_0_8px_rgba(226,75,74,0.6)] ${className}`} />;
}

/** 比分 / 状态文本（受防剧透控制） */
export function ScoreText({ match, state, revealed, onReveal, spoilerFree }) {
  if (match.st === 'done') {
    const score = match.sc || '—';
    if (spoilerFree && !revealed) {
      return (
        <button
          type="button"
          onClick={onReveal}
          className="rounded-md bg-surface-elevated px-2 py-0.5 font-mono text-[10px] font-medium text-text-muted transition-all hover:text-text-primary hover:bg-surface-hover shadow-2xs active:scale-95"
          title="点击揭晓比分"
        >
          👁️ 揭晓
        </button>
      );
    }
    return <span className="font-mono text-[12px] font-bold text-text-primary">{score}</span>;
  }

  if (state === 'live') return <LiveDot />;

  if (state === 'ended_pending') {
    return <span className="font-mono text-[10px] text-text-muted">待录比分</span>;
  }

  return <span className="font-mono text-[10px] text-text-muted">未开赛</span>;
}

/** 空态 */
export function EmptyState({ title, desc, icon = '○' }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <span className="font-mono text-3xl text-text-dim">{icon}</span>
      <p className="font-headline text-sm font-semibold text-text-primary">{title}</p>
      {desc && <p className="max-w-[260px] text-[11px] leading-relaxed text-text-muted">{desc}</p>}
    </div>
  );
}

/** 小标题 */
export function SectionLabel({ children, right = null }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">{children}</span>
      {right}
    </div>
  );
}
