/**
 * 双方球队后续赛程时间轴（右栏）
 *
 * 为什么放右栏：用户的核心决策是「这场值不值得熬夜」——
 * 如果支持的球队几天后还有更好的比赛，这场就可以战略性放弃。
 * 把双方各自的后续赛程摆在一起，配合档位徽章，一眼可比。
 */

import { upcomingForTeams } from '../core/owl.js';
import { teamName, leagueName, crestUrl, LEAGUE_ORDER } from '../data/index.js';
import { hm, zhDate, weekdayOf } from '../core/format.js';
import { tierOf } from '../core/engine.js';
import { Crest } from './atoms.jsx';
import { EmptyState } from './atoms.jsx';

const TIER_TONE = {
  S0: 'text-emerald-400',
  S1: 'text-teal-400',
  S2: 'text-amber-400',
  S3: 'text-orange-400',
  S4: 'text-rose-400'
};

function TeamColumn({ teamId, list, side }) {
  const name = teamName(teamId);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Crest id={teamId} size={16} />
        <span className="truncate font-ui text-2xs font-semibold text-text-primary">{name}</span>
        <span className="font-ui text-2xs text-text-faint">{side}</span>
      </div>
      {list.length === 0 ? (
        <p className="py-1 font-ui text-2xs text-text-faint">暂无已排期的后续比赛</p>
      ) : (
        <ul className="space-y-1">
          {list.map(m => {
            const opp = m.h === teamId ? `vs ${teamName(m.a)}` : `@ ${teamName(m.h)}`;
            const tier = tierOf(m);
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 rounded bg-surface-card/60 px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate font-ui text-2xs text-text-secondary">
                  {/* weekdayOf / zhDate 只吃纯日期（YYYY-MM-DD），传带 T 的 t 会得到 NaN */}
                  {zhDate(m.t.slice(0, 10))} {weekdayOf(m.t.slice(0, 10)).slice(0, 1)} {hm(m.t)} {opp}
                </span>
                <span className={`font-num text-2xs font-semibold tabular-nums ${TIER_TONE[tier.label] || ''}`}>
                  {tier.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function UpcomingFixtures({ match, prefs }) {
  if (!match) {
    return (
      <section className="flex h-full flex-col justify-center rounded-xl border border-white/[0.08] bg-gradient-to-b from-[#14162a] via-[#0f111f] to-[#0a0c16] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <EmptyState
          icon={null}
          title="选中一场比赛，查看双方后续赛程"
          desc="之后的排期会影响「这场值不值得熬夜」的判断。"
        />
      </section>
    );
  }

  const { home, away } = upcomingForTeams(match);

  return (
    <section className="flex h-full flex-col justify-between rounded-xl border border-white/[0.08] bg-gradient-to-b from-[#14162a] via-[#0f111f] to-[#0a0c16] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="font-ui text-2xs font-semibold tracking-wide text-text-primary">
            双方后续赛程
          </h3>
          <span className="font-ui text-2xs text-text-muted">
            各取最近 4 场 · 档位越高熬夜代价越大
          </span>
        </div>
        <div className="flex gap-4">
          <TeamColumn teamId={match.h} list={home} side="主队" />
          <div className="w-px shrink-0 bg-white/[0.08]" />
          <TeamColumn teamId={match.a} list={away} side="客队" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 font-ui text-2xs text-text-faint">
        <span>对阵排期 · 关联评估</span>
        <span>主客各至多 4 轮</span>
      </div>
    </section>
  );
}
