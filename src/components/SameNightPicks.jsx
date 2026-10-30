/**
 * 同夜其他推荐（右栏模块区）
 *
 * 与「双方后续赛程」互补：一个回答「这场之后还有什么」，一个回答「今晚还有什么」。
 * 按夜猫指数排序，点一条即切换到那场 —— 用户不必回到左栏列表去找。
 */

import { useMemo } from 'react';
import { sameNightPicks } from '../core/owl.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { hm } from '../core/format.js';
import { TIER_MAP } from '../core/narrative.js';
import { Crest, EmptyState, Meta } from './atoms.jsx';

// 档位文字色复用 narrative 的 tier 色阶（与 SleepBadge / WeekView 同一口径）
const TIER_TONE = Object.fromEntries(
  Object.entries(TIER_MAP).map(([label, t]) => [label, t.text])
);

export default function SameNightPicks({ match, prefs, now = Date.now(), onSelect, compact = false, embedded = false }) {
  // ⚠️ hooks 必须在 early-return 之前调用（同 UpcomingFixtures：match null→非 null
  // 的切换路径会让 hooks 数量变化，React 直接抛错整页白屏）。
  // 判空放钩子内：sameNightPicks 首行就读 m.t，不接 null。
  const picks = useMemo(() => (match ? sameNightPicks(match, prefs, 3, now) : []), [match, prefs, now]);

  if (!match) {
    if (compact || embedded) return null;
    return (
      <section className="flex h-full flex-col justify-center overflow-hidden rounded-xl border border-line-hairline bg-surface-card p-4 shadow-card">
        <EmptyState
          icon={null}
          title="选中一场比赛，查看同夜其他推荐"
          desc="同夜开球场次横向对比，发现更高性价比对决。"
        />
      </section>
    );
  }

  if (compact) {
    return (
      <div className="mt-2.5 shrink-0 border-t border-line-hairline pt-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-2xs font-semibold tracking-wide text-text-primary">同夜其他</h3>
          <Meta>{picks.length} 场</Meta>
        </div>
        {picks.length === 0 ? (
          <p className="py-1 text-2xs text-text-faint">今晚没有其他可推荐的场次</p>
        ) : (
          <ul className="space-y-1">
            {picks.map(({ m, index, tier }) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(m.id)}
                  className="flex w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-line-hairline hover:bg-surface-raised focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
                >
                  <span className="w-8 shrink-0 font-num text-2xs tabular-nums text-text-faint">{hm(m.t)}</span>
                  <span
                    className="h-2.5 w-0.5 shrink-0 rounded"
                    style={{ background: leagueColor(m.l) }}
                    title={leagueName(m.l)}
                  />
                  <span className="min-w-0 flex-1 truncate text-2xs text-text-primary">
                    {teamName(m.h)} vs {teamName(m.a)}
                  </span>
                  <span className="shrink-0 font-num text-2xs font-semibold tabular-nums text-text-primary">
                    {index.toFixed(1)}
                  </span>
                  <span className={`shrink-0 font-num text-2xs font-semibold ${TIER_TONE[tier.label] || ''}`}>
                    {tier.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const content = (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-text-primary">同夜其他推荐</h3>
        <Meta>按夜猫指数排序 · 点击切换</Meta>
      </div>

      {picks.length === 0 ? (
        <div className="flex h-[96px] items-center justify-center rounded-lg border border-dashed border-line-hairline bg-surface-raised/25 px-3 text-center">
          <p className="text-2xs text-text-faint">
            今晚没有其他可推荐的场次（都已结束或只剩当前这场）
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {picks.map(({ m, index, tier }) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect?.(m.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-transparent bg-surface-raised/50 px-2.5 py-1.5 text-left transition-all hover:border-line-hairline hover:bg-surface-raised focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
              >
                <span className="font-num text-2xs tabular-nums text-text-faint">{hm(m.t)}</span>
                <span
                  className="h-3 w-0.5 shrink-0 rounded"
                  style={{ background: leagueColor(m.l) }}
                  title={leagueName(m.l)}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Crest id={m.h} size={14} />
                  <span className="truncate text-2xs text-text-primary">
                    {teamName(m.h)} vs {teamName(m.a)}
                  </span>
                  <Crest id={m.a} size={14} />
                </span>
                {/* 指数用中性主文字色：accent 只留给 Hero 与情报面板头的核心指数，
                    一个次级推荐模块每行 3 个金色数字会稀释强调 */}
                <span className="font-num text-2xs font-semibold tabular-nums text-text-primary">
                  指数 {index.toFixed(1)}
                </span>
                <span className={`font-num text-2xs font-semibold ${TIER_TONE[tier.label] || ''}`}>
                  {tier.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <section className="flex h-full flex-col justify-between overflow-hidden rounded-xl border border-line-hairline bg-surface-card p-4 shadow-card transition-shadow hover:shadow-pop">
      {content}
    </section>
  );
}
