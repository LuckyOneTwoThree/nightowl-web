import { useMemo, useState } from 'react';
import { hm, zhDate, weekdayOf, datePart } from '../core/format.js';
import { storylines, teamName, leagueName, TEAM_MAP } from '../data/index.js';
import { sleepTier, storyBonus, followedBonus, leagueBonus, PRODUCT_WEIGHTS, WATCH_COST } from '../core/engine.js';
import {
  narrativeOf,
  tierAdviceOf,
  seasonIdentityOf,
  storylinesOf,
  TIER_STYLE
} from '../core/narrative.js';
import { evalOne } from '../core/owl.js';
import { computeMatchStats } from '../core/stats.js';
import { Crest, Pill, Stars } from './atoms.jsx';

/**
 * 右栏情报板（真实数据赛前决策看板）
 *
 * ⚠️ 铁律：**不得出现任何无数据源的字段**（判据见《数据可达性对账表》）
 *    禁止：xG / 控球率 / 传球精度 / 阵型 / 首发 / 节律 / 对抗强度 / 码率 / 线路延迟
 *    本面板只用真实资产：睡眠档位 · 德比与故事线 · 赛季身份 · 真实已赛战绩与交手数据
 */
export default function IntelPanel({ match, prefs }) {
  const [activeTab, setActiveTab] = useState('intel'); // 'intel' | 'stats'

  const evalResult = useMemo(() => (match ? evalOne(match, prefs) : null), [match, prefs]);
  const ev = evalResult?.ev || null;
  const index = evalResult?.index || 0;
  const tier = useMemo(() => (match ? sleepTier(match.t) : null), [match?.t]);
  const narrative = useMemo(() => (match && ev ? narrativeOf(match, ev, storylines) : null), [match, ev]);
  const stories = useMemo(() => (match ? storylinesOf(match, storylines) : []), [match]);
  const identity = useMemo(() => (match ? seasonIdentityOf(match) : null), [match]);
  const stats = useMemo(() => (match ? computeMatchStats(match) : null), [match]);

  if (!match || !ev || !tier || !narrative || !identity) {
    return (
      <section className="flex min-h-[220px] flex-1 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-card/40 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-[28px] opacity-40">🦉</span>
          <p className="font-mono text-[11px] text-text-muted">从左侧选择一场比赛，实时拆解睡眠与看点情报</p>
        </div>
      </section>
    );
  }

  // 算法归因拆解：与 evalOne 同口径（PRODUCT_WEIGHTS），数值取自引擎真实加成函数
  const storyB = storyBonus(ev, PRODUCT_WEIGHTS);
  const followedB = followedBonus(ev, PRODUCT_WEIGHTS);
  const leagueB = leagueBonus(ev, PRODUCT_WEIGHTS);

  return (
    <section className="flex flex-col gap-2.5">
      {/* 头部：对阵队徽 + 联赛轮次 + 夜猫指数核心 Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-surface-card p-3 shadow-card transition-colors">
        {/* 左侧：队徽对阵 + 联赛轮次 + 星级 */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-elevated/60 px-2.5 py-1 shadow-2xs">
            <Crest id={match.h} size={18} />
            <span className="font-headline text-[13px] font-bold text-text-primary">{teamName(match.h)}</span>
            <span className="text-[11px] font-medium text-text-muted">vs</span>
            <Crest id={match.a} size={18} />
            <span className="font-headline text-[13px] font-bold text-text-primary">{teamName(match.a)}</span>
          </div>
          <Stars star={ev.star} />
          <Pill tone="slate">
            {leagueName(match.l)} 第 {match.r} 轮
          </Pill>
          {ev.isFollowed && <Pill tone="gold">主队出战</Pill>}
        </div>

        {/* 右侧：夜猫指数核心胶囊 + 时间 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-primary-gold/15 px-2.5 py-1 shadow-2xs">
            <span className="text-[13px]">🦉</span>
            <div className="flex flex-col items-start leading-none">
              <span className="font-mono text-[9px] font-bold tracking-wider uppercase text-primary-gold">夜猫指数</span>
              <span className="font-mono text-[16px] font-extrabold tabular-nums text-primary-gold leading-tight">
                {index.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="text-right font-mono text-[10px] text-text-muted leading-tight">
            <div>
              {zhDate(datePart(match.t))} {weekdayOf(datePart(match.t))}
            </div>
            <div className="font-semibold text-text-secondary">{hm(match.t)} 北京时间</div>
          </div>
        </div>
      </div>

      {/* 选项卡切换：熬夜决策与看点 / 双方真实数据对决 */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('intel')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-headline text-[12px] font-bold transition-all ${
              activeTab === 'intel'
                ? 'bg-primary-gold/20 text-primary-gold shadow-xs'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            <span>🌙</span>
            <span>熬夜看点与决策</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stats')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-headline text-[12px] font-bold transition-all ${
              activeTab === 'stats'
                ? 'bg-primary-gold/20 text-primary-gold shadow-xs'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            <span>📊</span>
            <span>双方真实数据对决</span>
            {stats && (stats.home.form.length > 0 || stats.away.form.length > 0) && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400">
                真实赛果
              </span>
            )}
          </button>
        </div>
        <span className="hidden sm:inline font-mono text-[10px] text-text-dim">
          {activeTab === 'intel' ? '睡眠成本 · 德比节点 · 算法归因' : '近5场胜平负 · 攻防数据 · 历史交锋'}
        </span>
      </div>

      {activeTab === 'intel' ? (
        /* 三列看板：熬夜看点与决策 */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {/* 列 1：睡眠损耗量化与建议 */}
          <IntelCard
            icon="🌙"
            title="睡眠成本量化"
            badge={<span className="font-mono text-[10px] text-text-muted">损耗 {tier.cost}h</span>}
          >
            {/* 档位状态与等级 */}
            <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-elevated/50 p-2.5">
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 font-mono text-[14px] font-bold ${TIER_STYLE[tier.label] || ''}`}>
                  {tier.label}
                </span>
                <span className="font-headline text-[12px] font-bold text-text-primary">{tier.zh}</span>
              </div>
              <span className="font-mono text-[11px] font-semibold text-text-secondary">成本 {tier.cost} 小时</span>
            </div>

            {/* 五档可视化阶梯指示条 (S0 ~ S4) */}
            <div className="mt-2.5 space-y-1">
              <div className="flex items-center justify-between text-[9px] font-mono text-text-muted">
                <span>S0 零负担</span>
                <span>S2 黄金修仙</span>
                <span>S4 黎明极限</span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {['S0', 'S1', 'S2', 'S3', 'S4'].map(t => {
                  const active = tier.label === t;
                  return (
                    <div
                      key={t}
                      title={`${t} 档`}
                      className={`h-1.5 rounded-full transition-all ${
                        active
                          ? t === 'S0'
                            ? 'bg-emerald-500 shadow-xs'
                            : t === 'S1'
                            ? 'bg-teal-400 shadow-xs'
                            : t === 'S2'
                            ? 'bg-amber-400 shadow-xs'
                            : t === 'S3'
                            ? 'bg-orange-500 shadow-xs'
                            : 'bg-purple-500 shadow-xs'
                          : 'bg-border-subtle'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* 智能睡眠决策建议 */}
            <div className="mt-2.5 rounded-lg bg-surface-elevated/40 p-2.5 text-[11px] leading-relaxed text-text-secondary">
              <p className="mb-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-text-dim">决策建议</p>
              {tierAdviceOf(match)}
            </div>

            {match.tbd && (
              <div className="mt-2 rounded-lg border border-dashed border-warning-amber/40 bg-warning-amber/10 px-2 py-1 text-[10px] text-warning-amber">
                ⚠️ 开球时间待定，档位仅供参考
              </div>
            )}
          </IntelCard>

          {/* 列 2：德比与看点故事线 */}
          <IntelCard
            icon="⚔️"
            title="看点与德比故事"
            badge={<Pill tone={narrative.level === 'L1' ? 'gold' : 'slate'}>{narrative.level} 评级</Pill>}
          >
            {/* 德比焦点提示 */}
            {ev.rivalry ? (
              <div className="flex items-center gap-2 rounded-lg bg-purple-500/15 px-2.5 py-1.5">
                <span className="text-[13px]">⚔️</span>
                <div>
                  <p className="font-headline text-[12px] font-bold text-purple-600 dark:text-purple-300">
                    {ev.rivalry}
                  </p>
                  <p className="font-mono text-[9px] text-purple-700/80 dark:text-purple-400/80">焦点宿敌德比对决</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <span>⚽</span>
                <span>常规联赛对决</span>
              </div>
            )}

            {/* 核心看点 Headline */}
            <div className="mt-2">
              <p className="text-[12px] font-semibold leading-snug text-text-primary">
                {narrative.headline}
              </p>
              {narrative.lines.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {narrative.lines.map((line, i) => (
                    <li key={i} className="flex items-start gap-1 text-[10px] leading-snug text-text-secondary">
                      <span className="shrink-0 text-primary-gold font-bold">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 故事线节点 */}
            {stories.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-white/[0.04] pt-2">
                <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-text-dim">关联故事线</p>
                {stories.map(s => (
                  <div key={s.id} className="rounded-md bg-surface-elevated/40 p-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-semibold text-text-primary">{s.name}</span>
                      {ev.keyNode && (
                        <span className="font-mono text-[9px] font-bold text-purple-600 dark:text-purple-400">
                          关键战
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-text-muted">{s.desc}</p>
                  </div>
                ))}
              </div>
            )}

            {/* 冷知识 */}
            {narrative.trivia && (
              <div className="mt-2 rounded-lg bg-purple-500/10 px-2.5 py-1.5 text-[10px] italic text-purple-600 dark:text-purple-300 leading-snug">
                💡 冷知识：{narrative.trivia}
              </div>
            )}
          </IntelCard>

          {/* 列 3：赛季身份与算法归因 */}
          <IntelCard
            icon="🏷️"
            title="赛季身份与归因"
            badge={<span className="font-mono text-[10px] text-text-muted">真实数据</span>}
          >
            {/* 双方球队标签与身份 */}
            <div className="space-y-1.5">
              {[
                { id: match.h, side: '主队' },
                { id: match.a, side: '客队' }
              ].map(({ id, side }) => {
                const team = TEAM_MAP[id];
                const tag = team?.tag;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between rounded-lg bg-surface-elevated/50 px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Crest id={id} size={16} />
                      <span className="truncate text-[11px] font-semibold text-text-primary">{teamName(id)}</span>
                      <span className="font-mono text-[9px] text-text-muted">({side})</span>
                    </div>
                    {tag ? (
                      <Pill tone={tag === '卫冕冠军' ? 'gold' : 'teal'}>{tag}</Pill>
                    ) : (
                      <span className="font-mono text-[9px] text-text-dim">常规签位</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 身份描述文本 */}
            <div className="mt-2 space-y-0.5">
              {identity.lines.map((line, i) => (
                <p key={i} className="text-[10px] leading-snug text-text-secondary">
                  · {line}
                </p>
              ))}
              {identity.fallback && (
                <p className="text-[10px] text-text-muted italic">
                  双方暂无特殊身份标签，按常规联赛积分节奏出战
                </p>
              )}
            </div>

            {/* 算法决策依据拆解：分子（星级/故事线/主队/联赛）→ 分母（睡眠/观看占用）→ 指数，数值全部来自引擎真实加成 */}
            <div className="mt-2.5 rounded-lg bg-surface-elevated/40 p-2">
              <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-wider text-text-dim">
                夜猫推荐算法拆解
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px]">
                <div className="flex justify-between border-b border-white/[0.04] pb-0.5">
                  <span className="text-text-muted">看点星级</span>
                  <span className="font-bold text-text-primary">{ev.star} ★</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.04] pb-0.5">
                  <span className="text-text-muted">故事线加成</span>
                  <span className={`font-bold ${storyB > 0 ? 'text-purple-600 dark:text-purple-300' : 'text-text-muted'}`}>
                    {storyB > 0 ? `+${storyB.toFixed(1)}` : '0.0'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/[0.04] pb-0.5">
                  <span className="text-text-muted">主队加成</span>
                  <span className={`font-bold ${followedB > 0 ? 'text-primary-gold' : 'text-text-muted'}`}>
                    {followedB > 0 ? `+${followedB.toFixed(1)}` : '0.0'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/[0.04] pb-0.5">
                  <span className="text-text-muted">联赛加成</span>
                  <span className={`font-bold ${leagueB > 0 ? 'text-primary-gold' : 'text-text-muted'}`}>
                    {leagueB > 0 ? `+${leagueB.toFixed(1)}` : '0.0'}
                  </span>
                </div>
                <div className="flex justify-between pt-0.5">
                  <span className="text-text-muted">睡眠成本</span>
                  <span className="font-bold text-text-primary">{tier.cost}h</span>
                </div>
                <div className="flex justify-between pt-0.5">
                  <span className="text-text-muted">观看占用</span>
                  <span className="font-bold text-text-primary">{WATCH_COST}h</span>
                </div>
                <div className="col-span-2 mt-0.5 flex justify-between border-t border-white/[0.04] pt-1">
                  <span className="text-text-muted">综合指数</span>
                  <span className="font-bold text-primary-gold">{index.toFixed(1)}</span>
                </div>
              </div>
              <p className="mt-1.5 font-mono text-[8.5px] leading-tight text-text-dim">
                公式：（星级×10 + 故事线 + 主队 + 联赛加成）÷（1 + 睡眠成本 + 观看占用）
              </p>
            </div>
          </IntelCard>
        </div>
      ) : (
        /* 三列看板：双方真实数据对决 */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {/* 列 1：双方近 5 场走势（胜平负） */}
          <IntelCard
            icon="📈"
            title="双方近 5 场走势"
            badge={<span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">已赛记录</span>}
          >
            <div className="space-y-3">
              {/* 主队走势 */}
              <TeamFormSection
                teamId={match.h}
                label="主队"
                form={stats?.home?.form || []}
              />

              {/* 客队走势 */}
              <div className="border-t border-white/[0.04] pt-2.5">
                <TeamFormSection
                  teamId={match.a}
                  label="客队"
                  form={stats?.away?.form || []}
                />
              </div>
            </div>
          </IntelCard>

          {/* 列 2：赛季攻防与战力比拼 */}
          <IntelCard
            icon="⚖️"
            title="赛季攻防对比"
            badge={<span className="font-mono text-[10px] text-text-muted">{leagueName(match.l)}</span>}
          >
            <div className="space-y-2.5">
              {/* 对比指标条 */}
              <div className="flex items-center justify-between font-mono text-[11px] font-bold border-b border-white/[0.04] pb-1 text-text-muted">
                <span className="flex items-center gap-1">
                  <Crest id={match.h} size={14} />
                  <span>{teamName(match.h)}</span>
                </span>
                <span className="text-[10px] font-normal text-text-dim">指标对比</span>
                <span className="flex items-center gap-1">
                  <span>{teamName(match.a)}</span>
                  <Crest id={match.a} size={14} />
                </span>
              </div>

              <StatCompareRow
                label="胜率"
                val1={`${stats?.home?.season?.winRate || 0}%`}
                val2={`${stats?.away?.season?.winRate || 0}%`}
                num1={stats?.home?.season?.winRate || 0}
                num2={stats?.away?.season?.winRate || 0}
              />

              <StatCompareRow
                label="场均进球"
                val1={stats?.home?.season?.avgGoalsFor || '0.0'}
                val2={stats?.away?.season?.avgGoalsFor || '0.0'}
                num1={parseFloat(stats?.home?.season?.avgGoalsFor || 0)}
                num2={parseFloat(stats?.away?.season?.avgGoalsFor || 0)}
              />

              <StatCompareRow
                label="场均失球"
                val1={stats?.home?.season?.avgGoalsAgainst || '0.0'}
                val2={stats?.away?.season?.avgGoalsAgainst || '0.0'}
                num1={parseFloat(stats?.home?.season?.avgGoalsAgainst || 0)}
                num2={parseFloat(stats?.away?.season?.avgGoalsAgainst || 0)}
                reverse
              />

              <StatCompareRow
                label="零封场次"
                val1={`${stats?.home?.season?.cleanSheets || 0}场`}
                val2={`${stats?.away?.season?.cleanSheets || 0}场`}
                num1={stats?.home?.season?.cleanSheets || 0}
                num2={stats?.away?.season?.cleanSheets || 0}
              />

              <StatCompareRow
                label="净胜球"
                val1={`${stats?.home?.season?.goalDiff > 0 ? '+' : ''}${stats?.home?.season?.goalDiff || 0}`}
                val2={`${stats?.away?.season?.goalDiff > 0 ? '+' : ''}${stats?.away?.season?.goalDiff || 0}`}
                num1={stats?.home?.season?.goalDiff || 0}
                num2={stats?.away?.season?.goalDiff || 0}
              />

              {/* 主客场战绩 */}
              <div className="mt-2 rounded-lg bg-surface-elevated/40 p-2 font-mono text-[10px] space-y-1">
                <div className="flex justify-between text-text-secondary">
                  <span>{teamName(match.h)}主场</span>
                  <span className="font-bold">
                    {stats?.home?.season?.home?.wins || 0}胜 {stats?.home?.season?.home?.draws || 0}平 {stats?.home?.season?.home?.losses || 0}负
                  </span>
                </div>
                <div className="flex justify-between text-text-secondary">
                  <span>{teamName(match.a)}客场</span>
                  <span className="font-bold">
                    {stats?.away?.season?.away?.wins || 0}胜 {stats?.away?.season?.away?.draws || 0}平 {stats?.away?.season?.away?.losses || 0}负
                  </span>
                </div>
              </div>
            </div>
          </IntelCard>

          {/* 列 3：历史直接交战记录 */}
          <IntelCard
            icon="⚔️"
            title="历史直接交锋"
            badge={
              <span className="font-mono text-[10px] text-text-muted">
                共 {stats?.h2h?.summary?.total || 0} 战
              </span>
            }
          >
            {stats?.h2h?.meetings?.length > 0 ? (
              <div className="space-y-2">
                {/* 战绩汇总 */}
                <div className="flex items-center justify-between rounded-lg bg-surface-elevated/50 p-2 font-mono text-[10px]">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    {teamName(match.h)} {stats.h2h.summary.t1Wins} 胜
                  </span>
                  <span className="text-amber-500 font-bold">
                    {stats.h2h.summary.draws} 平
                  </span>
                  <span className="text-rose-500 font-bold">
                    {teamName(match.a)} {stats.h2h.summary.t2Wins} 胜
                  </span>
                </div>

                {/* 场次清单 */}
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                  {stats.h2h.meetings.map(m => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-md bg-surface-elevated/40 px-2 py-1.5 font-mono text-[10px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-dim">{datePart(m.date).slice(5)}</span>
                        <span className="font-semibold text-text-primary">
                          {teamName(m.home)} vs {teamName(m.away)}
                        </span>
                      </div>
                      <span className="font-bold text-primary-gold px-1 rounded bg-black/5 dark:bg-white/5">
                        {m.score}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[180px] flex-col items-center justify-center text-center p-4">
                <span className="text-[24px] opacity-40 mb-1.5">🤝</span>
                <p className="text-[11px] font-semibold text-text-secondary">两队本赛季尚未直接交锋</p>
                <p className="text-[10px] text-text-muted mt-0.5">本场对决将书写两队本阶段首次正面战果</p>
              </div>
            )}
          </IntelCard>
        </div>
      )}
    </section>
  );
}

/** 走势区域展示组件 */
function TeamFormSection({ teamId, label, form }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Crest id={teamId} size={16} />
          <span className="font-headline text-[12px] font-bold text-text-primary">{teamName(teamId)}</span>
          <span className="font-mono text-[9px] text-text-dim">({label})</span>
        </div>
        {/* 彩色结果胶囊 */}
        <div className="flex items-center gap-1">
          {form.length > 0 ? (
            form.map((f, i) => (
              <span
                key={i}
                title={`${f.date.slice(0, 10)} vs ${teamName(f.opponent)} (${f.score})`}
                className={`flex h-4 w-4 items-center justify-center rounded-sm font-mono text-[9px] font-black ${
                  f.result === 'W'
                    ? 'bg-emerald-500 text-white'
                    : f.result === 'D'
                    ? 'bg-amber-400 text-black'
                    : 'bg-rose-500 text-white'
                }`}
              >
                {f.result === 'W' ? '胜' : f.result === 'D' ? '平' : '负'}
              </span>
            ))
          ) : (
            <span className="font-mono text-[9px] text-text-dim">暂无完赛记录</span>
          )}
        </div>
      </div>

      {/* 详细比赛微列表 */}
      {form.length > 0 && (
        <div className="space-y-1">
          {form.slice(0, 3).map(f => (
            <div
              key={f.matchId}
              className="flex items-center justify-between text-[10px] font-mono rounded bg-surface-elevated/30 px-2 py-0.5 text-text-muted"
            >
              <span className="truncate">
                {f.isHome ? '主场' : '客场'} vs {teamName(f.opponent)}
              </span>
              <span className="font-bold text-text-primary tabular-nums">{f.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 指标双向对比进度条组件 */
function StatCompareRow({ label, val1, val2, num1, num2, reverse = false }) {
  const total = (num1 || 0) + (num2 || 0);
  const ratio1 = total > 0 ? Math.round((num1 / total) * 100) : 50;
  const ratio2 = 100 - ratio1;

  const isHomeBetter = reverse ? num1 < num2 : num1 > num2;
  const isAwayBetter = reverse ? num2 < num1 : num2 > num1;

  return (
    <div className="space-y-1 font-mono text-[10px]">
      <div className="flex items-center justify-between">
        <span className={`font-bold ${isHomeBetter ? 'text-primary-gold' : 'text-text-secondary'}`}>
          {val1}
        </span>
        <span className="text-[9px] font-medium text-text-dim">{label}</span>
        <span className={`font-bold ${isAwayBetter ? 'text-primary-gold' : 'text-text-secondary'}`}>
          {val2}
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
        <div
          style={{ width: `${ratio1}%` }}
          className={`h-full transition-all ${isHomeBetter ? 'bg-primary-gold' : 'bg-slate-400/60'}`}
        />
        <div
          style={{ width: `${ratio2}%` }}
          className={`h-full transition-all ${isAwayBetter ? 'bg-primary-gold' : 'bg-slate-500/40'}`}
        />
      </div>
    </div>
  );
}

function IntelCard({ icon, title, badge, children }) {
  return (
    <div className="flex flex-col rounded-xl bg-surface-card p-3 shadow-card transition-colors">
      <div className="mb-2.5 flex items-center justify-between gap-1.5 border-b border-white/[0.04] pb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px]">{icon}</span>
          <h3 className="font-headline text-[12px] font-bold text-text-primary">{title}</h3>
        </div>
        {badge}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
