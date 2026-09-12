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
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-black/40 font-mono font-bold text-white/90 ${className}`}
      >
        <span style={{ fontSize: Math.max(8, size * 0.34) }}>{id.slice(0, 3)}</span>
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={id}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full object-contain ${className}`}
    />
  );
}

/** 睡眠档位徽章（S0–S4）。tbd 场次不显示档位 */
export function SleepBadge({ match, compact = false }) {
  if (match.tbd) {
    return (
      <span className="rounded border border-dashed border-border-strong px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
        时间待定
      </span>
    );
  }
  const tier = sleepTier(match.t);
  const style = TIER_STYLE[tier.label] || TIER_STYLE.S0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${style}`}
      title={`睡眠成本 ${tier.cost}h`}
    >
      {tier.label}
      {!compact && <span className="font-normal opacity-80">{tier.cost}h</span>}
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
    slate: 'border-border-subtle bg-surface-card text-slate-400',
    gold: 'border-primary-gold/40 bg-primary-gold/10 text-primary-gold',
    teal: 'border-accent-teal/40 bg-accent-teal/10 text-accent-teal',
    purple: 'border-accent-purple/40 bg-accent-purple/10 text-accent-purple',
    red: 'border-live-red/40 bg-live-red/10 text-live-red',
    warn: 'border-warning-amber/40 bg-warning-amber/10 text-warning-amber'
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${tones[tone] || tones.slate} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

/** 直播中指示点 */
export function LiveDot({ className = '' }) {
  return <span className={`inline-block h-1.5 w-1.5 animate-live-pulse rounded-full bg-live-red ${className}`} />;
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
          className="rounded border border-border-subtle bg-surface-elevated/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 transition-colors hover:border-border-strong hover:text-slate-200"
          title="点击揭晓比分"
        >
          点击揭晓
        </button>
      );
    }
    return <span className="font-mono text-[11px] font-semibold text-slate-300">{score}</span>;
  }

  if (state === 'live') return <LiveDot />;

  if (state === 'ended_pending') {
    return <span className="font-mono text-[10px] text-slate-500">待录比分</span>;
  }

  return <span className="font-mono text-[10px] text-slate-500">未开赛</span>;
}

/** 空态 */
export function EmptyState({ title, desc, icon = '○' }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="font-mono text-2xl text-slate-600">{icon}</span>
      <p className="font-headline text-sm font-semibold text-slate-300">{title}</p>
      {desc && <p className="max-w-[260px] text-[11px] leading-relaxed text-slate-500">{desc}</p>}
    </div>
  );
}

/** 小标题 */
export function SectionLabel({ children, right = null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">{children}</span>
      {right}
    </div>
  );
}
