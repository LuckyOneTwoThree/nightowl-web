import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus.js';
import { getFixtures, FOLLOWABLE_LEAGUES, LEAGUE_NAMES, leagueColor, leagueName, teamName } from '../data/index.js';
import { defaultPrefs } from '../core/prefs.js';
import { queueWithMatches } from '../core/queue.js';
import { requestScoreSync, SYNC_STATUS_BUSY } from '../api/score-sync.js';
import { clearLineMemory, loadLineMemory } from './line-memory-storage.js';
import { buildIcs, selectIcsMatches, ICS_RANGES } from '../core/ics.js';
import { mondayOfWall, nightOf } from '../core/engine.js';
import { BrandLogo, Button, Chip, Fieldset, Hint, Meta, Segmented, Switch, TogglePill } from './atoms.jsx';
import { hm } from '../core/format.js';
import { IconClose, IconReset } from './icons.jsx';
import TeamPicker from './TeamPicker.jsx';

/**
 * 设置抽屉（右侧滑出，480px）
 *
 * D6 关键点：**关注联赛是算法偏好**（影响 +8 加成），与赛程列表的**筛选药丸语义不同**。
 * 前者必须放在这里，不得与筛选器混排 —— 否则开发极易当成同一件事。
 *
 * P2 改造点：算法口径的长段说明从常驻版面收进 Hint。它是「想知道才查」的规则，
 * 不是每次打开设置都要重读一遍的决策信息；常驻时它把真正要点的东西挤到了折叠线以下。
 */
const LEAGUE_RULE =
  '关注联赛会给该联赛的场次 +8 夜猫指数。仅当已选少于 6 个时生效 —— 全选等于没有偏好，加成为 0。';

const FOLLOWED_TEAM_RULE =
  '主队与客队任一方命中即视为「主队出战」：进入今晚之选的高优先区，并在背包规划里预算内必保。';

const SERVICE_RULE =
  '本机单机产品：赛程与算法只读本地快照，不联网也能完整使用；直播代理与比分保鲜需要本地服务在跑。';

export default function SettingsDrawer({
  open,
  prefs,
  onPrefsChange,
  onClose,
  onRerunOnboarding,
  onReplaySplash,
  onDataRefresh,
  updateState,
  onOpenUpdateModal,
  watchLater = [],
  onRemoveWatchLater,
  onMarkWatchLaterWatched,
  onToggleWatchLater,
  onOpenMorningDigest,
  weekIds = null,
  desktopSettings = null,
  onDesktopSettingsChange
}) {
  const leagueCount = prefs.followedLeagues.length;
  const bonusActive = leagueCount > 0 && leagueCount < 6;
  const closeBtnRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // 抽屉关闭后不保留二次确认态，避免下次打开时一直停在「确认恢复？」。
  useEffect(() => {
    if (!open) setConfirmReset(false);
  }, [open]);

  // 焦点进场与归还统一由 hook 处理：背景已 inert，焦点不送进来键盘用户就失去可见焦点；
  // 关闭后不还回去，焦点会掉到 body 顶部。
  useDialogFocus(open, closeBtnRef);

  const { health, refresh } = useServiceHealth(open);

  /* ---- 数据新鲜度与一键同步 ----
     快照是构建期内联的，桌面端同步后写在 userData；这里负责显示陈旧程度并触发同步。 */
  const [fresh, setFresh] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  /**
   * 抽屉内的「X 分钟前」需要一个会走的时钟。
   *
   * 旧实现把 Date.now() 直接写在 useMemo 里却只依赖 [lastSync]，于是抽屉开着
   * 不动 20 分钟，仍然显示「刚刚」—— 数据新鲜度是这款产品的核心可信度指标，
   * 却在这里持续说谎。只跟着 minuteKey 重渲染也不够：useMemo 的依赖没变就不会重算。
   */
  const [nowTs, setNowTs] = useState(() => Date.now());
  /** 上次拉到 freshness 的时刻：staleHours 是服务端按请求时刻算的，要按它向后推算 */
  const [freshAt, setFreshAt] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    setNowTs(Date.now());
    const timer = setInterval(() => setNowTs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [open]);

  const loadFreshness = useCallback(async () => {
    try {
      const r = await fetch('/api/scores/status');
      if (!r.ok) return;
      const j = await r.json();
      setFresh(j?.freshness || null);
      setLastSync(j?.lastSync || null);
      setFreshAt(Date.now());
    } catch {
      setFresh(null);
      setLastSync(null);
      setFreshAt(0);
    }
  }, []);

  useEffect(() => {
    if (open) loadFreshness();
  }, [open, loadFreshness]);

  // 线路成功率记忆：只在打开抽屉时统计条数（真正的排序在播放舞台里）
  const [lineMemCount, setLineMemCount] = useState(0);
  useEffect(() => {
    if (!open) return;
    setLineMemCount(Object.keys(loadLineMemory()).length);
  }, [open]);

  /* ---- 日历导出（FR-09）---- */
  const [icsRange, setIcsRange] = useState('tonight');
  const [icsRemind, setIcsRemind] = useState(30);
  const [icsMsg, setIcsMsg] = useState(null);
  useEffect(() => {
    if (!open) setIcsMsg(null);
  }, [open]);

  const exportIcs = () => {
    setIcsMsg(null);
    const now = Date.now();
    try {
      const matches = selectIcsMatches(getFixtures(), {
        range: icsRange,
        nowTs: now,
        weekStartStr: icsRange === 'week' ? mondayOfWall(nightOf(now)) : null,
        followedTeams: prefs.followedTeams,
        weekIds: icsRange === 'week' ? weekIds : null
      });
      const ics = buildIcs({ matches, reminderMinutes: icsRemind, now });
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const label = ICS_RANGES.find(r => r.id === icsRange)?.label || '导出';
      const stamp = new Date(now).toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `夜猫看台-${label}-${stamp}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 立刻 revoke 会让部分浏览器拿不到内容，延迟释放
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setIcsMsg({ ok: true, text: `已导出 ${matches.length} 场` });
    } catch (err) {
      setIcsMsg({ ok: false, text: err?.message || '导出失败' });
    }
  };

  // Escape 关闭已上收到 App 的浮层栈统一派发（一次 Esc 只关最上层，
  // 修复「设置 + 更新弹窗叠加时一次 Esc 连关两层」）；这里不再各自监听。

  const runSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const outcome = await requestScoreSync({ apply: true });

      // 409 此前在这里被报成「同步失败」，而同一动作在 App 里会耐心等待 ——
      // 同一个「同步」在两处给出相反结论。现在统一语义：忙不是错。
      if (outcome.status === SYNC_STATUS_BUSY) {
        setSyncMsg({ ok: true, text: '已有同步任务在进行中，稍后自动更新' });
        await loadFreshness();
        refresh();
        return;
      }

      setSyncMsg({ ok: outcome.ok, degraded: !!outcome.degraded, text: outcome.text });
      // 只有真正写盘成功才替换内存快照；失败时仍刷新状态，让用户看到失败原因
      if (outcome.ok && (outcome.status === 'updated' || outcome.status === 'partial_failure')) {
        await onDataRefresh?.();
      }
      await loadFreshness();
      refresh();
    } catch (err) {
      setSyncMsg({ ok: false, text: err?.message || '同步失败' });
    } finally {
      setSyncing(false);
    }
  };

  const freshText = useMemo(() => {
    // 用「完赛时间」而不是「开球时间」：后者会把最新赛果的年龄高估一场比赛的时长。
    const endAt = fresh?.lastScoreEndAt || fresh?.lastScoreAt;
    if (!endAt) return '暂无已录比分';
    // staleHours 是服务端在 freshAt 那一刻算的，抽屉开着要往后推算，否则永远不动
    const elapsed = freshAt && nowTs > freshAt ? (nowTs - freshAt) / 3600000 : 0;
    const h = (fresh.staleHours ?? 0) + elapsed;
    if (h < 1) return '刚刚';
    if (h < 24) return `${h.toFixed(1)} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  }, [fresh, freshAt, nowTs]);

  const pendingSplit = useMemo(() => {
    const stale = Number(fresh?.stalePendingCount || 0);
    return { recent: Math.max(0, Number(fresh?.pendingCount || 0) - stale), stale };
  }, [fresh]);

  const syncText = useMemo(() => {
    if (!lastSync?.at) return '本次启动后未同步';
    const t = Date.parse(lastSync.at);
    if (!Number.isFinite(t)) return '时间未知';
    // nowTs 必须进依赖（见上面的注释）：抽屉开着不动也要继续走字
    const h = (nowTs - t) / 3600000;
    if (h < 1 / 60) return '刚刚';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟前`;
    if (h < 24) return `${h.toFixed(1)} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  }, [lastSync, nowTs]);
  // ⚠️ 不能用模块级 import { fixtures }：setFixtures 换的是 data/index.js 内部的
  // _fixtures，那个绑定永远停在构建期快照。这里取 getFixtures()，并在新鲜度
  // 刷新后（抽屉打开 / 同步完成）重算，保证与列表的「命中 N 场」口径一致。
  // biome-ignore lint/correctness/useExhaustiveDependencies: fresh 是「数据已刷新」的触发器；body 读 getFixtures()
  const snapshotInfo = useMemo(() => {
    const list = getFixtures();
    const days = list.map(m => m.t.slice(0, 10)).sort();
    return {
      count: list.length.toLocaleString(),
      range: days.length ? `${days[0]} ~ ${days[days.length - 1]}` : '—'
    };
  }, [fresh]);

  const patch = p => onPrefsChange({ ...prefs, ...p });
  const toggleLeague = code =>
    patch({
      followedLeagues: prefs.followedLeagues.includes(code)
        ? prefs.followedLeagues.filter(x => x !== code)
        : [...prefs.followedLeagues, code]
    });

  const revokeSession = async () => {
    try {
      await fetch('/api/proxy/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
    } finally {
      refresh();
    }
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-scrim bg-black/60 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden="true"
      />

      {/* 抽屉 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={`fixed right-0 top-0 z-drawer flex h-full w-[480px] flex-col border-l border-line-hairline bg-surface-panel shadow-pop transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
        // 关闭只是视觉上移出视野，DOM 仍在 —— 内部按钮/滑杆仍在 Tab 序列里，
        // aria-hidden 对可聚焦内容无效（a11y 违规）。inert 把整块移出焦点与点击。
        inert={!open}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line-hairline px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <BrandLogo size={24} rounded="md" />
            <div>
              <h2 id="settings-title" className="font-headline text-base font-semibold text-text-primary">
                偏好与数据
              </h2>
              <Meta className="mt-0.5 block">决定推荐排序与背包规划的输入</Meta>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
          >
            <IconClose size={14} />
          </button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 关注球队 */}
          <Fieldset
            title="关注球队"
            hint={FOLLOWED_TEAM_RULE}
            right={
              prefs.followedTeams.length > 0 ? (
                <button
                  type="button"
                  onClick={() => patch({ followedTeams: [] })}
                  className="text-2xs text-text-faint transition-colors hover:text-text-primary"
                >
                  清空
                </button>
              ) : null
            }
          >
            <TeamPicker
              selected={prefs.followedTeams}
              onChange={v => patch({ followedTeams: v })}
              gridClass="grid-cols-5"
              listClass="max-h-64"
            />
          </Fieldset>

          {/* 关注联赛（算法偏好，不是筛选） */}
          <Fieldset
            title="关注联赛"
            hint={LEAGUE_RULE}
            right={
              <Chip tone={bonusActive ? 'resource' : 'neutral'}>
                {bonusActive ? '+8 生效' : leagueCount === 0 ? '未选择' : '全选 · +0'}
              </Chip>
            }
          >
            <div className="flex flex-wrap gap-1">
              {FOLLOWABLE_LEAGUES.map(code => (
                <TogglePill
                  key={code}
                  on={prefs.followedLeagues.includes(code)}
                  onClick={() => toggleLeague(code)}
                  label={LEAGUE_NAMES[code]}
                  color={leagueColor(code)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => patch({ followedLeagues: [...FOLLOWABLE_LEAGUES] })}
              className="mt-1.5 text-2xs text-text-faint underline-offset-2 hover:text-text-secondary hover:underline"
            >
              全选
            </button>
          </Fieldset>

          {/* 睡眠成本与防剧透 */}
          <Fieldset title="熬夜额度与观赛规则">
            <div className="rounded-lg border border-line-hairline bg-surface-card px-3 py-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-text-secondary">每周额度</span>
                <span className="font-num text-sm font-semibold tabular-nums text-resource">
                  {prefs.weeklyBudget.toFixed(1)} 小时
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="8"
                step="0.5"
                value={prefs.weeklyBudget}
                onChange={e => patch({ weeklyBudget: Number(e.target.value) })}
                className="mt-2 w-full accent-resource"
                aria-label="每周熬夜额度"
              />
              <Meta className="mt-1 block">只约束熬夜场次；零成本（傍晚）场次不占额度。</Meta>
            </div>

            <div className="mt-2 space-y-1.5">
              <SwitchRow
                label="已赛场次默认隐藏比分"
                hint="防剧透：列表与情报面板都只给「揭晓」入口，点开才显示比分。"
                on={prefs.spoilerFree}
                onChange={v => patch({ spoilerFree: v })}
              />
            </div>
          </Fieldset>

          <Fieldset title="个人睡眠" hint="按自己的起床时间估算看完比赛后的剩余睡眠；支持区分工作日与周末（周五/六夜）起床时间。">
            <SwitchRow
              label="启用睡眠账本"
              hint="启用后 Hero、周规划与比赛详情会显示个人剩余睡眠；低于底线会明确提示。"
              on={prefs.sleepEnabled}
              onChange={v => patch({ sleepEnabled: v })}
            />
            {prefs.sleepEnabled && (
              <div className="mt-2 space-y-2 rounded-lg border border-line-hairline bg-surface-card px-3 py-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-2xs text-text-muted">
                    工作日起床
                    <input
                      type="time"
                      value={prefs.sleepWakeTime || '07:30'}
                      onChange={e => patch({ sleepWakeTime: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-line-control bg-surface-panel px-2 py-1 font-num text-xs text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
                      aria-label="起床时间"
                    />
                  </label>
                  <label className="text-2xs text-text-muted">
                    最低睡眠
                    <span className="ml-1 font-num text-text-primary">{Number(prefs.sleepMinHours ?? 7).toFixed(1)}h</span>
                    <input
                      type="range"
                      min="4"
                      max="10"
                      step="0.5"
                      value={prefs.sleepMinHours ?? 7}
                      onChange={e => patch({ sleepMinHours: Number(e.target.value) })}
                      className="mt-2 w-full accent-accent"
                      aria-label="最低睡眠小时数"
                    />
                  </label>
                </div>

                <div className="border-t border-line-hairline pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-2xs text-text-secondary">周五 / 周六夜（次日周末）晚起</span>
                    <Switch
                      on={prefs.sleepWeekendEnabled !== false}
                      onChange={v => patch({ sleepWeekendEnabled: v })}
                      label="周五/周六夜晚起"
                    />
                  </div>
                  {prefs.sleepWeekendEnabled !== false && (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {['08:30', '09:00', '09:30', '10:00'].map(t => {
                          const active = (prefs.sleepWeekendWakeTime || '09:00') === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => patch({ sleepWeekendWakeTime: t })}
                              className={`rounded px-1.5 py-0.5 font-num text-2xs tabular-nums transition-colors cursor-pointer ${
                                active
                                  ? 'bg-accent/20 text-accent font-medium'
                                  : 'bg-surface-panel text-text-muted hover:text-text-primary'
                              }`}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                      <input
                        type="time"
                        value={prefs.sleepWeekendWakeTime || '09:00'}
                        onChange={e => patch({ sleepWeekendWakeTime: e.target.value })}
                        className="w-24 rounded-md border border-line-control bg-surface-panel px-2 py-0.5 font-num text-xs text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
                        aria-label="周末起床时间"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </Fieldset>

          <Fieldset title="明早补看" hint="只保存比赛 ID 与状态，不保存比分；最多 10 条，7 天过期。">
            {(() => {
              // 用 nowTs 而不是 Date.now()：抽屉开着不动时，7 天过期的条目
              // 也该在下一个 30s tick 里消失，而不是等某次偶然重渲染。
              const entries = queueWithMatches(watchLater, getFixtures(), nowTs, { includeWatched: true })
                .sort((a, b) => String(a.match?.t || '').localeCompare(String(b.match?.t || '')));
              const pending = entries.filter(({ item }) => item.status === 'pending');
              const watched = entries.filter(({ item }) => item.status === 'watched');
              if (!entries.length) {
                return <Meta>还没有加入补看。可在比赛情报里点「明早补看」。</Meta>;
              }
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 px-0.5">
                    <Meta>
                      {pending.length} 场待看
                      {watched.length > 0 ? ` · ${watched.length} 场已看` : ''}
                      {pending[0]?.match && !pending[0].match.tbd
                        ? ` · 最早 ${hm(pending[0].match.t)}`
                        : ''}
                    </Meta>
                    {onOpenMorningDigest && (
                      <Button variant="ghost" size="xs" onClick={onOpenMorningDigest}>
                        看摘要
                      </Button>
                    )}
                  </div>
                  {pending.length === 0 ? (
                    <Meta>待看已清空，已看过的场次仍在下面。</Meta>
                  ) : null}
                  {pending.map(({ item, match }) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-card px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-text-primary">
                          {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                        </p>
                        <Meta className="mt-0.5">
                          {match
                            ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)}`
                            : item.id}
                        </Meta>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {match && onMarkWatchLaterWatched && (
                          <Button variant="ghost" size="xs" onClick={() => onMarkWatchLaterWatched(item.id)}>
                            已看
                          </Button>
                        )}
                        {onRemoveWatchLater && (
                          <Button variant="ghost" size="xs" onClick={() => onRemoveWatchLater(item.id)}>
                            移除
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {watched.length > 0 ? (
                    <>
                      <Meta className="pt-1">已看过</Meta>
                      {watched.map(({ item, match }) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-card px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-text-primary">
                              {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                            </p>
                            <Meta className="mt-0.5">
                              {match
                                ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)} · 已看过`
                                : `${item.id} · 已看过`}
                            </Meta>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {match && onToggleWatchLater && (
                              <Button variant="ghost" size="xs" onClick={() => onToggleWatchLater(match)}>
                                重新补看
                              </Button>
                            )}
                            {onRemoveWatchLater && (
                              <Button variant="ghost" size="xs" onClick={() => onRemoveWatchLater(item.id)}>
                                移除
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>
              );
            })()}
          </Fieldset>

          {/* 通知：偏好早就在，v0.1.24 真正接上系统通知 */}
          <Fieldset title="提醒" hint="通知仅在应用运行时生效；点击通知会回到对应比赛。">
            <div className="space-y-1.5">
              <SwitchRow
                label="赛前 15 分钟提醒"
                hint="只提醒关注球队和今晚之选；窗口在前台也会提示。"
                on={prefs.notifyBefore15}
                onChange={v => patch({ notifyBefore15: v })}
              />
              <SwitchRow
                label="进球 / 红牌 / 终场提醒"
                hint="仅当前观看场次；窗口不在前台时提醒，防剧透开启且未揭晓时不提醒。"
                on={prefs.notifyLiveEvents}
                onChange={v => patch({ notifyLiveEvents: v })}
              />
            </div>
          </Fieldset>

          {/* 桌面外壳（FR-08）：只在 Electron 里出现，Web 预览不显示这两项 */}
          {desktopSettings && (
            <Fieldset
              title="桌面"
              hint="仅桌面端。托盘常驻后，即使窗口被关到托盘，已授权的提醒仍会发出。"
            >
              <div className="space-y-1.5">
                <SwitchRow
                  label="关闭窗口时最小化到托盘"
                  hint="默认关闭。开启后点 × 只是隐藏窗口，可从托盘图标唤回；只有托盘菜单的「退出」才真正结束进程。"
                  on={desktopSettings.closeToTray === true}
                  onChange={v => onDesktopSettingsChange?.({ closeToTray: v })}
                />
                <SwitchRow
                  label="开机自启"
                  hint="默认关闭。开启后登录时静默启动并常驻托盘，不自动弹出主窗口。"
                  on={desktopSettings.launchAtLogin === true}
                  onChange={v => onDesktopSettingsChange?.({ launchAtLogin: v })}
                />
                {!desktopSettings.closeToTray && (
                  <Meta className="text-text-faint">当前关闭窗口 = 直接退出，提醒链路会中断。</Meta>
                )}
                {typeof Notification !== 'undefined' && Notification.permission === 'denied' && (
                  <Meta className="text-warn">
                    系统通知已被拒绝：请到「系统设置 → 通知」允许夜猫看台，否则提醒不会出现。
                  </Meta>
                )}
              </div>
            </Fieldset>
          )}

          {/* 日历导出（FR-09）：不常开应用也能被系统日历提醒；不引入账号与云端订阅 */}
          <Fieldset
            title="日历导出"
            hint="导出为 .ics 文件，双击可导入系统日历。只导出未开赛且开球时间已确定的场次；标题与说明不含比分。"
          >
            <div className="space-y-2">
              <Segmented
                items={ICS_RANGES.map(r => ({ id: r.id, label: r.label }))}
                value={icsRange}
                onChange={setIcsRange}
                className="w-full [&>button]:flex-1 [&>button]:justify-center"
              />
              <Segmented
                items={[
                  { id: 0, label: '不提醒' },
                  { id: 15, label: '提前 15 分钟' },
                  { id: 30, label: '提前 30 分钟' }
                ]}
                value={icsRemind}
                onChange={setIcsRemind}
                className="w-full [&>button]:flex-1 [&>button]:justify-center"
              />
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="xs" onClick={exportIcs}>
                  导出 .ics
                </Button>
                {icsMsg && (
                  <span className={`text-2xs ${icsMsg.ok ? 'text-resource' : 'text-warn'}`}>{icsMsg.text}</span>
                )}
              </div>
              <Meta>文件会保存到系统下载目录；重复导出会生成新文件，覆盖与否由你决定。</Meta>
            </div>
          </Fieldset>

          {/* 数据状态：一律显示真实状态，不得写「未接入」这类与实现脱节的固定文案 */}
          <Fieldset title="数据与服务" hint={SERVICE_RULE}>
            <div className="space-y-1.5 rounded-lg border border-line-hairline bg-surface-card px-3 py-2.5 font-num text-2xs leading-relaxed tabular-nums text-text-secondary">
              <p>
                赛程快照 {snapshotInfo.count} 场 · {snapshotInfo.range}
              </p>

              {health ? (
                <>
                  <p className="text-resource">本地服务运行中 · {health.listening}</p>
                  <p>
                    流代理 · 白名单 {health.proxy.allowedHosts + health.proxy.allowedHostSuffixes} 条 ·
                    会话授权 {health.proxy.sessionAllowedHosts} 个 · 并发 {health.proxy.activeRequests}/
                    {health.proxy.maxConcurrent}
                    {health.proxy.queuedRequests > 0 ? ` · 排队 ${health.proxy.queuedRequests}` : ''}
                  </p>
                  {health.proxy.sessionAllowedHosts > 0 && (
                    <button
                      type="button"
                      onClick={revokeSession}
                      title={`会话授权会在 ${Math.round(
                        (health.proxy.session?.ttlMs || 0) / 3600000
                      )} 小时后自动回收`}
                      className="text-text-muted underline underline-offset-2 transition-colors hover:text-accent"
                    >
                      清空会话授权
                    </button>
                  )}
                  <p>
                    比分保鲜 · {health.scores.enabled ? '已启用' : '已禁用'}
                    {health.scores.lastSync
                      ? ` · 上次 ${health.scores.lastSync.patches} 条补丁 / ${health.scores.lastSync.errors} 错`
                      : ' · 本次启动后未运行'}
                  </p>

                  {/* 数据新鲜度 + 应用内同步
                      此前这里只说"本次启动后未运行"，用户看到「待录比分」无从下手 ——
                      现在直接把陈旧程度和一键同步摆出来。 */}
                  <div className="mt-1.5 border-t border-line-hairline pt-1.5">
                    <p>
                      最新赛果 <span className="text-text-primary">{freshText}</span>
                      {pendingSplit.recent > 0 && (
                        <span className="text-warn"> · {pendingSplit.recent} 场待录比分</span>
                      )}
                      {pendingSplit.stale > 0 && (
                        <span className="text-warn"> · {pendingSplit.stale} 场上游未提供</span>
                      )}
                    </p>
                    <p className="mt-0.5">
                      上次同步 <span className="text-text-primary">{syncText}</span>
                      {lastSync?.written?.ok === false && (
                        <span className="text-warn">
                          {' '}
                          · 上次写盘失败：{lastSync.written.reason || '未知原因'}
                        </span>
                      )}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={runSync}
                        disabled={syncing || !fresh?.writable}
                        title={
                          fresh?.writable
                            ? '从 ESPN / openfootball 拉取最新比分并写入本地数据'
                            : '当前没有可写的数据目录（桌面版才有），只能预览'
                        }
                        className="rounded border border-line-control bg-surface-raised px-2 py-0.5 text-2xs text-text-secondary transition-colors hover:text-accent hover:border-line-control disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {syncing ? '同步中…' : '立即同步比分'}
                      </button>
                      {syncMsg && (
                        <span className={syncMsg.ok ? (syncMsg.degraded ? 'text-warn' : 'text-resource') : 'text-danger'}>{syncMsg.text}</span>
                      )}
                    </div>
                  </div>

                  {/* 线路成功率记忆（FR-07）：本机按域名记录起播结果，只影响线路排序 */}
                  <div className="mt-1.5 border-t border-line-hairline pt-1.5">
                    <p>
                      线路记忆{' '}
                      <span className="text-text-primary">
                        {lineMemCount > 0 ? `${lineMemCount} 条本机经验` : '暂无记录'}
                      </span>
                    </p>
                    <p className="mt-0.5">
                      按域名记录起播成功与失败，用于把能用的线路排到前面；失败的当天沉底但不隐藏，7 天无数据自动衰减。
                    </p>
                    {lineMemCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          clearLineMemory();
                          setLineMemCount(0);
                        }}
                        className="mt-1 rounded border border-line-control bg-surface-raised px-2 py-0.5 text-2xs text-text-secondary transition-colors hover:border-line-control hover:text-accent"
                      >
                        清除线路记忆
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-warn">本地服务未启动</p>
                  <p className="text-text-muted">赛程与算法照常可用，播放与保鲜不可用</p>
                </>
              )}
            </div>
          </Fieldset>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-line-hairline px-5 py-3">
          <div className="flex min-w-0 items-center gap-2 text-2xs text-text-faint">
            {confirmReset ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-warn">恢复默认？</span>
                <button
                  type="button"
                  onClick={() => {
                    onPrefsChange(defaultPrefs());
                    setConfirmReset(false);
                  }}
                  className="font-medium text-warn underline underline-offset-2 transition-colors hover:text-warn/80"
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="transition-colors hover:text-text-secondary"
                >
                  取消
                </button>
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1 transition-colors hover:text-text-secondary"
                >
                  <IconReset size={11} />
                  恢复默认
                </button>
                {onRerunOnboarding && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button type="button" onClick={onRerunOnboarding} className="transition-colors hover:text-text-secondary">
                      重新引导
                    </button>
                  </>
                )}
                {onReplaySplash && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button type="button" onClick={onReplaySplash} className="transition-colors hover:text-text-secondary">
                      开屏动画
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {updateState?.status === 'available' ? (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                className="group flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 text-2xs font-medium text-accent shadow-[0_0_12px_rgba(245,185,66,0.25)] hover:bg-accent/25 transition-all cursor-pointer"
                title={`发现新版本 v${updateState?.info?.version || ''}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span>发现新版</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                title="检查 GitHub 最新版本"
                className="text-2xs text-text-faint transition-colors hover:text-text-secondary"
              >
                检查更新
              </button>
            )}
            {/* 版本号构建期注入。此前顶栏手写「v1.0」而 package.json 是 0.1.3 */}
            <Meta num>v{__APP_VERSION__}</Meta>
            <Button variant="primary" onClick={onClose}>
              完成
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * 拉取本地服务真实状态
 *
 * 为什么不写死文案：本产品的一条核心纪律是「界面不说谎」。
 * 设置面板曾显示「保鲜同步：未接入（P4）· 本地流代理：未接入（P3）」，
 * 而两者其实早已实现 —— 这类与实现脱节的固定文案，会让用户对系统能力产生错误判断，
 * 也会让开发者误以为功能缺失。因此直接问服务要状态，取不到就如实说未启动。
 *
 * `open` 进依赖：抽屉每次打开重新拉一次，否则显示的可能是几分钟前的旧状态。
 */
function useServiceHealth(open) {
  const [health, setHealth] = useState(null);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick 是「手动刷新健康」的计数器，纯触发器
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    fetch('/api/health')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => {
        if (alive) setHealth(j);
      })
      .catch(() => {
        if (alive) setHealth(null);
      });
    return () => {
      alive = false;
    };
  }, [open, tick]);
  return { health, refresh: () => setTick(t => t + 1) };
}

/** 开关行：解释性长注收进 Hint，行高不再被第二行文案挤开 */
function SwitchRow({ label, hint = null, on, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-surface-card px-3 py-2">
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-text-secondary">
        <span className="truncate">{label}</span>
        {hint && <Hint content={hint} align="start" />}
      </span>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  );
}
