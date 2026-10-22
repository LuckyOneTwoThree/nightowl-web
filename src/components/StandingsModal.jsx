import { useEffect, useMemo, useRef, useState } from 'react';
import { getFixtures, leagueName, teamName } from '../data/index.js';
import { STANDINGS_LEAGUES, computeStandings, standingsCutoff } from '../core/standings.js';
import { isFinished } from '../core/engine.js';
import { bjDate } from '../core/format.js';
import { Chip, Crest, Hint, Meta } from './atoms.jsx';
import { IconClose } from './icons.jsx';

function displayRows(rows, league) {
  const out = [];
  const isUcl = league === 'UCL';
  rows.forEach((row, index) => {
    if (isUcl && row.rank === 9) {
      out.push({ type: 'group', key: 'ucl-playoff', label: '附加赛区' });
    }
    if (isUcl && row.rank === 25) {
      out.push({ type: 'group', key: 'ucl-out', label: '出局区' });
    }
    if (!isUcl && row.rank === 5) {
      out.push({ type: 'group', key: 'top-end', label: '前四参考线' });
    }
    if (!isUcl && row.zoneKey === 'bottom' && rows[index - 1]?.zoneKey !== 'bottom') {
      out.push({ type: 'group', key: 'bottom-start', label: '后三名风险区' });
    }
    out.push({ type: 'row', key: row.teamId, row });
  });
  return out;
}

function fmtGd(n) {
  const v = n || 0;
  return v > 0 ? `+${v}` : `${v}`;
}

/**
 * 完整积分榜（桌面参考视图）
 *
 * 不是第四个顶栏视图：从本场积分位置或赛程页展开，关闭后回到原上下文。
 * 本场联赛用本场截止点；切到其他联赛用当前已同步，避免无关联赛显示历史时点。
 */
export default function StandingsModal({ open, onClose, initialLeague, match, now, dataRev }) {
  const closeRef = useRef(null);
  const scrollRef = useRef(null);
  const [league, setLeague] = useState(initialLeague || 'PL');

  useEffect(() => {
    if (open) {
      setLeague(STANDINGS_LEAGUES.includes(initialLeague) ? initialLeague : 'PL');
    }
  }, [open, initialLeague]);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = e => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const activeLeague = STANDINGS_LEAGUES.includes(league) ? league : 'PL';
  const nowTs = Number.isFinite(now) ? now : Date.now();
  const isMatchLeague = !!match && match.l === activeLeague;
  const historical = isMatchLeague && isFinished(match);

  const table = useMemo(() => {
    const asOfTs = historical ? standingsCutoff(match, nowTs) : nowTs;
    return computeStandings(activeLeague, getFixtures(), { asOfTs });
  }, [activeLeague, historical, match, nowTs, dataRev]);

  // 切联赛后回到榜首，避免停在上一联赛的滚动位置
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeLeague, open]);

  if (!open) return null;

  const rows = table.rows;
  const homeRow = isMatchLeague && match ? rows.find(row => row.teamId === match.h) || null : null;
  const awayRow = isMatchLeague && match ? rows.find(row => row.teamId === match.a) || null : null;
  const focusIds = new Set(isMatchLeague && match ? [match.h, match.a] : []);
  const asOfText = historical
    ? '截至本场开球前'
    : table.lastResultAt
      ? `截至 ${bjDate(table.lastResultAt).slice(5)}`
      : '暂无赛果';
  const isUcl = activeLeague === 'UCL';
  const matchSummary =
    isMatchLeague && match
      ? `本场：${teamName(match.h)} ${homeRow ? `第${homeRow.rank}` : '暂无'} · ${teamName(match.a)} ${
          awayRow ? `第${awayRow.rank}` : '暂无'
        }`
      : null;

  return (
    <div
      className="fixed inset-0 z-modal flex animate-view-enter items-center justify-center bg-black/75 px-4 backdrop-blur-md motion-reduce:animate-none"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="standings-title"
        className="relative flex h-[86vh] max-h-[820px] w-[min(1120px,calc(100vw-48px))] animate-panel-enter flex-col overflow-hidden rounded-2xl border border-line-control bg-surface-card/95 shadow-[0_24px_70px_rgba(0,0,0,0.75)] motion-reduce:animate-none"
      >
        <div className="flex items-center justify-between border-b border-line-hairline px-5 py-3">
          <div>
            <h2 id="standings-title" className="text-sm font-semibold text-text-primary">
              积分榜
            </h2>
            <p className="mt-0.5 text-2xs text-text-faint">
              本地已同步赛果 · 同分按积分 / 净胜球 / 进球数简化排序
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭积分榜"
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="border-b border-line-hairline px-5 py-2">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="选择联赛">
            {STANDINGS_LEAGUES.map(code => {
              const active = code === activeLeague;
              return (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setLeague(code)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none ${
                    active
                      ? 'border-line-control bg-surface-raised font-semibold text-text-primary'
                      : 'border-transparent text-text-muted hover:border-line-hairline hover:bg-surface-raised hover:text-text-primary'
                  }`}
                >
                  {leagueName(code)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-5 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-medium text-text-primary">{leagueName(activeLeague)}</span>
              <Meta num>{asOfText}</Meta>
              <Meta num>{table.doneCount} 场已同步</Meta>
              <Hint
                content={`${table.tiebreakerNote} ${
                  isUcl
                    ? '各队场次可能不同；欧冠分区按赛制。'
                    : '国内前四/后三名为参考线，不代表官方资格规则。'
                } 已完赛按完赛时间截止。`}
                align="end"
              />
            </div>
            {matchSummary && <p className="mt-1 text-2xs text-text-muted">{matchSummary}</p>}
          </div>
          <p className="text-2xs text-text-faint">
            {isUcl ? '前8直通 / 9–24 附加赛 / 25–36 出局' : '前四参考线 / 后三名风险区'}
          </p>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="scrollbar-thin h-full overflow-auto border-t border-line-hairline">
            {rows.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-xs text-text-muted">
                {table.note || '本联赛暂无已同步赛果'}
              </div>
            ) : (
              <table
                key={activeLeague}
                className="w-full table-fixed animate-view-enter border-collapse text-left motion-reduce:animate-none"
                aria-label={`${leagueName(activeLeague)}积分榜`}
              >
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col />
                  <col style={{ width: 48 }} />
                  <col style={{ width: 48 }} />
                  <col style={{ width: 48 }} />
                  <col style={{ width: 48 }} />
                  <col style={{ width: 52 }} />
                  <col style={{ width: 52 }} />
                  <col style={{ width: 56 }} />
                  <col style={{ width: 52 }} />
                  <col style={{ width: 190 }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-surface-panel">
                  <tr className="border-b border-line-hairline">
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">#</th>
                    <th scope="col" className="px-2 py-2 text-left text-2xs font-medium text-text-faint">球队</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">赛</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">胜</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">平</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">负</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">进</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">失</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">净</th>
                    <th scope="col" className="px-2 py-2 text-right text-2xs font-medium text-text-faint">分</th>
                    <th scope="col" className="px-2 py-2 text-left text-2xs font-medium text-text-faint">位置</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows(rows, activeLeague).map(item => {
                    if (item.type === 'group') {
                      return (
                        <tr key={item.key}>
                          <td
                            colSpan={11}
                            className="border-t border-line-hairline bg-surface-panel px-2 py-1.5 text-2xs font-medium tracking-wide text-text-faint"
                          >
                            {item.label}
                          </td>
                        </tr>
                      );
                    }

                    const row = item.row;
                    const focused = focusIds.has(row.teamId);
                    return (
                      <tr
                        key={row.teamId}
                        data-team-id={row.teamId}
                        className={`border-t border-line-hairline/70 ${focused ? 'bg-surface-raised/70' : ''}`}
                      >
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-muted">
                          {row.rank}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Crest id={row.teamId} size={16} />
                            <span className="min-w-0 truncate text-xs text-text-primary">
                              {teamName(row.teamId)}
                            </span>
                            {focused && <Chip tone="neutral">本场</Chip>}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-secondary">{row.played}</td>
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-secondary">{row.won}</td>
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-secondary">{row.drawn}</td>
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-secondary">{row.lost}</td>
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-secondary">{row.gf}</td>
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-secondary">{row.ga}</td>
                        <td className="px-2 py-1.5 text-right font-num text-2xs tabular-nums text-text-secondary">{fmtGd(row.gd)}</td>
                        <td className="px-2 py-1.5 text-right font-num text-xs font-semibold tabular-nums text-text-primary">{row.points}</td>
                        <td className="truncate px-2 py-1.5 text-2xs text-text-muted" title={row.context?.secondary || ''}>
                          {row.context?.primary || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {rows.length > 0 && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-card via-surface-card/80 to-transparent"
              />
              <div className="pointer-events-none absolute bottom-2 right-3 text-2xs text-text-faint">
                共 {rows.length} 队 · 滚动查看
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
