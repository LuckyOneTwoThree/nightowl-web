import { useEffect, useMemo, useState } from 'react';
import { hm } from '../core/format.js';
import { storylines, teamName, TEAM_MAP } from '../data/index.js';
import { sleepTier, storyBonus, followedBonus, leagueBonus, PRODUCT_WEIGHTS, WATCH_COST } from '../core/engine.js';
import { computeMatchStandings } from '../core/standings.js';
import {
  driversOf,
  narrativeOf,
  tierAdviceOf,
  seasonIdentityOf,
  storylinesOf,
  TIERS,
  TIER_MAP
} from '../core/narrative.js';
import { evalOne } from '../core/owl.js';
import { decisionStrip } from '../core/decision-strip.js';
import { computeMatchStats } from '../core/stats.js';
import { canRecheck, dataStateHint, dataStateTone, dataStateTrustLabel, matchDataState } from '../core/data-health.js';
import { Button, Chip, Crest, Hint, Meta } from './atoms.jsx';
import { VERDICT_COPY, reasonTextOf } from './DecisionStrip.jsx';
import { PanelTab, Block } from './intel/primitives.jsx';
import { FormSection, StandingsSection, SeasonSection, H2HSection } from './intel/StatsSections.jsx';
import UpcomingFixtures from './UpcomingFixtures.jsx';
import SleepNote, { sleepLedgerFor } from './SleepNote.jsx';
import SameNightPicks from './SameNightPicks.jsx';
import {
  IconCalendar,
  IconCompare,
  IconCost,
  IconDerby,
  IconForm,
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
 * 结构（P1 重构 + P1-4 三级披露）：
 *   更早是 `md:grid-cols-3` 的三张等宽卡片 —— 那是落地页的版式，不是工具界面的版式：
 *   三栏内容量天然不等，短的那两栏底部留出一大片空白；而且每栏都自带圆角、底色、
 *   标题栏和图标，卡片里再套卡片，一屏十几个盒子却没有主次。
 *   中间那版改成「一个面板 + 两列分区流」，解决了盒子问题，但仍是 8 个分区同时铺开 ——
 *   每块都成立，可五块等权等于没有主次。
 *
 *   现在按「结论 → 证据 → 算法」三段披露：
 *     第一层  结论 / 为什么看这场（最多三条语义驱动） / 数据可信度  ← 不滚动就能答完
 *     第一层  睡眠代价（分母必须与分子同屏，否则结论无法自证）
 *     第二层  指数归因（唯一主图表，分子分母在一张表里闭合）
 *     第三层  看点与故事线 / 赛季身份（折叠抽屉，收起时留一行摘要）
 *
 *   对阵标题也不再在这里重复一次 —— 主舞台顶部条是全应用唯一的对阵命名处。
 */
export default function IntelPanel({
  match,
  prefs,
  indexHint,
  intel: propIntel,
  excludedIds = null,
  isHeroMatch = false,
  onSelect,
  onOpenStandings,
  now,
  watchLaterState = 'none',
  onWatchLater,
  matchChecks = {},
  onRecheckMatch,
  recheckingId = null,
  recheckMsg = null
}) {
  const [tab, setTab] = useState('decision');

  const evalResult = useMemo(() => {
    if (propIntel?.ev) return { ev: propIntel.ev, index: propIntel.index };
    return match ? evalOne(match, prefs) : null;
  }, [propIntel, match, prefs]);
  const ev = evalResult?.ev || null;
  const index = evalResult?.index ?? propIntel?.index ?? 0;
  // 只用到 match.t：先取出来再做依赖，避免把整个 match 放进依赖（父组件每次渲染都传新对象）
  const kickoffWall = match ? match.t : null;
  const tier = useMemo(() => propIntel?.tier || (kickoffWall ? sleepTier(kickoffWall) : null), [propIntel?.tier, kickoffWall]);
  const narrative = useMemo(
    () => propIntel?.narrative || (match && ev ? narrativeOf(match, ev, storylines) : null),
    [propIntel?.narrative, match, ev]
  );
  const stories = useMemo(() => (match ? storylinesOf(match, storylines) : []), [match]);
  const identity = useMemo(() => (match ? seasonIdentityOf(match) : null), [match]);
  const stats = useMemo(() => (match ? computeMatchStats(match, null, { excludeIds: excludedIds }) : null), [match, excludedIds]);
  const standings = useMemo(
    () => (match ? computeMatchStandings(match, null, { nowTs: now, excludeIds: excludedIds }) : null),
    [match, now, excludedIds]
  );

  if (!match || !ev || !tier || !narrative || !identity) {
    return (
      <section className="broadcast-sheen flex min-h-[200px] flex-1 items-center justify-center rounded-2xl border border-line-hairline bg-surface-panel/70">
        <p className="text-xs text-text-muted">从左侧选择一场比赛，查看熬夜代价与赛前情报</p>
      </section>
    );
  }

  const storyB = storyBonus(ev, PRODUCT_WEIGHTS);
  const followedB = followedBonus(ev, PRODUCT_WEIGHTS);
  const leagueB = leagueBonus(ev, PRODUCT_WEIGHTS);
  const drivers = driversOf(ev);

  /* 面板里的结论与左栏决策条共用同一个纯函数与同一份文案表 ——
     但**不传 alternatives**：面板只解释这场值不值，不承担「换一场」的判断与入口。
     一个只说不做的建议比不说更糟。 */
  const decision = decisionStrip({
    match,
    index,
    prefs,
    now: now ?? Date.now(),
    followed: !!ev.isFollowed
  });

  return (
    <section
      id="intel-panel"
      tabIndex={-1}
      aria-label="赛前情报"
      className="broadcast-sheen glass-lift scroll-mt-4 animate-reveal-up overflow-hidden rounded-2xl border border-line-hairline bg-surface-panel/75 shadow-card backdrop-blur-xl focus:outline-none motion-reduce:animate-none"
    >
      {/* 面板头：只放视图切换，不放对阵信息 */}
      <div className="flex items-center justify-between gap-3 border-b border-line-hairline px-4 py-3">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="情报视图">
          <PanelTab active={tab === 'decision'} onClick={() => setTab('decision')} icon={<IconCost />}>
            看点与代价
          </PanelTab>
          <PanelTab active={tab === 'stats'} onClick={() => setTab('stats')} icon={<IconForm />}>
            双方数据
          </PanelTab>
          <PanelTab active={tab === 'related'} onClick={() => setTab('related')} icon={<IconCalendar />}>
            关联赛程
          </PanelTab>
        </div>
        {/* 同屏去重：当前展示的就是左栏 Hero 那场时，27.2 已经在决策卡上以大号出现，
            这里再来一个同值大字，一屏就有四个 27.2（Hero / 舞台胶囊 / 面板头 / 归因合计）。
            指数仍然可查：本面板的「指数归因」表末行就是它，带完整分解。 */}
        {!isHeroMatch && match.tbd && <Meta className="shrink-0">开球时间待定</Meta>}
        {!isHeroMatch && !match.tbd && (
          <div className="flex shrink-0 items-baseline gap-1.5">
            <Meta>夜猫指数</Meta>
            <span className="font-num text-lg font-semibold tracking-tight tabular-nums text-text-primary">
              {index.toFixed(1)}
            </span>
            <Hint content={indexHint} side="bottom" align="end" />
          </div>
        )}
      </div>

      {tab === 'decision' ? (
        /* 三级披露（P1-4）。此前 8 个分区一次铺开：睡眠代价、看点故事线、数据说明、
           赛季身份、指数归因同时可见，每块都成立但五块等权 = 没有主次。
           现在 —— 第一层「结论 / 驱动因素 / 数据可信度」+ 睡眠代价（分母必须与分子同屏），
           第二层只有一张主图表（指数归因），其余降为抽屉，收起时留一行摘要。 */
        <div className="space-y-4 p-4">
          <div className="grid gap-x-5 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
            {!isHeroMatch && <VerdictCell decision={decision} />}
            <DriversCell drivers={drivers} />
            <DataTrustCell
              match={match}
              checkedAt={matchChecks?.[match.id] || 0}
              onRecheck={onRecheckMatch}
              rechecking={recheckingId === match.id}
              result={recheckMsg && recheckMsg.matchId === match.id ? recheckMsg : null}
            />
          </div>

          <div className="grid grid-cols-1 gap-x-0 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="lg:border-r lg:border-line-hairline lg:pr-6">
              <SleepCostSection
                tier={tier}
                match={match}
                prefs={prefs}
                watchLaterState={watchLaterState}
                onWatchLater={onWatchLater}
                hidePersonal={isHeroMatch}
              />
            </div>
            <div className="pt-4 lg:pl-6 lg:pt-0">
              <AttributionSection
                ev={ev}
                tier={tier}
                index={index}
                storyB={storyB}
                followedB={followedB}
                leagueB={leagueB}
                tbd={!!match.tbd}
              />
            </div>
          </div>

          <div className="space-y-2 border-t border-line-hairline pt-3">
            <NarrativeSection narrative={narrative} stories={stories} ev={ev} hideHeadline={isHeroMatch} fold />
            <IdentitySection match={match} identity={identity} fold />
          </div>
        </div>
      ) : tab === 'stats' ? (
        /* 分栏依据是实测排版尺寸，不是"看起来对称"（1440 窗口下面板内容宽 1047px）：
           此前两等分 → 走势列 437px，而对手名实测只有 50-94px 宽，
           比分被 justify-between 甩到 315px 之外，行内两个元素不再成组。
           攻防对比能撑住 527px 是因为下面有双向条把两端连起来，走势列表没有这种结构。
           所以走势给固定的 300px（刚好容下 16rem 的内容收口 + 一点余量），
           剩下的宽度全部让给对比条。
           历史交锋则降级为整幅横条：快照里 1,738 场未开赛有 91.5% 交锋为 0 场，
           其余也只有 1 场（快照只含一个赛季，同联赛一对最多两回合）。 */
        <div className="p-4">
          <div className="grid grid-cols-1 gap-x-0 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <div className="lg:pr-6 lg:border-r lg:border-line-hairline">
              <FormSection match={match} stats={stats} onSelect={onSelect} />
            </div>
            <div className="pt-3 lg:pt-0 lg:pl-6">
              <SeasonSection match={match} stats={stats} />
            </div>
          </div>
          <div className="mt-4 border-t border-line-hairline pt-3">
            <StandingsSection
              standings={standings}
              match={match}
              onOpenStandings={onOpenStandings}
            />
          </div>
          <div className="mt-4 border-t border-line-hairline pt-3">
            <H2HSection stats={stats} onSelect={onSelect} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="lg:border-r lg:border-line-hairline lg:pr-6">
            <UpcomingFixtures match={match} prefs={prefs} now={now} onSelect={onSelect} embedded />
          </div>
          <div className="pt-3 lg:pl-2 lg:pt-0">
            <SameNightPicks match={match} prefs={prefs} now={now} onSelect={onSelect} embedded />
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 面板内基建                                                          */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* 决策视图                                                            */
/* ------------------------------------------------------------------ */

/**
 * 「为什么是这个指数」的语义驱动因素在 `core/narrative.js: driversOf`（双端同源）。
 * 第一层只给最多三条语义标签，不出数字 —— 真正的数值分解在第二层归因表里。
 */

/** 首屏单元格：小标签 + 主值，三格共用同一套版式，避免各写一份 */
function Cell({ label, children }) {
  return (
    <div className="min-w-0">
      <span className="block text-2xs leading-none text-text-faint">{label}</span>
      <div className="mt-1 min-w-0">{children}</div>
    </div>
  );
}

/** 第一层 · 结论（与左栏决策条同源同文案；Hero 场次已经在左栏给过，不重复） */
function VerdictCell({ decision }) {
  if (!decision) return null;
  const verdict = VERDICT_COPY[decision.verdict] || VERDICT_COPY.unknown;
  const reason = reasonTextOf(decision);
  return (
    <Cell label="结论">
      <span className={`text-sm font-bold ${verdict.tone}`}>{verdict.label}</span>
      {reason && <span className="ml-1.5 text-2xs text-text-faint">{reason}</span>}
    </Cell>
  );
}

/** 第一层 · 驱动因素（最多三条，一行可读） */
function DriversCell({ drivers }) {
  return (
    <Cell label="为什么看这场">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {drivers.map((d, i) => (
          <span key={d.key} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
            {i > 0 && (
              <span className="text-text-faint" aria-hidden="true">
                ·
              </span>
            )}
            {d.label}
          </span>
        ))}
      </div>
    </Cell>
  );
}

/**
 * 第一层 · 数据可信度
 *
 * 与旧「数据说明」分区的区别在提问方式：那块只在「说不清为什么没比分」时出现，
 * 这块永远在场 —— 用户需要知道手上这份情报有多可信，而不是只在出问题时才被告知。
 *
 * 正常状态只留一行字，不铺开解释；只有待同步 / 上游未提供才给出说明与重查入口。
 * 问法是「这份快照有多可信」，措辞在 `dataStateTrustLabel`（双端同源）。
 */
function DataTrustCell({ match, checkedAt = 0, onRecheck, rechecking = false, result = null }) {
  const state = matchDataState(match, Date.now());
  const tone = dataStateTone(state);
  const toneCls = tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-text-muted';
  const action = canRecheck(state) && typeof onRecheck === 'function';
  return (
    <Cell label="数据可信度">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${toneCls}`}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              tone === 'warn' ? 'bg-warn' : tone === 'danger' ? 'bg-danger' : 'bg-line-control'
            }`}
            aria-hidden="true"
          />
          {dataStateTrustLabel(state)}
        </span>
        {action && (
          <Button variant="ghost" size="xs" onClick={() => onRecheck(match.id)} disabled={rechecking}>
            {rechecking ? '重查中…' : '重查该场'}
          </Button>
        )}
      </div>
      {action && (
        <p className="mt-1 text-2xs leading-relaxed text-text-muted">
          {dataStateHint(state, checkedAt)}
        </p>
      )}
      {result && (
        <p className={`mt-1 text-2xs ${result.ok ? (result.degraded ? 'text-warn' : 'text-resource') : 'text-danger'}`}>{result.text}</p>
      )}
    </Cell>
  );
}

function SleepCostSection({ tier, match, prefs, watchLaterState = 'none', onWatchLater, hidePersonal = false }) {
  const [queueMsg, setQueueMsg] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换场清掉「已加入补看」提示；body 只调 setState
  useEffect(() => setQueueMsg(null), [match?.id]);
  const style = TIER_MAP[tier.label] || TIER_MAP.S0;
  const queued = watchLaterState === 'pending';
  const watched = watchLaterState === 'watched';
  return (
    <Block icon={<IconTier />} title="睡眠代价" right={<Meta num>{match.tbd ? '时间待定' : `${hm(match.t)} 开球`}</Meta>}>
      {match.tbd ? (
        /* tbd 场次的时间是整轮占位值（多数联赛占位 02:00 / 04:00）。
           用占位时间算档位 = 把「不确定」包装成「S4 极限档」，与产品信任基础相悖；
           这里如实说「时间待定」，不显示档位与成本。 */
        <div className="flex items-baseline gap-2.5">
          <span className="font-num text-2xl font-bold tabular-nums text-text-faint">—</span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">开球时间待定</span>
            <Meta className="mt-0.5">时间确定后才计算熬夜代价</Meta>
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-2.5">
          <span className={`font-num text-2xl font-bold tabular-nums ${style.text}`}>{tier.cost}h</span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">
              <span className={`font-num ${style.text}`}>{tier.label}</span> {tier.zh}档
            </span>
            <Meta num className="mt-0.5">睡眠成本</Meta>
          </div>
        </div>
      )}

      {/* 五档连续色阶：当前档实心，其余压暗。取代此前 emerald/teal/amber/orange/purple 五色并置 */}
      <div className={`mt-2.5 flex gap-1 ${match.tbd ? 'opacity-40' : ''}`} role="img" aria-label={match.tbd ? '睡眠档位待定' : `睡眠档位 ${tier.label}`}>
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

      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        {match.tbd ? '联赛尚未公布具体开球时间；时间确定后档位与成本会自动更新。' : tierAdviceOf(match)}
      </p>
      {/* 同一场时 Hero 卡已经写了「07:30 起床 · 看完约剩 6h · 低于 7h 底线」，
          面板再放一句逐字相同的话只是噪声。换成非 Hero 场次（用户在看别的比赛）时才需要。 */}
      {!hidePersonal && !match.tbd && sleepLedgerFor(match, prefs) && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-raised/40 px-2.5 py-1.5">
          <span className="text-2xs text-text-muted">个人睡眠</span>
          <SleepNote match={match} prefs={prefs} size="md" />
        </div>
      )}
      {onWatchLater && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {queueMsg && <Meta className="mr-auto">{queueMsg}</Meta>}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              const result = onWatchLater?.();
              if (!result?.ok) {
                setQueueMsg(
                  result?.reason === 'full'
                    ? '队列已满，请先在设置中移除旧条目'
                    : '更新补看失败'
                );
                return;
              }
              setQueueMsg(
                result.action === 'added'
                  ? '已加入补看'
                  : result.action === 'restored'
                    ? '已恢复为待补看'
                    : result.action === 'removed'
                      ? '已移出补看'
                      : null
              );
            }}
            data-watch-later-action="toggle"
            title={
              queued
                ? '点击移出补看'
                : watched
                  ? '已看过，点击恢复为待补看'
                  : '不熬夜，赛后补看这场'
            }
          >
            {queued ? '已入补看 · 取消' : watched ? '已看过 · 重新补看' : '加入补看'}
          </Button>
        </div>
      )}
    </Block>
  );
}

function NarrativeSection({ narrative, stories, ev, hideHeadline = false, fold = false }) {
  /* 同屏去重：narrativeOf 的 L2 层会把故事线拼成「名：简介」塞进 lines，
     而本节下面又把同一批故事线渲染成 name / desc 列表 —— 一条内容出现两遍。
     这里只在渲染层过滤，数据层不动：lines 同时是 headline 的候选池，
     拿掉故事线会让「有故事线但无德比」的场次掉到 L3 兜底文案。 */
  const fromStories = new Set(stories.map(s => `${s.name}：${s.desc}`));
  const lines = narrative.lines.filter(l => !fromStories.has(l));
  // L3 的兜底行会重复标题里的档位，或只重复已展示的联赛轮次；标题本身已完整说明数据有限。
  const distinctLines = narrative.level === 'L3' ? [] : lines;
  const rivalryShown = ev.rivalry && !narrative.headline.includes(ev.rivalry);
  /* 反向去重：L2 的 headline 常常就是第一条故事线（`${name}：${desc}`），
     而下面的列表又把同一条按 name / desc 渲染一遍 —— 整句原样出现两遍。
     同样只在渲染层处理：headline 与 lines 的候选池关系见上面的注释。 */
  const shownStories = stories.filter(s => `${s.name}：${s.desc}` !== narrative.headline);

  // 当前选中的就是左栏 Hero 场次时，头条已经在 Hero 卡完整展示过；
  // 这里只补充剩余线索，避免同一句话在左右两栏各出现一次。
  const hasBody =
    (!hideHeadline && narrative.headline) ||
    rivalryShown ||
    distinctLines.length > 0 ||
    shownStories.length > 0 ||
    !!narrative.trivia;
  if (!hasBody) return null;

  // 抽屉摘要：收起时告诉用户里面有几条线索，而不是一个空的标题
  const clueCount = (rivalryShown ? 1 : 0) + distinctLines.length + shownStories.length + (narrative.trivia ? 1 : 0);
  const summary = fold
    ? clueCount > 0
      ? `${clueCount} 条线索`
      : narrative.headline
    : null;

  return (
    <Block
      icon={<IconDerby />}
      title="看点与故事线"
      fold={fold ? { summary } : null}
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
      {!hideHeadline && (
        <p className="text-sm font-medium leading-snug text-text-primary">{narrative.headline}</p>
      )}

      {distinctLines.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {distinctLines.map((line, i) => (
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

function IdentitySection({ match, identity, fold = false }) {
  const tags = [match.h, match.a].map(id => TEAM_MAP[id]?.tag).filter(Boolean);
  return (
    <Block
      icon={<IconIdentity />}
      title="赛季身份"
      fold={fold ? { summary: tags.length ? tags.join(' · ') : '两队均为常规身份' } : null}
    >
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

function AttributionSection({ ev, tier, index, storyB, followedB, leagueB, tbd = false }) {
  const tierStyle = TIER_MAP[tier.label] || TIER_MAP.S0;
  const starPart = ev.star * 10;
  const bonusRows = [
    ['故事线加成', storyB, Math.min(100, (storyB / 16) * 100), 'bg-text-secondary'],
    ['主队加成', followedB, Math.min(100, (followedB / 16) * 100), 'bg-text-secondary'],
    ['联赛加成', leagueB, Math.min(100, (leagueB / 16) * 100), 'bg-text-secondary']
  ].filter(([, value]) => Number(value) > 0);
  const rows = [
    ['基础看点', starPart, Math.min(100, (starPart / 30) * 100), 'bg-text-secondary'],
    ...bonusRows,
    tbd
      ? ['睡眠代价', '时间待定', 0, 'bg-line-control']
      : ['睡眠代价', `${tier.cost}h (${tier.label} ${tier.zh})`, Math.min(100, (tier.cost / 4.5) * 100), tierStyle.solid],
    ['观看占用', `${WATCH_COST}h`, Math.min(100, (WATCH_COST / 2) * 100), 'bg-line-control']
  ];
  return (
    <Block
      icon={<IconCompare />}
      title="指数归因"
      right={<Hint content="指数计算为：(基础看点 + 各项加成) ÷ (1 + 睡眠代价 + 观看占用)。各分项由推荐引擎实时算出，与排序口径完全一致。" align="end" />}
    >
      <dl className="space-y-1.5">
        {rows.map(([label, val, pct, barCls]) => {
          const numeric = typeof val === 'number';
          const shown = numeric ? (val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)) : val;
          const tone = numeric ? (val > 0 ? 'text-text-primary' : 'text-text-faint') : 'text-text-secondary';
          return (
            <div key={label} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-2xs text-text-muted">{label}</dt>
                <dd className={`font-num text-2xs tabular-nums ${tone}`}>{shown}</dd>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-line-hairline" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${barCls} ${pct > 0 ? 'opacity-80' : 'opacity-0'}`}
                  style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                />
              </div>
            </div>
          );
        })}
        <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-line-hairline pt-1.5">
          <dt className="text-2xs font-medium text-text-secondary">综合指数</dt>
          {/* 与面板头部的「夜猫指数」是同一个数：金色只给头部那一个，
              这里的合计行留在表内闭合分解，不再重复强调 */}
          <dd className="font-num text-xs font-semibold tabular-nums text-text-primary">
            {tbd ? '—' : index.toFixed(1)}
          </dd>
        </div>
      </dl>
    </Block>
  );
}
