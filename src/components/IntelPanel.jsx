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
export default function IntelPanel({ match, prefs, indexHint, intel: propIntel }) {
  const [tab, setTab] = useState('decision');

  const evalResult = useMemo(() => {
    if (propIntel?.ev) return { ev: propIntel.ev, index: propIntel.index };
    return match ? evalOne(match, prefs) : null;
  }, [propIntel, match, prefs]);
  const ev = evalResult?.ev || null;
  const index = evalResult?.index ?? propIntel?.index ?? 0;
  const tier = useMemo(() => propIntel?.tier || (match ? sleepTier(match.t) : null), [propIntel?.tier, match?.t]);
  const narrative = useMemo(
    () => propIntel?.narrative || (match && ev ? narrativeOf(match, ev, storylines) : null),
    [propIntel?.narrative, match, ev]
  );
  const stories = useMemo(() => (match ? storylinesOf(match, storylines) : []), [match]);
  const identity = useMemo(() => (match ? seasonIdentityOf(match) : null), [match]);
  const stats = useMemo(() => (match ? computeMatchStats(match) : null), [match]);

  if (!match || !ev || !tier || !narrative || !identity) {
    return (
      <section className="flex min-h-[200px] flex-1 items-center justify-center rounded-xl border border-line-hairline bg-surface-card">
        <p className="text-xs text-text-muted">从左侧选择一场比赛，查看熬夜代价与赛前情报</p>
      </section>
    );
  }

  const storyB = storyBonus(ev, PRODUCT_WEIGHTS);
  const followedB = followedBonus(ev, PRODUCT_WEIGHTS);
  const leagueB = leagueBonus(ev, PRODUCT_WEIGHTS);

  return (
    <section className="overflow-hidden rounded-xl border border-line-hairline bg-surface-panel shadow-card">
      {/* 面板头：只放视图切换，不放对阵信息 */}
      <div className="flex items-center justify-between gap-3 border-b border-line-hairline bg-surface-raised/40 px-3.5 py-2.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="情报视图">
          <PanelTab active={tab === 'decision'} onClick={() => setTab('decision')} icon={<IconCost />}>
            熬夜代价与看点
          </PanelTab>
          <PanelTab active={tab === 'stats'} onClick={() => setTab('stats')} icon={<IconForm />}>
            双方数据
          </PanelTab>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Meta>夜猫指数</Meta>
          <span className="font-num text-sm font-semibold tabular-nums text-accent">
            {index.toFixed(1)}
          </span>
          <Hint content={indexHint} side="bottom" align="end" />
        </div>
      </div>

      {tab === 'decision' ? (
        <div className="grid grid-cols-1 gap-x-0 gap-y-0 p-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3 lg:pr-6 lg:border-r lg:border-line-hairline">
            <SleepCostSection tier={tier} match={match} />
            <NarrativeSection narrative={narrative} stories={stories} ev={ev} />
          </div>
          <div className="space-y-3 pt-3 lg:pt-0 lg:pl-6">
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
        /* 分栏依据是实测排版尺寸，不是"看起来对称"（1440 窗口下面板内容宽 1047px）：
           此前两等分 → 走势列 437px，而对手名实测只有 50-94px 宽，
           比分被 justify-between 甩到 315px 之外，行内两个元素不再成组。
           攻防对比能撑住 527px 是因为下面有双向条把两端连起来，走势列表没有这种结构。
           所以走势给固定的 300px（刚好容下 16rem 的内容收口 + 一点余量），
           剩下的宽度全部让给对比条。
           历史交锋则降级为整幅横条：快照里 1,738 场未开赛有 91.5% 交锋为 0 场，
           其余也只有 1 场（快照只含一个赛季，同联赛一对最多两回合）。 */
        <div className="p-3.5">
          <div className="grid grid-cols-1 gap-x-0 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <div className="lg:pr-6 lg:border-r lg:border-line-hairline">
              <FormSection match={match} stats={stats} />
            </div>
            <div className="pt-3 lg:pt-0 lg:pl-6">
              <SeasonSection match={match} stats={stats} />
            </div>
          </div>
          <div className="mt-3 border-t border-line-hairline pt-2.5">
            <H2HSection stats={stats} />
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
      className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs transition-all ${
        active
          ? 'bg-surface-accent border border-accent/40 font-semibold text-accent shadow-sm'
          : 'border border-transparent text-text-muted hover:border-line-hairline hover:bg-surface-raised hover:text-text-primary'
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
  /* 反向去重：L2 的 headline 常常就是第一条故事线（`${name}：${desc}`），
     而下面的列表又把同一条按 name / desc 渲染一遍 —— 整句原样出现两遍。
     同样只在渲染层处理：headline 与 lines 的候选池关系见上面的注释。 */
  const shownStories = stories.filter(s => `${s.name}：${s.desc}` !== narrative.headline);

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

      {shownStories.length > 0 && (
        <dl className="mt-2.5 space-y-1.5">
          {shownStories.map(s => (
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
              {/* 身份是事实不是选中态，所以用中性 chip：
                  一屏之内金色只留给当前 tab、夜猫指数与主行动 */}
              {tag ? <Chip tone="neutral">{tag}</Chip> : <Meta>常规</Meta>}
            </li>
          );
        })}
      </ul>
      {/* 有标签时身份已经在每行的 chip 上，不再用散文把同样的话复述一遍；
          只有两队都无标签（94/111 队如此）才回落显示联赛 + 轮次 —— D5 约定 */}
      {identity.fallback && (
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
    ['睡眠代价', `${tier.cost}h (${tier.label} ${tier.zh})`],
    ['观看占用', `${WATCH_COST}h`]
  ];
  return (
    <Block
      icon={<IconCompare />}
      title="指数归因"
      right={<Hint content="指数计算为：(基础看点 + 各项加成) ÷ (1 + 睡眠代价 + 观看占用)。各分项由推荐引擎实时算出，与排序口径完全一致。" align="end" />}
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
          {/* 与面板头部的「夜猫指数」是同一个数：金色只给头部那一个，
              这里的合计行留在表内闭合分解，不再重复强调 */}
          <dd className="font-num text-xs font-semibold tabular-nums text-text-primary">
            {index.toFixed(1)}
          </dd>
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
      {/* 16rem 的收口：让两队的比分列与队名行右缘对齐。
          实测放到 20rem 时"对手名 → 比分"仍有 177-221px 空隙，比分不像在说这一行；
          收到 16rem 后空隙约 115-160px，比分成一列，可竖着扫。 */}
      <div className="max-w-[16rem]">
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
      </div>
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
              {/* 双向条：各自从中心向外生长。占优一侧用中性亮色而非品牌金 ——
                  一屏五行同时金色等于把 accent 当成"胜负"语义色，
                  而它按规范只表示品牌与主行动；明度差足够表达谁占优，
                  与上方数值的字重处理是同一套口径。 */}
              <div className="mt-1 flex h-1 gap-px">
                <div className="flex h-full flex-1 justify-end overflow-hidden rounded-full bg-line-hairline">
                  <div
                    className={`h-full rounded-full ${homeBetter ? 'bg-text-secondary' : 'bg-line-control'}`}
                    style={{ width: `${r1}%` }}
                  />
                </div>
                <div className="flex h-full flex-1 overflow-hidden rounded-full bg-line-hairline">
                  <div
                    className={`h-full rounded-full ${awayBetter ? 'bg-text-secondary' : 'bg-line-control'}`}
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

/**
 * 历史交锋：整幅横条。
 *
 * 快照里 91.5% 的场次走到空态，而空态此前是「标题行 + 一行弱文字」= 实测 51px 纯空白，
 * 所以空态压成一行：图标 + 分区名 + 说明，同一基线，实测 16px。
 * 有交锋时逐条横向排开 —— 一个赛季里同联赛一对最多两回合，不需要滚动条，
 * 也不再单列胜/平/负汇总：最多 1-2 场时比分自证，
 * 而此前把客队胜场涂成 result-loss 红，是把"赛果三态"当成了"敌我"。
 */
function H2HSection({ stats }) {
  const meetings = stats?.h2h?.meetings || [];

  if (meetings.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-2xs text-text-faint">
        <IconH2H size={12} />
        <span className="text-text-muted">历史交锋</span>
        <span aria-hidden="true">·</span>
        <span>两队本赛季尚未直接交锋</span>
      </div>
    );
  }

  return (
    <Block icon={<IconH2H />} title="历史交锋" right={<Meta num>共 {meetings.length} 战</Meta>}>
      <ul className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {meetings.map(m => (
          <li key={m.id} className="flex items-baseline gap-1.5 text-xs">
            <Meta num>{datePart(m.date).slice(5)}</Meta>
            <span className="text-text-secondary">
              {teamName(m.home)} <span className="text-text-faint">vs</span> {teamName(m.away)}
            </span>
            <span className="font-num font-semibold tabular-nums text-text-primary">{m.score}</span>
          </li>
        ))}
      </ul>
    </Block>
  );
}
