/**
 * 情报面板 · 数据视图分区
 *
 * 从 IntelPanel.jsx 拆出：四个分区（走势 / 积分榜 / 赛季数据 / 历史交手）
 * 与「决策视图」没有共享状态，只是共用 Block 排版原语。拆开后：
 *   · IntelPanel 只负责取数、切 tab 与组装；
 *   · 想改某一块的排版时不必在 800 行里找位置。
 */

import { Chip, Crest, Hint, Meta } from '../atoms.jsx';
import { bjDate, formatGoalDiff } from '../../core/format.js';
import { teamName, leagueName } from '../../data/index.js';
import { IconCompare, IconForm, IconH2H } from '../icons.jsx';
import { Block } from './primitives.jsx';

/* ------------------------------------------------------------------ */
/* 数据视图                                                            */
/* ------------------------------------------------------------------ */

export function FormSection({ match, stats, onSelect }) {
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
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-sm text-2xs font-semibold text-result-ink ${
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
                {form.map(f => (
                  <li key={f.matchId}>
                    <button
                      type="button"
                      onClick={() => f.matchId && onSelect?.(f.matchId)}
                      title="查看这场比赛"
                      aria-label={`查看 ${teamName(id)} 与 ${teamName(f.opponent)} 的比赛`}
                      className="flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-raised focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
                    >
                      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-2xs text-text-muted">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            f.result === 'W'
                              ? 'bg-result-win'
                              : f.result === 'D'
                                ? 'bg-result-draw'
                                : 'bg-result-loss'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          {f.isHome ? '主' : '客'} vs {teamName(f.opponent)}
                        </span>
                      </span>
                      <span className="font-num text-2xs tabular-nums text-text-secondary">{f.score}</span>
                    </button>
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

/**
 * 积分榜位置：只展示当前比赛双方，不展开完整联赛表。
 * 数据按开球时点截止；已完赛场次不显示之后的结果。
 */
export function StandingsSection({ standings, match, onOpenStandings }) {
  if (!standings || !standings.supported) return null;

  const asOfText = standings.historical
    ? '截至本场开球前'
    : standings.lastResultAt
      ? `截至 ${bjDate(standings.lastResultAt).slice(5)}`
      : '暂无赛果';

  const rows = [
    { id: match.h, row: standings.home },
    { id: match.a, row: standings.away }
  ];

  return (
    <Block
      icon={<IconCompare />}
      title="积分榜位置"
      right={
        <span className="flex items-center gap-1.5">
          <Meta>{leagueName(standings.league)}</Meta>
          <Meta num>
            {asOfText} · {standings.doneCount} 场
            {standings.excludedCount > 0 ? ` · 已排除 ${standings.excludedCount} 场未揭晓` : ''}
          </Meta>
          <Hint
            content={`${standings.tiebreakerNote} 国内前四/后三名为参考线，不代表官方资格规则；欧冠分区按赛制。已完赛场次按开球时点截止。`}
            align="end"
          />
        </span>
      }
    >
      {standings.rows.length === 0 ? (
        <p className="py-1 text-2xs text-text-faint">
          {standings.note || '本联赛暂无已同步赛果'}
        </p>
      ) : (
        <div>
          {rows.map(({ id, row }) => (
            <div
              key={id}
              className="border-t border-line-hairline py-1.5 first:border-t-0"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Crest id={id} size={16} />
                <span className="min-w-0 truncate text-xs font-medium text-text-primary">
                  {teamName(id)}
                </span>
                {row && row.zoneKey !== 'mid' && (
                  <Chip tone={row.zoneTone === 'warn' ? 'warn' : 'neutral'}>
                    {row.zoneLabel}
                  </Chip>
                )}
                {row ? (
                  <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 font-num text-2xs tabular-nums text-text-secondary">
                    <span>第 {row.rank}</span>
                    <span className="text-text-faint">·</span>
                    <span>{row.played} 场</span>
                    <span className="text-text-faint">·</span>
                    <span>{row.points} 分</span>
                    <span className="text-text-faint">·</span>
                    <span>净胜球 {formatGoalDiff(row.gd)}</span>
                  </span>
                ) : (
                  <span className="ml-auto text-2xs text-text-faint">暂无排名</span>
                )}
              </div>
              {row?.context && (
                <p className="mt-0.5 pl-6 text-2xs leading-relaxed text-text-muted">
                  {row.context.primary}
                  {row.context.secondary ? ` · ${row.context.secondary}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {onOpenStandings && standings.rows.length > 0 && (
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenStandings(standings.league, match.id)}
            className="rounded-md px-1.5 py-0.5 text-2xs font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
          >
            查看完整积分榜 →
          </button>
        </div>
      )}
    </Block>
  );
}

export function SeasonSection({ match, stats }) {
  const rows = [
    ['胜率', `${stats?.home?.season?.winRate || 0}%`, `${stats?.away?.season?.winRate || 0}%`,
      stats?.home?.season?.winRate || 0, stats?.away?.season?.winRate || 0, false],
    ['场均进球', stats?.home?.season?.avgGoalsFor || '0.0', stats?.away?.season?.avgGoalsFor || '0.0',
      parseFloat(stats?.home?.season?.avgGoalsFor || 0), parseFloat(stats?.away?.season?.avgGoalsFor || 0), false],
    ['场均失球', stats?.home?.season?.avgGoalsAgainst || '0.0', stats?.away?.season?.avgGoalsAgainst || '0.0',
      parseFloat(stats?.home?.season?.avgGoalsAgainst || 0), parseFloat(stats?.away?.season?.avgGoalsAgainst || 0), true],
    ['零封场次', `${stats?.home?.season?.cleanSheets || 0}`, `${stats?.away?.season?.cleanSheets || 0}`,
      stats?.home?.season?.cleanSheets || 0, stats?.away?.season?.cleanSheets || 0, false],
    ['净胜球', formatGoalDiff(stats?.home?.season?.goalDiff), formatGoalDiff(stats?.away?.season?.goalDiff),
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

/**
 * 历史交锋：整幅横条。
 *
 * 快照里 91.5% 的场次走到空态，而空态此前是「标题行 + 一行弱文字」= 实测 51px 纯空白，
 * 所以空态压成一行：图标 + 分区名 + 说明，同一基线，实测 16px。
 * 有交锋时逐条横向排开 —— 一个赛季里同联赛一对最多两回合，不需要滚动条，
 * 也不再单列胜/平/负汇总：最多 1-2 场时比分自证，
 * 而此前把客队胜场涂成 result-loss 红，是把"赛果三态"当成了"敌我"。
 */
export function H2HSection({ stats, onSelect }) {
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
      <ul className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {meetings.map(m => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onSelect?.(m.id)}
              title="查看这场比赛"
              aria-label={`查看 ${teamName(m.home)} 对 ${teamName(m.away)} 的比赛`}
              className="flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-surface-raised focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
            >
              <Meta num>{datePart(m.date).slice(5)}</Meta>
              <span className="text-text-secondary">
                {teamName(m.home)} <span className="text-text-faint">vs</span> {teamName(m.away)}
              </span>
              <span className="font-num font-semibold tabular-nums text-text-primary">{m.score}</span>
            </button>
          </li>
        ))}
      </ul>
    </Block>
  );
}
