/**
 * 同夜其他推荐（右栏模块区）
 *
 * 与「双方后续赛程」互补：一个回答「这场之后还有什么」，一个回答「今晚还有什么」。
 * 按夜猫指数排序，点一条即切换到那场 —— 用户不必回到左栏列表去找。
 */

import { sameNightPicks } from '../core/owl.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { hm } from '../core/format.js';
import { Crest } from './atoms.jsx';

const TIER_TONE = {
  S0: 'text-emerald-400',
  S1: 'text-teal-400',
  S2: 'text-amber-400',
  S3: 'text-orange-400',
  S4: 'text-rose-400'
};

export default function SameNightPicks({ match, prefs, onSelect }) {
  if (!match) return null;

  const picks = sameNightPicks(match, prefs, 3);

  return (
    <section className="rounded-lg border border-line-hairline bg-surface-panel p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-ui text-2xs font-semibold tracking-wide text-text-secondary">
          同夜其他推荐
        </h3>
        <span className="font-ui text-2xs text-text-faint">按夜猫指数排序 · 点击切换</span>
      </div>

      {picks.length === 0 ? (
        <p className="py-1 font-ui text-2xs text-text-faint">
          今晚没有其他可推荐的场次（都已结束或只剩当前这场）
        </p>
      ) : (
        <ul className="space-y-1">
          {picks.map(({ m, index, tier }) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect?.(m.id)}
                className="flex w-full items-center gap-2 rounded bg-surface-card/60 px-2 py-1.5 text-left transition-colors hover:bg-surface-raised"
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
    </section>
  );
}
