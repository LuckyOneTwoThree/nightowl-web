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
      className={`no-drag rounded-xl p-4 transition-all duration-200 shadow-card ${
        isHighlight
          ? 'bg-gradient-to-b from-amber-500/[0.08] via-surface-card to-surface-card'
          : isWeak
            ? 'bg-surface-card/60 shadow-xs'
            : 'bg-surface-card'
      }`}
    >
      {/* 头部：徽章 + 指数 + 直播态 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Pill tone={copy.tone}>{copy.badge}</Pill>
          <Stars star={ev.star} />
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <Pill tone="red">
              <LiveDot />
              LIVE {minute}′
            </Pill>
          )}
          {!isWeak && (
            <span
              className={`font-mono text-[13px] font-bold tabular-nums ${
                isHighlight ? 'text-primary-gold' : 'text-text-muted'
              }`}
              title="夜猫指数 = 看点权重 ÷（1 + 睡眠成本 + 观看占用）"
            >
              指数 {hero.index.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* 对阵区：采用垂直对称网格，给主客队分配充分宽度，根除单字截断 */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-surface-elevated/50 px-3 py-3 transition-colors">
        {/* 主队 */}
        <div className="flex flex-col items-center text-center min-w-0">
          <Crest id={m.h} size={36} />
          <span
            className="mt-1.5 font-headline text-[13px] font-bold text-text-primary leading-tight line-clamp-1"
            title={teamName(m.h)}
          >
            {teamName(m.h)}
          </span>
          <span className="font-mono text-[10px] text-text-muted mt-0.5">主场</span>
        </div>

        {/* 中间开球 / 比分（D3/FR-T-10：直播中不显示实时比分，比分位为 —，仅显示进行分钟） */}
        <div className="flex flex-col items-center px-1 shrink-0">
          <span className={`font-mono text-[20px] font-extrabold tabular-nums ${live ? 'text-live-red' : 'text-text-primary'}`}>
            {live ? '—' : 'VS'}
          </span>
          <span className={`font-mono text-[11px] font-semibold mt-0.5 whitespace-nowrap ${live ? 'text-live-red' : 'text-primary-gold'}`}>
            {live ? `LIVE ${minute}′` : `${hm(m.t)} 开球`}
          </span>
        </div>

        {/* 客队 */}
        <div className="flex flex-col items-center text-center min-w-0">
          <Crest id={m.a} size={36} />
          <span
            className="mt-1.5 font-headline text-[13px] font-bold text-text-primary leading-tight line-clamp-1"
            title={teamName(m.a)}
          >
            {teamName(m.a)}
          </span>
          <span className="font-mono text-[10px] text-text-muted mt-0.5">客场</span>
        </div>
      </div>

      {/* 看点：采用微光底衬，移除多余线框 */}
      <div className="mt-3 space-y-1.5 rounded-xl bg-surface-elevated/35 p-3 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Pill tone={narrative.level === 'L1' ? 'gold' : 'slate'}>{narrative.level} 看点</Pill>
            <span className="font-mono text-[10px] text-text-muted">
              {leagueName(m.l)} · 第 {m.r} 轮
            </span>
          </div>
        </div>
        <p className="text-[12px] font-semibold leading-snug text-text-primary">{narrative.headline}</p>
        {narrative.lines.slice(0, 2).map((line, i) => (
          <p key={i} className="text-[11px] leading-snug text-text-secondary">
            · {line}
          </p>
        ))}
        {narrative.trivia && (
          <p className="mt-1.5 rounded-lg bg-purple-500/10 px-2.5 py-1 text-[11px] italic leading-snug text-purple-700 dark:text-purple-300">
            💡 冷知识：{narrative.trivia}
          </p>
        )}
      </div>

      {/* 底部：档位 + CTA */}
      <div className="mt-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <SleepBadge match={m} />
          <span className="font-mono text-[10px] text-text-muted">{datePart(m.t)} {weekdayOf(datePart(m.t))}</span>
        </div>
        <button
          type="button"
          onClick={() => onWatch(m.id)}
          className={`rounded-md px-4 py-1.5 font-mono text-[11px] font-bold tracking-wide transition-all shadow-xs active:scale-95 ${
            isHighlight
              ? 'bg-primary-gold text-black hover:opacity-90 shadow-md shadow-primary-gold/20'
              : 'bg-surface-elevated text-text-primary hover:bg-surface-hover hover:text-primary-gold'
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
      <article className="rounded-xl bg-surface-card/60 p-5 text-center shadow-card">
        <p className="font-headline text-sm font-semibold text-text-primary">近期没有可安排的比赛</p>
        <p className="mt-1 text-[11px] text-text-muted">赛程数据可能尚未同步，可在设置中手动同步</p>
      </article>
    );
  }

  const m = focal.m;
  return (
    <article className="rounded-xl bg-gradient-to-b from-purple-500/[0.08] via-surface-card to-surface-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <Pill tone="purple">今夜无球 · 下一场焦点战</Pill>
        <Stars star={focal.ev.star} />
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-surface-elevated/40 p-2.5">
        <div className="flex flex-col items-center text-center min-w-0">
          <Crest id={m.h} size={30} />
          <span className="mt-1 font-headline text-[12px] font-bold text-text-primary truncate w-full">{teamName(m.h)}</span>
        </div>
        <span className="font-mono text-[12px] font-bold text-text-dim px-1">VS</span>
        <div className="flex flex-col items-center text-center min-w-0">
          <Crest id={m.a} size={30} />
          <span className="mt-1 font-headline text-[12px] font-bold text-text-primary truncate w-full">{teamName(m.a)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center rounded-xl bg-surface-elevated/40 p-3">
        <span className="font-mono text-[10px] tracking-wider text-text-muted uppercase">距开球</span>
        <span className="font-mono text-[28px] font-extrabold tabular-nums text-primary-gold drop-shadow-xs">
          {countdown}
        </span>
        <span className="mt-0.5 font-mono text-[10px] text-text-muted">
          {zhDate(datePart(m.t))} {hm(m.t)} · {leagueName(m.l)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSelect(m.id)}
        className="mt-3 w-full rounded-md bg-surface-elevated py-2 font-mono text-[11px] font-semibold text-text-primary transition-all hover:bg-surface-hover hover:text-primary-gold shadow-xs active:scale-98"
      >
        查看这场赛前情报
      </button>
    </article>
  );
}
