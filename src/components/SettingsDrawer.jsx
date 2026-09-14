import { useCallback, useEffect, useMemo, useState } from 'react';
import { fixtures, FOLLOWABLE_LEAGUES, LEAGUE_NAMES, leagueColor } from '../data/index.js';
import { defaultPrefs } from '../core/prefs.js';
import { Button, Chip, Fieldset, Hint, Meta, Switch, TogglePill } from './atoms.jsx';
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

const NOTIFY_NOTE = '依赖桌面外壳（P5），当前只保存偏好，不会真的弹系统通知。';

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
  onOpenUpdateModal
}) {
  const leagueCount = prefs.followedLeagues.length;
  const bonusActive = leagueCount > 0 && leagueCount < 6;

  const { health, refresh } = useServiceHealth(open);

  /* ---- 数据新鲜度与一键同步 ----
     快照是构建期内联的，桌面端同步后写在 userData；这里负责显示陈旧程度并触发同步。 */
  const [fresh, setFresh] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const loadFreshness = useCallback(async () => {
    try {
      const r = await fetch('/api/scores/status');
      if (!r.ok) return;
      const j = await r.json();
      setFresh(j?.freshness || null);
    } catch {
      setFresh(null);
    }
  }, []);

  useEffect(() => {
    if (open) loadFreshness();
  }, [open, loadFreshness]);

  const runSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch('/api/scores/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true })
      });
      const j = await r.json();
      if (!r.ok) {
        setSyncMsg({ ok: false, text: j?.error || '同步失败' });
        return;
      }
      const changed = j?.summary?.written?.changed ?? 0;
      // 拉新数据替换内存里的快照（同步完不刷新页面，视图也要跟着变）
      await onDataRefresh?.();
      await loadFreshness();
      refresh();
      setSyncMsg({ ok: true, text: changed > 0 ? `已更新 ${changed} 场比分` : '已经是最新' });
    } catch (err) {
      setSyncMsg({ ok: false, text: err?.message || '同步失败' });
    } finally {
      setSyncing(false);
    }
  };

  const freshText = useMemo(() => {
    if (!fresh?.lastScoreAt) return '未知';
    const h = fresh.staleHours ?? 0;
    if (h < 1) return '刚刚';
    if (h < 24) return `${h.toFixed(1)} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  }, [fresh]);
  const range = useMemo(() => {
    const days = fixtures.map(m => m.t.slice(0, 10)).sort();
    return days.length ? `${days[0]} ~ ${days[days.length - 1]}` : '—';
  }, []);

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
        className={`fixed right-0 top-0 z-drawer flex h-full w-[480px] flex-col border-l border-line-hairline bg-surface-panel shadow-pop transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line-hairline px-5 py-3.5">
          <div>
            <h2 className="font-headline text-base font-semibold text-text-primary">偏好与数据</h2>
            <Meta className="mt-0.5 block">决定推荐排序与背包规划的输入</Meta>
          </div>
          <button
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
              gridClass="grid-cols-6"
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
              <SwitchRow
                label="赛前 15 分钟系统通知"
                hint={NOTIFY_NOTE}
                on={prefs.notifyBefore15}
                onChange={v => patch({ notifyBefore15: v })}
              />
            </div>
          </Fieldset>

          {/* 数据状态：一律显示真实状态，不得写「未接入」这类与实现脱节的固定文案 */}
          <Fieldset title="数据与服务" hint={SERVICE_RULE}>
            <div className="space-y-1.5 rounded-lg border border-line-hairline bg-surface-card px-3 py-2.5 font-num text-2xs leading-relaxed tabular-nums text-text-secondary">
              <p>
                赛程快照 {fixtures.length.toLocaleString()} 场 · {range}
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
                      数据更新于 <span className="text-text-primary">{freshText}</span>
                      {fresh?.pendingCount > 0 && (
                        <span className="text-warn"> · {fresh.pendingCount} 场待录比分</span>
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
                        className="rounded bg-surface-elevated px-2 py-0.5 font-ui text-[10px] text-text-secondary transition-colors hover:text-primary-gold disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {syncing ? '同步中…' : '立即同步比分'}
                      </button>
                      {syncMsg && (
                        <span className={syncMsg.ok ? 'text-resource' : 'text-warn'}>{syncMsg.text}</span>
                      )}
                    </div>
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
          <div className="flex items-center gap-1">
            <Button variant="ghost" icon={<IconReset size={12} />} onClick={() => onPrefsChange(defaultPrefs())}>
              恢复默认
            </Button>
            {onRerunOnboarding && (
              <Button variant="ghost" onClick={onRerunOnboarding}>
                重新引导
              </Button>
            )}
            {onReplaySplash && (
              <Button variant="ghost" onClick={onReplaySplash}>
                开屏动画
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {updateState?.status === 'available' ? (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                className="group flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-2xs font-medium text-accent shadow-[0_0_12px_rgba(245,185,66,0.25)] hover:bg-amber-500/25 transition-all cursor-pointer"
                title={`发现新版本 v${updateState?.info?.version || ''}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                <span>发现新版</span>
              </button>
            ) : (
              <Button
                variant="ghost"
                onClick={onOpenUpdateModal}
                title="检查 GitHub 最新版本"
              >
                检查更新
              </Button>
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
