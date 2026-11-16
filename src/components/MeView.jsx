import { useMemo, useState } from 'react';
import { buildSeasonReport, STAMP_META } from '../core/diary.js';
import { hm } from '../core/format.js';
import { ICS_RANGES } from '../core/ics.js';
import { queueWithMatches } from '../core/queue.js';
import {
  FOLLOWABLE_LEAGUES,
  getFixtures,
  LEAGUE_NAMES,
  leagueColor,
  leagueName,
  TEAM_MAP,
  teamName
} from '../data/index.js';
import { useBufferedRange } from '../hooks/useBufferedRange.js';
import { exportMatchesToIcs } from '../lib/export-ics.js';
import { Button, Chip, Crest, Meta, RemovableChip, Switch } from './atoms.jsx';
import { IconChevronRight } from './icons.jsx';

const NIGHT_HOURS = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

/** 紧凑胶囊单选组 */
function CompactChoiceGroup({ items, value, onChange, ariaLabel }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-line-hairline bg-surface-panel/80 p-0.5"
    >
      {items.map(it => {
        const active = it.id === value;
        return (
          <button
            key={String(it.id)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.id)}
            className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-0.5 text-2xs transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
              active
                ? 'bg-surface-raised font-semibold text-text-primary shadow-card'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 「我的看台」—— 桌面端第四主视图
 *
 * 布局遵循「1440×900 单屏齐平平衡」：
 *   · 顶部荣誉名片条：夜间人格 + 核心 4 项指标 + 局域网/赛季账单双出口；
 *   · 左栏（7 列）：明早补看台 + 观赛日记与熬夜战报 + 横向双格跨端同步与系统日历；
 *   · 右栏（5 列）：关注球队墙 & 3×2 工整联赛网格 + 作息规则与防剧透。
 * 左右两栏在标准桌面高度下自然齐底，彻底避免右栏溢出截断或左栏底部空洞。
 */
export default function MeView({
  prefs,
  onPrefsChange,
  now,
  watchLater = [],
  onRemoveWatchLater,
  onMarkWatchLaterWatched,
  onToggleWatchLater,
  onOpenMorningDigest,
  diary,
  revealed,
  onOpenSeasonReport,
  onOpenLanPair,
  onOpenSettings,
  onManageTeams,
  onOpenMatch,
  onGoTonight,
  weekIds = null,
  radarEnabled = true
}) {
  const fixtures = getFixtures();
  const patch = p => onPrefsChange({ ...prefs, ...p });
  const toggleLeague = code =>
    patch({
      followedLeagues: prefs.followedLeagues.includes(code)
        ? prefs.followedLeagues.filter(x => x !== code)
        : [...prefs.followedLeagues, code]
    });

  const budgetSlider = useBufferedRange(prefs.weeklyBudget, v => patch({ weeklyBudget: v }));
  const minuteNow = Math.floor((now || Date.now()) / 60_000) * 60_000;
  const queueEntries = useMemo(
    () =>
      queueWithMatches(watchLater, fixtures, minuteNow, { includeWatched: true }).sort((a, b) =>
        String(a.match?.t || '').localeCompare(String(b.match?.t || ''))
      ),
    [watchLater, fixtures, minuteNow]
  );
  const pendingQueue = useMemo(
    () => queueEntries.filter(entry => entry.item.status === 'pending'),
    [queueEntries]
  );
  const watchedQueue = useMemo(
    () => queueEntries.filter(entry => entry.item.status === 'watched'),
    [queueEntries]
  );

  const report = useMemo(
    () => buildSeasonReport(diary, fixtures, prefs, revealed),
    [diary, fixtures, prefs, revealed]
  );
  const maxHourBucket = Math.max(0, ...report.safeSummary.hourBuckets);
  const recentStamps = useMemo(() => {
    const entries = Object.values(diary?.entries || {});
    return entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
  }, [diary]);
  const matchMap = useMemo(() => {
    const map = {};
    for (const m of fixtures) map[m.id] = m;
    return map;
  }, [fixtures]);

  const leagueCount = prefs.followedLeagues.length;
  const bonusActive = leagueCount > 0 && leagueCount < 6;

  // 日历导出（.ics）
  const [icsRange, setIcsRange] = useState('week');
  const [icsRemind, setIcsRemind] = useState(30);
  const [icsMsg, setIcsMsg] = useState(null);

  const exportIcs = () => {
    setIcsMsg(null);
    try {
      const count = exportMatchesToIcs({
        fixtures,
        range: icsRange,
        reminderMinutes: icsRemind,
        followedTeams: prefs.followedTeams,
        weekIds,
        nowTs: Date.now()
      });
      setIcsMsg({ ok: true, text: `已导出 ${count} 场` });
    } catch (err) {
      setIcsMsg({ ok: false, text: err?.message || '导出失败' });
    }
  };

  return (
    <section
      aria-label="我的看台"
      className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-bg-app p-4 lg:p-5"
    >
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
        {/* 顶部个人看台荣誉名片 */}
        <header className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-line-hairline bg-surface-panel px-5 py-3.5 shadow-card lg:flex-row lg:items-center lg:justify-between">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent/60 via-accent/20 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-12 -top-16 h-36 w-36 rounded-full bg-accent/[0.06] blur-3xl"
          />

          <div className="relative min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-headline text-lg font-bold tracking-tight text-text-primary">
                我的看台
              </h2>
              <Chip tone="accent">{report.persona.title}</Chip>
              <Meta className="leading-normal">{report.persona.detail}</Meta>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
              <span className="font-num tabular-nums">
                关注球队 <strong className="font-semibold text-text-primary">{prefs.followedTeams.length}</strong> 支
              </span>
              <span className="text-line-control" aria-hidden="true">·</span>
              <span className="font-num tabular-nums">
                偏好联赛 <strong className="font-semibold text-text-primary">{leagueCount}</strong> 个
                {bonusActive ? <span className="ml-1 text-2xs text-resource">(+8 生效)</span> : ''}
              </span>
              <span className="text-line-control" aria-hidden="true">·</span>
              <span className="font-num tabular-nums">
                每周额度 <strong className="font-semibold text-resource">{prefs.weeklyBudget.toFixed(1)}h</strong>
              </span>
              <span className="text-line-control" aria-hidden="true">·</span>
              <span className="font-num tabular-nums">
                睡眠底线{' '}
                <strong className="font-semibold text-text-primary">
                  {prefs.sleepEnabled
                    ? `${prefs.sleepWakeTime || '07:30'} 起 · ${Number(prefs.sleepMinHours ?? 7).toFixed(1)}h`
                    : '未启用'}
                </strong>
              </span>
            </div>
          </div>

          <div className="relative flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="default" size="sm" onClick={onOpenLanPair}>
              局域网同步 / 接力
            </Button>
            <Button variant="default" size="sm" onClick={onOpenSeasonReport}>
              完整赛季账单
            </Button>
          </div>
        </header>

        {/* 双栏平衡工作台 */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* 左主栏（7 列）：明早补看台 + 观赛日记战报 + 横向双格同步与日历 */}
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
            {/* 1. 明早补看台 */}
            <section
              aria-labelledby="me-watchlater-title"
              className="rounded-2xl border border-line-hairline bg-surface-panel p-4 shadow-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h3 id="me-watchlater-title" className="text-sm font-semibold text-text-primary">
                    明早补看台
                  </h3>
                  <Meta num>
                    {pendingQueue.length} 场待看
                    {watchedQueue.length > 0 ? ` · ${watchedQueue.length} 场已看` : ''}
                  </Meta>
                </div>
                {queueEntries.length > 0 && onOpenMorningDigest && (
                  <Button variant="primary" size="xs" onClick={onOpenMorningDigest}>
                    开始晨间摘要连看
                  </Button>
                )}
              </div>

              {queueEntries.length === 0 ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-hairline bg-surface-card/35 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-text-secondary">还没有加入补看的比赛</p>
                    <Meta className="mt-0.5 block">
                      熬夜代价太高时在赛前详情点「加入补看」，第二天无剧透一口气补完（最多 10 条 · 7 天过期）。
                    </Meta>
                  </div>
                  {onGoTonight && (
                    <Button variant="default" size="xs" onClick={onGoTonight}>
                      去今晚选场
                    </Button>
                  )}
                </div>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {pendingQueue.length === 0 ? (
                    <p className="rounded-xl border border-line-hairline bg-surface-card/35 px-3.5 py-2.5 text-2xs text-text-muted">
                      待看已全部消化，已看过的场次保留在下方。
                    </p>
                  ) : (
                    <div className="divide-y divide-line-hairline overflow-hidden rounded-xl border border-line-hairline bg-surface-card/45">
                      {pendingQueue.map(({ item, match }) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 px-3.5 py-2 transition-colors hover:bg-surface-raised/45"
                        >
                          <button
                            type="button"
                            disabled={!match}
                            onClick={() => match && onOpenMatch?.(match.id)}
                            className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default"
                          >
                            {match && (
                              <span className="flex shrink-0 items-center -space-x-1">
                                <Crest id={match.h} size={20} />
                                <Crest id={match.a} size={20} />
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1 text-xs font-semibold text-text-primary transition-colors group-hover:text-accent">
                                <span className="truncate">
                                  {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                                </span>
                                {match && (
                                  <IconChevronRight
                                    size={12}
                                    className="shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
                                  />
                                )}
                              </span>
                              <Meta className="mt-0.5 block">
                                {match
                                  ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)}`
                                  : item.id}
                              </Meta>
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {match && onMarkWatchLaterWatched && (
                              <Button variant="ghost" size="xs" onClick={() => onMarkWatchLaterWatched(item.id)}>
                                已看
                              </Button>
                            )}
                            {onRemoveWatchLater && (
                              <Button variant="text" size="xs" onClick={() => onRemoveWatchLater(item.id)}>
                                移除
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {watchedQueue.length > 0 && (
                    <div>
                      <Meta className="mb-1 block">已看过 ({watchedQueue.length})</Meta>
                      <div className="divide-y divide-line-hairline/75 overflow-hidden rounded-xl border border-line-hairline/75 bg-surface-card/25">
                        {watchedQueue.map(({ item, match }) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 px-3.5 py-2 transition-colors hover:bg-surface-raised/35"
                          >
                            <button
                              type="button"
                              disabled={!match}
                              onClick={() => match && onOpenMatch?.(match.id)}
                              className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
                            >
                              <span className="block truncate text-xs text-text-secondary hover:text-text-primary">
                                {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                              </span>
                              <Meta>
                                {match
                                  ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)} · 已看过`
                                  : `${item.id} · 已看过`}
                              </Meta>
                            </button>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {match && onToggleWatchLater && (
                                <Button variant="ghost" size="xs" onClick={() => onToggleWatchLater(match)}>
                                  重新补看
                                </Button>
                              )}
                              {onRemoveWatchLater && (
                                <Button variant="text" size="xs" onClick={() => onRemoveWatchLater(item.id)}>
                                  移除
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 2. 观赛日记与熬夜战报 */}
            <section
              aria-labelledby="me-diary-title"
              className="rounded-2xl border border-line-hairline bg-surface-panel p-4 shadow-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 id="me-diary-title" className="text-sm font-semibold text-text-primary">
                    观赛日记与熬夜战报
                  </h3>
                  <Meta className="mt-0.5 block">
                    未揭晓场次仅记出勤时长，严格隔离比分与口碑。
                  </Meta>
                </div>
                {report.outcomeSummary.maskedBySpoilerCount > 0 && (
                  <Chip tone="neutral">
                    已隔离 {report.outcomeSummary.maskedBySpoilerCount} 场未揭晓
                  </Chip>
                )}
              </div>

              {/* 4 格统计条 */}
              <div className="mt-3 grid grid-cols-2 divide-y divide-line-hairline overflow-hidden rounded-xl border border-line-hairline bg-surface-card/45 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                <div className="px-3.5 py-2.5">
                  <Meta>累计盖章</Meta>
                  <div className="mt-1 font-num text-xl font-bold leading-none tabular-nums text-text-primary">
                    {report.safeSummary.totalWatched}
                  </div>
                </div>
                <div className="px-3.5 py-2.5">
                  <Meta>S3/S4 守夜</Meta>
                  <div className="mt-1 font-num text-xl font-bold leading-none tabular-nums text-text-primary">
                    {report.safeSummary.lateNightCount}
                  </div>
                </div>
                <div className="px-3.5 py-2.5">
                  <Meta>血赚名局</Meta>
                  <div className="mt-1 font-num text-xl font-bold leading-none tabular-nums text-text-primary">
                    {report.outcomeSummary.worthItCount}
                  </div>
                </div>
                <div className="px-3.5 py-2.5">
                  <Meta>0-0 催眠</Meta>
                  <div className="mt-1 font-num text-xl font-bold leading-none tabular-nums text-text-primary">
                    {report.outcomeSummary.dullDrawCount}
                  </div>
                </div>
              </div>

              {/* 夜间时段热力：轻基线柱图，避免空槽变成 10 个黑块 */}
              <div className="mt-3 rounded-xl border border-line-hairline bg-surface-card/35 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Meta>熬夜出勤时段热力（北京时间）</Meta>
                  <Meta num>20:00 – 05:00</Meta>
                </div>
                {maxHourBucket === 0 ? (
                  <div className="mt-2.5 flex h-[62px] items-center justify-center rounded-lg border border-dashed border-line-hairline">
                    <Meta>还没有熬夜出勤记录 · 盖下第一枚印章后自动点亮</Meta>
                  </div>
                ) : (
                  <div className="mt-2.5 grid grid-cols-10 gap-2">
                    {NIGHT_HOURS.map(hr => {
                      const count = report.safeSummary.hourBuckets[hr] || 0;
                      const pct = count > 0 ? Math.max(20, Math.round((count / maxHourBucket) * 100)) : 0;
                      return (
                        <div key={hr} className="flex flex-col items-center gap-1.5">
                          <div
                            className="flex h-11 w-full items-end border-b border-line-control/70 px-0.5 pb-px"
                            title={`${String(hr).padStart(2, '0')}:00 · ${count} 场`}
                          >
                            {count > 0 ? (
                              <div
                                className="w-full rounded-t-sm bg-gradient-to-t from-accent/70 to-accent transition-all"
                                style={{ height: `${pct}%` }}
                              />
                            ) : (
                              <div className="h-[2px] w-full rounded-full bg-line-control/60" />
                            )}
                          </div>
                          <span className="font-num text-2xs leading-none tabular-nums text-text-faint">
                            {String(hr).padStart(2, '0')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {recentStamps.length > 0 ? (
                <div className="mt-3">
                  <Meta className="mb-1.5 block">最近盖章记录</Meta>
                  <div className="divide-y divide-line-hairline overflow-hidden rounded-xl border border-line-hairline bg-surface-card/45">
                    {recentStamps.map(e => {
                      const m = matchMap[e.matchId];
                      const meta = STAMP_META[e.stamp];
                      return (
                        <button
                          key={e.matchId}
                          type="button"
                          onClick={() => m && onOpenMatch?.(m.id)}
                          disabled={!m}
                          className="flex w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-left text-xs transition-colors hover:bg-surface-raised/45 disabled:cursor-default"
                        >
                          <span className="min-w-0 truncate text-text-primary">
                            {m ? `${teamName(m.h)} vs ${teamName(m.a)}` : e.matchId}
                            {e.note ? <span className="text-text-muted"> · “{e.note}”</span> : ''}
                          </span>
                          <span className="shrink-0 font-num text-2xs text-accent">
                            {meta?.glyph} {meta?.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <Meta className="mt-2.5 block px-0.5">
                  提示：比赛结束后在右侧情报面板底部盖一枚情绪印章，即可自动点亮战报统计。
                </Meta>
              )}
            </section>

            {/* 3. 跨端同步与系统日历：占足左栏宽度横排两格，紧凑平衡 */}
            <section
              aria-labelledby="me-connect-title"
              className="rounded-2xl border border-line-hairline bg-surface-panel p-4 shadow-card"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 id="me-connect-title" className="text-sm font-semibold text-text-primary">
                  跨端同步与系统日历
                </h3>
                <Meta>零云端本地传输</Meta>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3.5 md:grid-cols-12 md:gap-0">
                <div className="flex flex-col justify-between gap-2.5 md:col-span-5 md:border-r md:border-line-hairline md:pr-4">
                  <div>
                    <p className="text-xs font-medium text-text-primary">局域网一扫同步</p>
                    <Meta className="mt-1 block leading-relaxed">
                      开启 120 秒临时端口，与手机双向合并关注球队、补看清单与印章。
                    </Meta>
                  </div>
                  <div>
                    <Button variant="ghost" size="xs" onClick={onOpenLanPair}>
                      生成同步码
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 md:col-span-7 md:pl-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary">日历导出 (.ics)</span>
                    <Meta>只导已定档未开赛</Meta>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-2xs text-text-muted">范围</span>
                    <CompactChoiceGroup
                      ariaLabel="日历导出范围"
                      items={ICS_RANGES.map(r => ({ id: r.id, label: r.label }))}
                      value={icsRange}
                      onChange={setIcsRange}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-2xs text-text-muted">提醒</span>
                    <CompactChoiceGroup
                      ariaLabel="日历提醒时间"
                      items={[
                        { id: 0, label: '不提醒' },
                        { id: 15, label: '提前 15m' },
                        { id: 30, label: '提前 30m' }
                      ]}
                      value={icsRemind}
                      onChange={setIcsRemind}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className={`truncate text-2xs ${icsMsg ? (icsMsg.ok ? 'text-resource' : 'text-warn') : 'text-text-faint'}`}>
                      {icsMsg ? icsMsg.text : '支持 Apple / Google / Outlook'}
                    </span>
                    <Button variant="default" size="xs" onClick={exportIcs}>
                      导出 .ics 文件
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* 右辅栏（5 列）：关注球队与联赛 + 作息规则与防剧透 */}
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
            {/* 4. 关注球队与联赛 */}
            <section
              id="me-teams-card"
              aria-labelledby="me-teams-title"
              className="rounded-2xl border border-line-hairline bg-surface-panel p-4 shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 id="me-teams-title" className="text-sm font-semibold text-text-primary">
                    关注球队与联赛
                  </h3>
                  <Meta className="mt-0.5 block">决定今晚高优推荐与本周预算内必保场次</Meta>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {prefs.followedTeams.length > 0 && (
                    <>
                      <Button variant="text" size="xs" onClick={() => patch({ followedTeams: [] })}>
                        清空
                      </Button>
                      <Button variant="default" size="xs" onClick={() => onManageTeams?.()}>
                        管理球队
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-3">
                {prefs.followedTeams.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {prefs.followedTeams.map(id => (
                      <RemovableChip
                        key={id}
                        leading={<Crest id={id} size={16} />}
                        onRemove={() =>
                          patch({ followedTeams: prefs.followedTeams.filter(x => x !== id) })
                        }
                      >
                        {TEAM_MAP[id]?.zh || id}
                      </RemovableChip>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line-hairline bg-surface-card/35 px-3.5 py-2.5">
                    <span className="text-2xs text-text-muted">暂未关注主队，挑选后高优呈现</span>
                    <Button variant="ghost" size="xs" onClick={() => onManageTeams?.()}>
                      挑选主队
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-line-hairline pt-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-primary">关注联赛（+8 指数偏好）</span>
                  <Chip tone={bonusActive ? 'resource' : 'neutral'}>
                    {bonusActive ? '+8 生效' : leagueCount === 0 ? '未选择' : '全选 · +0'}
                  </Chip>
                </div>

                {/* 3×2 工整栅格，替代参差不齐的折行胶囊 */}
                <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                  {FOLLOWABLE_LEAGUES.map(code => {
                    const on = prefs.followedLeagues.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleLeague(code)}
                        className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                          on
                            ? 'border-accent/40 bg-accent/12 font-semibold text-accent'
                            : 'border-line-hairline bg-surface-card/55 text-text-secondary hover:border-line-control hover:text-text-primary'
                        }`}
                      >
                        <span
                          className="h-2.5 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: leagueColor(code) }}
                          aria-hidden="true"
                        />
                        <span>{LEAGUE_NAMES[code]}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <Meta>选少于 6 个时生效，全选 6 个等于无偏好</Meta>
                  <button
                    type="button"
                    onClick={() => patch({ followedLeagues: [...FOLLOWABLE_LEAGUES] })}
                    className="shrink-0 text-2xs text-text-faint hover:text-text-secondary hover:underline"
                  >
                    全选
                  </button>
                </div>
              </div>
            </section>

            {/* 5. 作息规则与防剧透 */}
            <section
              aria-labelledby="me-rules-title"
              className="rounded-2xl border border-line-hairline bg-surface-panel p-4 shadow-card"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 id="me-rules-title" className="text-sm font-semibold text-text-primary">
                  作息规则与防剧透
                </h3>
                <button
                  type="button"
                  onClick={() => onOpenSettings?.('rules')}
                  className="shrink-0 text-2xs font-medium text-accent transition-colors hover:underline"
                >
                  精细时间与提醒 →
                </button>
              </div>

              <div className="mt-3 divide-y divide-line-hairline overflow-hidden rounded-xl border border-line-hairline bg-surface-card/45">
                <div className="px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary">每周熬夜额度</span>
                    <span className="font-num text-sm font-semibold tabular-nums text-resource">
                      {budgetSlider.value.toFixed(1)} 小时
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="0.5"
                    value={budgetSlider.value}
                    onChange={e => budgetSlider.onChange(Number(e.target.value))}
                    onPointerUp={budgetSlider.commit}
                    onKeyUp={budgetSlider.commit}
                    onBlur={budgetSlider.commit}
                    className="mt-2 w-full accent-resource"
                    aria-label="每周熬夜额度"
                  />
                  <div className="mt-1 flex items-center justify-between font-num text-2xs tabular-nums text-text-faint">
                    <span>0h</span>
                    <span>零成本（傍晚）场次不占额度</span>
                    <span>8h</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text-primary">防剧透模式</p>
                    <Meta className="mt-0.5 block">已完赛比分默认隐藏，点按「揭晓」后展示</Meta>
                  </div>
                  <Switch
                    on={prefs.spoilerFree}
                    onChange={v => patch({ spoilerFree: v })}
                    label="防剧透模式"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text-primary">个人睡眠账本</p>
                    <Meta className="mt-0.5 block">
                      {prefs.sleepEnabled
                        ? `平日 ${prefs.sleepWakeTime || '07:30'} 起 · 底线 ${Number(prefs.sleepMinHours ?? 7).toFixed(1)}h${
                            prefs.sleepWeekendEnabled !== false
                              ? ` · 周末 ${prefs.sleepWeekendWakeTime || '09:00'}`
                              : ''
                          }`
                        : '按个人作息计算剩余睡眠与止损提醒'}
                    </Meta>
                  </div>
                  <Switch
                    on={prefs.sleepEnabled}
                    onChange={v => patch({ sleepEnabled: v })}
                    label="个人睡眠账本"
                  />
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-0.5 text-2xs text-text-muted">
                <span>
                  提醒：赛前 15m {prefs.notifyBefore15 ? '开' : '关'} · 实时事件{' '}
                  {prefs.notifyLiveEvents ? '开' : '关'} · 悬念雷达 {radarEnabled ? '开' : '关'}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenSettings?.('rules')}
                  className="shrink-0 text-text-secondary transition-colors hover:text-accent hover:underline"
                >
                  修改
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
