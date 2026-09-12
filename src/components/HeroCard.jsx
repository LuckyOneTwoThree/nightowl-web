import { hm, liveMinute, zhDate, weekdayOf, datePart } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts } from '../core/engine.js';
import { Crest, SleepBadge, Stars, Pill, LiveDot } from './atoms.jsx';

const TIER_COPY = {
  highlight: { badge: '今晚唯一焦点', tone: 'gold', cta: '立即观赛' },
  standard: { badge: '今晚可看', tone: 'slate', cta: '开始观赛' },
  weak: { badge: '今夜无必看', tone: 'slate', cta: '仍要观看' }
};

/**
 * 今晚之选 Hero 卡（D9 分档）
 *
 * highlight  指数 ≥ 15  完整高光态
 * standard   5 ≤ 指数 < 15  去"唯一焦点"措辞，ROI 弱化
 * weak       指数 < 5   不吹不硬推
 */
export default function HeroCard({ hero, tier, narrative, state, now, onWatch }) {
  const m = hero.m;
  const ev = hero.ev;
  const copy = TIER_COPY[tier] || TIER_COPY.standard;
  const isHighlight = tier === 'highlight';
  const isWeak = tier === 'weak';

  const kickTs = ts(m.t);
  const live = state === 'live';
  const minute = live ? liveMinute(kickTs, now) : 0;

  return (
    <article
      className={`no-drag rounded-xl border p-3.5 transition-colors ${
        isHighlight
          ? 'border-primary-gold/40 bg-gradient-to-b from-[#1E1B18] to-surface-card'
          : isWeak
            ? 'border-border-subtle bg-surface-card/60'
            : 'border-border-subtle bg-surface-card'
      }`}
    >
      {/* 头部：徽章 + 指数 + 直播态 */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Pill tone={copy.tone}>{copy.badge}</Pill>
          <Stars star={ev.star} />
        </div>
        <div className="flex items-center gap-1.5">
          {live && (
            <Pill tone="red">
              <LiveDot />
              LIVE {minute}′
            </Pill>
          )}
          {!isWeak && (
            <span
              className={`font-mono text-[13px] font-bold tabular-nums ${
                isHighlight ? 'text-primary-gold' : 'text-slate-400'
              }`}
              title="夜猫指数 = 看点权重 ÷（1 + 睡眠成本 + 观看占用）"
            >
              指数 {hero.index.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* 对阵行 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Crest id={m.h} size={36} />
          <div className="min-w-0">
            <p className="truncate font-headline text-sm font-semibold text-slate-100">{teamName(m.h)}</p>
            <p className="font-mono text-[10px] text-slate-500">主场</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center px-1">
          <span className={`font-mono text-[20px] font-bold tabular-nums ${live ? 'text-live-red' : 'text-slate-200'}`}>
            —
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {hm(m.t)} 开球
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="min-w-0 text-right">
            <p className="truncate font-headline text-sm font-semibold text-slate-100">{teamName(m.a)}</p>
            <p className="font-mono text-[10px] text-slate-500">客场</p>
          </div>
          <Crest id={m.a} size={36} />
        </div>
      </div>

      {/* 看点（三层供给，任意场次非空） */}
      <div className="mt-3 space-y-1 border-t border-border-subtle pt-2.5">
        <div className="flex items-center gap-2">
          <Pill tone={narrative.level === 'L1' ? 'gold' : 'slate'}>{narrative.level} 看点</Pill>
          <span className="font-mono text-[10px] text-slate-500">
            {leagueName(m.l)} · 第 {m.r} 轮
          </span>
        </div>
        <p className="text-[12px] leading-snug text-slate-300">{narrative.headline}</p>
        {narrative.lines.slice(0, 2).map((line, i) => (
          <p key={i} className="text-[11px] leading-snug text-slate-500">
            · {line}
          </p>
        ))}
        {narrative.trivia && (
          <p className="pt-0.5 text-[11px] italic leading-snug text-accent-purple/90">
            冷知识：{narrative.trivia}
          </p>
        )}
      </div>

      {/* 底部：档位 + CTA */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <SleepBadge match={m} />
          <span className="font-mono text-[10px] text-slate-500">{datePart(m.t)} {weekdayOf(datePart(m.t))}</span>
        </div>
        <button
          type="button"
          onClick={() => onWatch(m.id)}
          className={`rounded-md px-3.5 py-1.5 font-mono text-[11px] font-semibold tracking-wide transition-colors ${
            isHighlight
              ? 'bg-primary-gold text-black hover:bg-[#FFC426]'
              : 'border border-border-strong bg-surface-elevated text-slate-200 hover:bg-surface-hover'
          }`}
        >
          {copy.cta}
        </button>
      </div>
    </article>
  );
}

/** 无球日 / 全部 tbd 降级卡：下一场焦点战倒计时 */
export function NoMatchCard({ focal, countdown, onSelect }) {
  if (!focal) {
    return (
      <article className="rounded-xl border border-dashed border-border-strong bg-surface-card/50 p-4 text-center">
        <p className="font-headline text-sm font-semibold text-slate-300">近期没有可安排的比赛</p>
        <p className="mt-1 text-[11px] text-slate-500">赛程数据可能尚未同步，可在设置中手动同步</p>
      </article>
    );
  }

  const m = focal.m;
  return (
    <article className="rounded-xl border border-border-subtle bg-gradient-to-b from-[#141A26] to-surface-card p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <Pill tone="purple">今夜无球 · 下一场焦点战</Pill>
        <Stars star={focal.ev.star} />
      </div>

      <div className="flex items-center justify-center gap-3">
        <Crest id={m.h} size={32} />
        <span className="font-headline text-sm font-semibold text-slate-100">{teamName(m.h)}</span>
        <span className="font-mono text-[11px] text-slate-500">vs</span>
        <span className="font-headline text-sm font-semibold text-slate-100">{teamName(m.a)}</span>
        <Crest id={m.a} size={32} />
      </div>

      <div className="mt-3 flex flex-col items-center">
        <span className="font-mono text-[10px] tracking-wider text-slate-500">距开球</span>
        <span className="font-mono text-[26px] font-bold tabular-nums text-primary-gold">
          {countdown}
        </span>
        <span className="mt-0.5 font-mono text-[10px] text-slate-500">
          {zhDate(datePart(m.t))} {hm(m.t)} · {leagueName(m.l)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSelect(m.id)}
        className="mt-3 w-full rounded-md border border-border-strong bg-surface-elevated py-1.5 font-mono text-[11px] text-slate-200 transition-colors hover:bg-surface-hover"
      >
        查看这场
      </button>
    </article>
  );
}
