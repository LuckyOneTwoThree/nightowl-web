/**
 * 双方球队后续赛程时间轴（右栏）
 *
 * 为什么放右栏：用户的核心决策是「这场值不值得熬夜」——
 * 如果支持的球队几天后还有更好的比赛，这场就可以战略性放弃。
 * 把双方各自的后续赛程摆在一起，配合档位徽章，一眼可比。
 */

import { useMemo } from 'react';
import { upcomingForTeams } from '../core/owl.js';
import { hm, zhDate, weekdayOf } from '../core/format.js';
import { teamName } from '../data/index.js';
import { tierOf } from '../core/engine.js';
import { TIER_MAP } from '../core/narrative.js';
import { Crest, EmptyState, Meta } from './atoms.jsx';

// 档位文字色复用 narrative 的 tier 色阶（与 SleepBadge / WeekView 同一口径）
const TIER_TONE = Object.fromEntries(
  Object.entries(TIER_MAP).map(([label, t]) => [label, t.text])
);

function TeamColumn({ teamId, list, side }) {
  const name = teamName(teamId);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Crest id={teamId} size={16} />
        <span className="truncate text-2xs font-semibold text-text-primary">{name}</span>
        <span className="text-2xs text-text-faint">{side}</span>
      </div>
      {list.length === 0 ? (
        <p className="py-1 text-2xs text-text-faint">暂无已排期的后续比赛</p>
      ) : (
        <ul className="space-y-1">
          {list.map(m => {
            const opp = m.h === teamId ? `vs ${teamName(m.a)}` : `@ ${teamName(m.h)}`;
            const tier = tierOf(m);
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-md bg-surface-raised/50 px-2 py-1 transition-colors hover:bg-surface-raised"
              >
                <span className="min-w-0 flex-1 truncate text-2xs text-text-secondary">
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
      <section className="flex h-full flex-col justify-center overflow-hidden rounded-xl border border-line-hairline bg-surface-card p-4 shadow-card">
        <EmptyState
          icon={null}
          title="选中一场比赛，查看双方后续赛程"
          desc="之后的排期会影响「这场值不值得熬夜」的判断。"
        />
      </section>
    );
  }

  // 全量遍历，随 match 变化时才算一次（App 的 30 秒 tick 与 revealed 变化会触发重渲染）
  const { home, away } = useMemo(() => upcomingForTeams(match), [match]);

  return (
    <section className="flex h-full flex-col justify-between overflow-hidden rounded-xl border border-line-hairline bg-surface-card p-4 shadow-card transition-shadow hover:shadow-pop">
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-2xs font-semibold tracking-wide text-text-primary">双方后续赛程</h3>
          <Meta>各取最近 4 场 · 档位越高熬夜代价越大</Meta>
        </div>
        <div className="flex gap-4">
          <TeamColumn teamId={match.h} list={home} side="主队" />
          <div className="w-px shrink-0 bg-line-hairline" />
          <TeamColumn teamId={match.a} list={away} side="客队" />
        </div>
      </div>
    </section>
  );
}
