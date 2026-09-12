import { useMemo } from 'react';
import { hm, zhDate, weekdayOf, datePart } from '../core/format.js';
import { storylines, teamName, leagueName } from '../data/index.js';
import { sleepTier } from '../core/engine.js';
import {
  narrativeOf,
  tierAdviceOf,
  seasonIdentityOf,
  storylinesOf,
  TIER_STYLE
} from '../core/narrative.js';
import { evalOne } from '../core/owl.js';
import { Pill, Stars } from './atoms.jsx';

/**
 * 右栏情报板（三列）
 *
 * ⚠️ 铁律：**不得出现任何无数据源的字段**（判据见《数据可达性对账表》）
 *    禁止：xG / 控球率 / 传球精度 / 阵型 / 首发 / 节律 / 对抗强度 / 码率 / 线路延迟
 *    本面板只用三类真实资产：睡眠档位 · 德比与故事线 · 赛季身份
 */
export default function IntelPanel({ match, prefs }) {
  if (!match) {
    return (
      <section className="flex min-h-[190px] flex-1 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-card/40">
        <p className="text-[11px] text-slate-500">从左侧选择一场比赛，查看情报</p>
      </section>
    );
  }

  const { ev, index } = useMemo(() => evalOne(match, prefs), [match, prefs]);
  const tier = sleepTier(match.t);
  const narrative = useMemo(() => narrativeOf(match, ev, storylines), [match, ev]);
  const stories = storylinesOf(match, storylines);
  const identity = seasonIdentityOf(match);

  return (
    <section className="flex min-h-[190px] flex-1 flex-col gap-2 overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-headline text-[13px] font-semibold text-slate-100">
            {teamName(match.h)} vs {teamName(match.a)}
          </span>
          <Stars star={ev.star} />
          {ev.isFollowed && <Pill tone="gold">主队出战</Pill>}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-slate-500">
          {leagueName(match.l)} 第 {match.r} 轮 · {zhDate(datePart(match.t))} {weekdayOf(datePart(match.t))}{' '}
          {hm(match.t)}
        </span>
      </div>

      {/* 三列 */}
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2.5">
        {/* 列 A：睡眠成本 */}
        <ColumnCard title="🌙 睡眠成本">
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-[20px] font-bold ${TIER_STYLE[tier.label]?.split(' ')[0] || ''}`}>
              {tier.label}
            </span>
            <span className="font-mono text-[11px] text-slate-400">{tier.zh}</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500">睡眠成本 {tier.cost}h</p>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">{tierAdviceOf(match)}</p>
          {match.tbd && (
            <p className="mt-1.5 rounded border border-dashed border-border-strong px-1.5 py-1 text-[10px] text-slate-500">
              开球时间待定，档位仅供参考
            </p>
          )}
        </ColumnCard>

        {/* 列 B：德比与故事线 */}
        <ColumnCard title="⚔️ 德比与故事线">
          {ev.rivalry ? (
            <p className="font-mono text-[12px] font-semibold text-accent-purple">{ev.rivalry}</p>
          ) : (
            <p className="text-[11px] text-slate-500">非焦点对阵</p>
          )}

          {stories.length === 0 ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              本场不在任何故事线节点上
            </p>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              {stories.map(s => (
                <div key={s.id}>
                  <p className="text-[10px] font-semibold text-slate-300">{s.name}</p>
                  <p className="text-[10px] leading-snug text-slate-500">{s.desc}</p>
                </div>
              ))}
            </div>
          )}

          {ev.keyNode && (
            <p className="mt-1.5">
              <Pill tone="purple">故事线关键节点</Pill>
            </p>
          )}
        </ColumnCard>

        {/* 列 C：赛季身份（D5 —— 原「战术风格」语义错误已更正） */}
        <ColumnCard title="🏷️ 赛季身份">
          {identity.lines.map((line, i) => (
            <p key={i} className="text-[11px] leading-snug text-slate-300">
              {line}
            </p>
          ))}
          {identity.fallback && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              双方均无赛季身份标签
            </p>
          )}

          <div className="mt-2 border-t border-border-subtle pt-2">
            <p className="font-mono text-[9px] tracking-wider text-slate-600">夜猫指数</p>
            <p className="font-mono text-[15px] font-bold tabular-nums text-primary-gold">
              {index.toFixed(1)}
            </p>
            <p className="mt-0.5 text-[9px] leading-snug text-slate-600">
              看点权重 ÷（1 + 睡眠成本 + 观看占用）
            </p>
          </div>
        </ColumnCard>
      </div>

      {/* 看点（三层供给） */}
      <div className="rounded-lg border border-border-subtle bg-surface-card px-3 py-2">
        <div className="flex items-center gap-2">
          <Pill tone={narrative.level === 'L1' ? 'gold' : 'slate'}>{narrative.level} 看点</Pill>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-300">{narrative.headline}</p>
        {narrative.lines.map((line, i) => (
          <p key={i} className="mt-0.5 text-[10px] leading-snug text-slate-500">
            · {line}
          </p>
        ))}
        {narrative.trivia && (
          <p className="mt-1 text-[10px] italic leading-snug text-accent-purple/90">
            冷知识：{narrative.trivia}
          </p>
        )}
      </div>
    </section>
  );
}

function ColumnCard({ title, children }) {
  return (
    <div className="scrollbar-thin-dark min-h-0 overflow-y-auto rounded-lg border border-border-subtle bg-surface-card px-3 py-2.5">
      <p className="mb-2 font-mono text-[10px] font-semibold tracking-wider text-slate-500">{title}</p>
      {children}
    </div>
  );
}
