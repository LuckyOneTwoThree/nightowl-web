import { useMemo, useState } from 'react';
import { hm, datePart } from '../core/format.js';
import { storylines, teamName, TEAM_MAP } from '../data/index.js';
import { sleepTier, storyBonus, followedBonus, leagueBonus, PRODUCT_WEIGHTS, WATCH_COST } from '../core/engine.js';
import {
  narrativeOf,
  tierAdviceOf,
  seasonIdentityOf,
  storylinesOf,
  TIERS,
  TIER_MAP
} from '../core/narrative.js';
import { evalOne } from '../core/owl.js';
import { computeMatchStats } from '../core/stats.js';
import { Chip, Crest, Hint, Meta, SectionLabel } from './atoms.jsx';
import {
  IconCompare,
  IconCost,
  IconDerby,
  IconForm,
  IconH2H,
  IconIdentity,
  IconNoH2H,
  IconTier
} from './icons.jsx';

/**
 * 右栏情报板
 *
 * ⚠️ 铁律：**不得出现任何无数据源的字段**（判据见《数据可达性对账表》）
 *    禁止：xG / 控球率 / 传球精度 / 阵型 / 首发 / 节律 / 对抗强度 / 码率 / 线路延迟
 *    本面板只用真实资产：睡眠档位 · 德比与故事线 · 赛季身份 · 真实已赛战绩与交手数据
 *
 * 结构（P1 重构）：
 *   此前是 `md:grid-cols-3` 的三张等宽卡片 —— 那是落地页的版式，不是工具界面的版式：
 *   三栏内容量天然不等，短的那两栏底部留出一大片空白；而且每栏都自带圆角、底色、
 *   标题栏和图标，卡片里再套卡片，一屏十几个盒子却没有主次。
 *   现在改为**一个面板 + 两列分区流**：分区之间用 hairline 与留白分隔，
 *   内容量决定高度，不再有需要时才有底的等高盒子。
 *
 *   对阵标题也不再在这里重复一次 —— 主舞台顶部条是全应用唯一的对阵命名处。
 */
export default function IntelPanel({ match, prefs, indexHint }) {
  const [tab, setTab] = useState('decision');

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
      <section className="flex min-h-[200px] flex-1 items-center justify-center rounded-lg border border-line-hairline bg-surface-card">
        <p className="text-xs text-text-muted">从左侧选择一场比赛，查看熬夜代价与赛前情报</p>
      </section>
    );
  }

  const storyB = storyBonus(ev, PRODUCT_WEIGHTS);
  const followedB = followedBonus(ev, PRODUCT_WEIGHTS);
  const leagueB = leagueBonus(ev, PRODUCT_WEIGHTS);

  return (
    <section className="rounded-lg border border-line-hairline bg-surface-card shadow-card">
      {/* 面板头：只放视图切换，不放对阵信息 */}
      <div className="flex items-center justify-between gap-3 border-b border-line-hairline px-3.5 py-2">
        <div className="flex items-center gap-0.5" role="tablist" aria-label="情报视图">
          <PanelTab active={tab === 'decision'} onClick={() => setTab('decision')} icon={<IconCost />}>
            熬夜代价与看点
          </PanelTab>
          <PanelTab active={tab === 'stats'} onClick={() => setTab('stats')} icon={<IconForm />}>
            双方数据
          </PanelTab>
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <Hint content={indexHint} align="end" />
          <Meta>夜猫指数</Meta>
          <span className="font-num text-sm font-semibold tabular-nums text-accent">
            {index.toFixed(1)}
          </span>
        </div>
      </div>

      {tab === 'decision' ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-0 p-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3 lg:pr-6 lg:border-r lg:border-line-hairline">
            <SleepCostSection tier={tier} match={match} />
            <NarrativeSection narrative={narrative} stories={stories} ev={ev} />
          </div>
          <div className="space-y-3 pt-3 lg:pt-0 lg:pl-1">
            <IdentitySection match={match} identity={identity} />
            <AttributionSection
              ev={ev}
              tier={tier}
              index={index}
              storyB={storyB}
              followedB={followedB}
              leagueB={leagueB}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 p-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3 lg:pr-6 lg:border-r lg:border-line-hairline">
            <FormSection match={match} stats={stats} />
            <SeasonSection match={match} stats={stats} />
          </div>
          <div className="pt-3 lg:pt-0 lg:pl-1">
            <H2HSection match={match} stats={stats} />
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 面板内基建                                                          */
/* ------------------------------------------------------------------ */

function PanelTab({ active, onClick, icon, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'bg-surface-accent font-semibold text-accent'
          : 'text-text-muted hover:bg-surface-raised hover:text-text-primary'
      }`}
    >
      {icon}
      <span className="ml-1.5">{children}</span>
    </button>
  );
}

/** 分区：图标 + 标题在左，内容在下；靠 hairline 与留白分隔，不套盒子 */
function Block({ icon, title, right, children }) {
  return (
    <section>
      <SectionLabel right={right} className="mb-1.5">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-text-faint">{icon}</span>
          {title}
        </span>
      </SectionLabel>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 决策视图                                                            */
/* ------------------------------------------------------------------ */

function SleepCostSection({ tier, match }) {
  const style = TIER_MAP[tier.label] || TIER_MAP.S0;
  return (
    <Block icon={<IconTier />} title="睡眠代价" right={<Meta num>{match.tbd ? '时间待定' : `${hm(match.t)} 开球`}</Meta>}>
      <div className="flex items-baseline gap-2">
        <span className={`font-num text-xl font-semibold tabular-nums ${style.text}`}>{tier.cost}h</span>
        <span className="text-xs text-text-secondary">
          <span className={`font-num ${style.text}`}>{tier.label}</span> {tier.zh}档
        </span>
      </div>

      {/* 五档连续色阶：当前档实心，其余压暗。取代此前 emerald/teal/amber/orange/purple 五色并置 */}
      <div className="mt-2.5 flex gap-1" role="img" aria-label={`睡眠档位 ${tier.label}`}>
        {TIERS.map(t => {
          const on = t.label === tier.label;
          const passed = TIERS.findIndex(x => x.label === t.label) < TIERS.findIndex(x => x.label === tier.label);
          return (
            <span
              key={t.label}
              title={`${t.label} 档`}
              className={`h-1 flex-1 rounded-full ${on ? t.solid : passed ? `${t.solid} opacity-30` : 'bg-line-control'}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between">
        <Meta>S0 零成本</Meta>
        <Meta>S4 极限</Meta>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-text-secondary">{tierAdviceOf(match)}</p>
    </Block>
  );
}

function NarrativeSection({ narrative, stories, ev }) {
  /* 同屏去重：narrativeOf 的 L2 层会把故事线拼成「名：简介」塞进 lines，
     而本节下面又把同一批故事线渲染成 name / desc 列表 —— 一条内容出现两遍。
     这里只在渲染层过滤，数据层不动：lines 同时是 headline 的候选池，
     拿掉故事线会让「有故事线但无德比」的场次掉到 L3 兜底文案。 */
  const fromStories = new Set(stories.map(s => `${s.name}：${s.desc}`));
  const lines = narrative.lines.filter(l => !fromStories.has(l));
  const rivalryShown = ev.rivalry && !narrative.headline.includes(ev.rivalry);

  return (
    <Block
      icon={<IconDerby />}
      title="看点与故事线"
      right={
        <Hint
          content="看点内容分三层供给：人工精修 → 规则合成（德比 / 故事线 / 赛季身份）→ 联赛与档位兜底，保证任何一场都不会空白。"
          align="end"
        />
      }
    >
      {rivalryShown && (
        <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-warn">
          <IconDerby size={12} />
          {ev.rivalry}
        </p>
      )}
      <p className="text-sm font-medium leading-snug text-text-primary">{narrative.headline}</p>

      {lines.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-text-secondary">
              <span className="mt-2.5 h-px w-2.5 shrink-0 bg-line-control" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      )}

      {stories.length > 0 && (
        <dl className="mt-2.5 space-y-1.5">
          {stories.map(s => (
            <div key={s.id} className="flex gap-2.5">
              <dt className="w-24 shrink-0 truncate text-xs font-medium text-text-primary" title={s.name}>
                {s.name}
              </dt>
              <dd className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
                {s.desc}
                {ev.keyNode && <span className="ml-1.5 text-2xs text-warn">关键节点</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {narrative.trivia && (
        <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
          <span className="text-text-faint">背景 · </span>
          {narrative.trivia}
        </p>
      )}
    </Block>
  );
}

function IdentitySection({ match, identity }) {
  return (
    <Block icon={<IconIdentity />} title="赛季身份">
      <ul className="space-y-1">
        {[
          { id: match.h, side: '主' },
          { id: match.a, side: '客' }
        ].map(({ id, side }) => {
          const tag = TEAM_MAP[id]?.tag;
          return (
            <li key={id} className="flex items-center gap-2">
              <Crest id={id} size={16} />
              <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{teamName(id)}</span>
              <Meta>{side}</Meta>
              {tag ? <Chip tone="accent">{tag}</Chip> : <Meta>常规</Meta>}
            </li>
          );
        })}
      </ul>
      {!identity.fallback && (
        <p className="mt-2 text-xs leading-relaxed text-text-muted">{identity.lines.join(' · ')}</p>
      )}
    </Block>
  );
}

function AttributionSection({ ev, tier, index, storyB, followedB, leagueB }) {
  const rows = [
    ['看点星级', `${ev.star} / 3`],
    ['故事线加成', storyB],
    ['主队加成', followedB],
    ['联赛加成', leagueB],
    ['睡眠成本', `−${tier.cost}h`],
    ['观看占用', `−${WATCH_COST}h`]
  ];
  return (
    <Block
      icon={<IconCompare />}
      title="指数归因"
      right={<Hint content="各分项由推荐引擎实时算出，与排序口径完全一致，不是展示用的近似值。" align="end" />}
    >
      <dl className="space-y-1">
        {rows.map(([label, val]) => {
          const numeric = typeof val === 'number';
          const shown = numeric ? (val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)) : val;
          const tone = numeric ? (val > 0 ? 'text-text-primary' : 'text-text-faint') : 'text-text-secondary';
          return (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <dt className="text-2xs text-text-muted">{label}</dt>
              <dd className={`font-num text-2xs tabular-nums ${tone}`}>{shown}</dd>
            </div>
          );
        })}
        <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-line-hairline pt-1">
          <dt className="text-2xs font-medium text-text-secondary">综合指数</dt>
          <dd className="font-num text-xs font-semibold tabular-nums text-accent">{index.toFixed(1)}</dd>
        </div>
      </dl>
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/* 数据视图                                                            */
/* ------------------------------------------------------------------ */

function FormSection({ match, stats }) {
  return (
    <Block icon={<IconForm />} title="近 5 场走势">
      {[
        { id: match.h, form: stats?.home?.form || [] },
        { id: match.a, form: stats?.away?.form || [] }
      ].map(({ id, form }) => (
        <div key={id} className="mb-2 last:mb-0">
          <div className="flex items-center gap-2">
            <Crest id={id} size={16} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{teamName(id)}</span>
            {form.length === 0 ? (
              <Meta>暂无完赛记录</Meta>
            ) : (
              <span className="flex gap-0.5">
                {form.map((f, i) => (
                  <span
                    key={i}
                    title={`${f.date.slice(0, 10)} vs ${teamName(f.opponent)} ${f.score}`}
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-sm text-2xs font-semibold text-bg-app ${
                      f.result === 'W' ? 'bg-result-win' : f.result === 'D' ? 'bg-result-draw' : 'bg-result-loss'
                    }`}
                  >
                    {f.result === 'W' ? '胜' : f.result === 'D' ? '平' : '负'}
                  </span>
                ))}
              </span>
            )}
          </div>
          {form.length > 0 && (
            <ul className="mt-1 space-y-0.5 pl-6">
              {form.slice(0, 3).map(f => (
                <li key={f.matchId} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-2xs text-text-muted">
                    {f.isHome ? '主' : '客'} vs {teamName(f.opponent)}
                  </span>
                  <span className="font-num text-2xs tabular-nums text-text-secondary">{f.score}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </Block>
  );
}

function SeasonSection({ match, stats }) {
  const rows = [
    ['胜率', `${stats?.home?.season?.winRate || 0}%`, `${stats?.away?.season?.winRate || 0}%`,
      stats?.home?.season?.winRate || 0, stats?.away?.season?.winRate || 0, false],
    ['场均进球', stats?.home?.season?.avgGoalsFor || '0.0', stats?.away?.season?.avgGoalsFor || '0.0',
      parseFloat(stats?.home?.season?.avgGoalsFor || 0), parseFloat(stats?.away?.season?.avgGoalsFor || 0), false],
    ['场均失球', stats?.home?.season?.avgGoalsAgainst || '0.0', stats?.away?.season?.avgGoalsAgainst || '0.0',
      parseFloat(stats?.home?.season?.avgGoalsAgainst || 0), parseFloat(stats?.away?.season?.avgGoalsAgainst || 0), true],
    ['零封场次', `${stats?.home?.season?.cleanSheets || 0}`, `${stats?.away?.season?.cleanSheets || 0}`,
      stats?.home?.season?.cleanSheets || 0, stats?.away?.season?.cleanSheets || 0, false],
    ['净胜球', fmtDiff(stats?.home?.season?.goalDiff), fmtDiff(stats?.away?.season?.goalDiff),
      stats?.home?.season?.goalDiff || 0, stats?.away?.season?.goalDiff || 0, false]
  ];

  return (
    <Block
      icon={<IconCompare />}
      title="赛季攻防对比"
      right={
        <span className="flex items-center gap-2">
          <Crest id={match.h} size={14} />
          <Crest id={match.a} size={14} />
        </span>
      }
    >
      <div className="space-y-2">
        {rows.map(([label, v1, v2, n1, n2, reverse]) => {
          const total = n1 + n2;
          const r1 = total > 0 ? (n1 / total) * 100 : 50;
          const homeBetter = reverse ? n1 < n2 : n1 > n2;
          const awayBetter = reverse ? n2 < n1 : n2 > n1;
          return (
            <div key={label}>
              <div className="flex items-baseline justify-between">
                <span
                  className={`w-14 text-right font-num text-2xs tabular-nums ${
                    homeBetter ? 'font-semibold text-text-primary' : 'text-text-muted'
                  }`}
                >
                  {v1}
                </span>
                <span className="text-2xs text-text-faint">{label}</span>
                <span
                  className={`w-14 font-num text-2xs tabular-nums ${
                    awayBetter ? 'font-semibold text-text-primary' : 'text-text-muted'
                  }`}
                >
                  {v2}
                </span>
              </div>
              {/* 双向条：各自从中心向外生长，占优一侧用品牌色 */}
              <div className="mt-1 flex h-1 gap-px">
                <div className="flex h-full flex-1 justify-end overflow-hidden rounded-full bg-line-hairline">
                  <div
                    className={`h-full rounded-full ${homeBetter ? 'bg-accent' : 'bg-line-control'}`}
                    style={{ width: `${r1}%` }}
                  />
                </div>
                <div className="flex h-full flex-1 overflow-hidden rounded-full bg-line-hairline">
                  <div
                    className={`h-full rounded-full ${awayBetter ? 'bg-accent' : 'bg-line-control'}`}
                    style={{ width: `${100 - r1}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <Meta>
          {teamName(match.h)} 主场 {stats?.home?.season?.home?.wins || 0}胜
          {stats?.home?.season?.home?.draws || 0}平 {stats?.home?.season?.home?.losses || 0}负
        </Meta>
        <Meta>
          {teamName(match.a)} 客场 {stats?.away?.season?.away?.wins || 0}胜
          {stats?.away?.season?.away?.draws || 0}平 {stats?.away?.season?.away?.losses || 0}负
        </Meta>
      </div>
    </Block>
  );
}

function fmtDiff(n) {
  const v = n || 0;
  return v > 0 ? `+${v}` : `${v}`;
}

function H2HSection({ match, stats }) {
  const meetings = stats?.h2h?.meetings || [];
  const summary = stats?.h2h?.summary;
  return (
    <Block icon={<IconH2H />} title="历史交锋" right={summary ? <Meta num>共 {summary.total} 战</Meta> : null}>
      {meetings.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-4 text-center">
          <span className="text-text-faint">
            <IconNoH2H />
          </span>
          <p className="text-xs text-text-muted">两队本赛季尚未直接交锋</p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-num text-2xs tabular-nums text-result-win">
              {teamName(match.h)} {summary.t1Wins} 胜
            </span>
            <span className="font-num text-2xs tabular-nums text-result-draw">{summary.draws} 平</span>
            <span className="font-num text-2xs tabular-nums text-result-loss">
              {summary.t2Wins} 胜 {teamName(match.a)}
            </span>
          </div>
          <ul className="scrollbar-thin max-h-[150px] space-y-0.5 overflow-y-auto pr-1">
            {meetings.map(m => (
              <li key={m.id} className="flex items-baseline justify-between gap-2">
                <Meta num className="w-12 shrink-0">{datePart(m.date).slice(5)}</Meta>
                <span className="min-w-0 flex-1 truncate text-2xs text-text-secondary">
                  {teamName(m.home)} vs {teamName(m.away)}
                </span>
                <span className="font-num text-2xs font-semibold tabular-nums text-text-primary">{m.score}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Block>
  );
}
