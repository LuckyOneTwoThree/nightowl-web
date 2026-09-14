/**
 * 同夜其他推荐（右栏模块区）
 *
 * 与「双方后续赛程」互补：一个回答「这场之后还有什么」，一个回答「今晚还有什么」。
 * 按夜猫指数排序，点一条即切换到那场 —— 用户不必回到左栏列表去找。
 */

import { sameNightPicks } from '../core/owl.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { hm } from '../core/format.js';
import { Crest, EmptyState } from './atoms.jsx';

const TIER_TONE = {
  S0: 'text-emerald-400',
  S1: 'text-teal-400',
  S2: 'text-amber-400',
  S3: 'text-orange-400',
  S4: 'text-rose-400'
};

export default function SameNightPicks({ match, prefs, onSelect }) {
  if (!match) {
    return (
      <section className="flex h-full flex-col justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-b from-[#14162a] via-[#0f111f] to-[#0a0c16] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <EmptyState
          icon={null}
          title="选中一场比赛，查看同夜其他推荐"
          desc="同夜开球场次横向对比，发现更高性价比对决。"
        />
      </section>
    );
  }

  const picks = sameNightPicks(match, prefs, 3);

  return (
    <section className="flex h-full flex-col justify-between overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-b from-[#14162a] via-[#0f111f] to-[#0a0c16] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="font-ui text-2xs font-semibold tracking-wide text-text-primary">
            同夜其他推荐
          </h3>
          <span className="font-ui text-2xs text-text-muted">按夜猫指数排序 · 点击切换</span>
        </div>

        {picks.length === 0 ? (
          <div className="flex h-[116px] items-center justify-center text-center">
            <p className="font-ui text-2xs text-text-faint">
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
                  className="flex w-full items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.04] px-2.5 py-1.5 text-left transition-all hover:border-white/[0.12] hover:bg-white/[0.08]"
                >
                  <span className="font-num text-2xs tabular-nums text-text-faint">{hm(m.t)}</span>
                  <span
                    className="h-3 w-0.5 shrink-0 rounded"
                    style={{ background: leagueColor(m.l) }}
                    title={leagueName(m.l)}
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Crest id={m.h} size={14} />
                    <span className="truncate font-ui text-2xs text-text-primary">
                      {teamName(m.h)} vs {teamName(m.a)}
                    </span>
                    <Crest id={m.a} size={14} />
                  </span>
                  <span className="font-num text-2xs font-semibold tabular-nums text-accent">
                    {index.toFixed(1)}
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

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 font-ui text-2xs text-text-faint">
        <span>同夜场次 · 动态联动</span>
        <span>{picks.length} 场候选</span>
      </div>
    </section>
  );
}
