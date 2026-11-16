import { useEffect, useState } from 'react';
import { bjClock, bjDate } from '../core/format.js';
import { teamName } from '../data/index.js';
import { BrandLogo, Crest, LiveDot } from './atoms.jsx';
import { IconMe, IconSchedule, IconSearch, IconSettings, IconStandings, IconTonight, IconWeek, IconWinClose, IconWinMax, IconWinMin, IconWinRestore } from './icons.jsx';

/**
 * 自绘窗口按钮（仅桌面版的 Windows/Linux —— macOS 用系统交通灯）
 *
 * 无边框窗口（frame:false）下系统不提供任何窗口控件，必须自绘。
 * 细线风图标，与全站 lucide 图标层保持一致。
 */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const off = window.desktop?.onMaximizeChange?.(setMaximized);
    return () => off?.();
  }, []);

  const base =
    'no-drag inline-flex h-[52px] w-11 items-center justify-center text-text-muted transition-colors';
  return (
    <div className="-mr-5 ml-1 flex items-center">
      <button
        type="button"
        onClick={() => window.desktop?.minimize()}
        className={`${base} hover:bg-surface-raised hover:text-text-primary`}
        aria-label="最小化"
        title="最小化"
      >
        <IconWinMin />
      </button>
      <button
        type="button"
        onClick={() => window.desktop?.toggleMaximize()}
        className={`${base} hover:bg-surface-raised hover:text-text-primary`}
        aria-label={maximized ? '还原' : '最大化'}
        title={maximized ? '还原' : '最大化'}
      >
        {maximized ? <IconWinRestore /> : <IconWinMax />}
      </button>
      <button
        type="button"
        onClick={() => window.desktop?.close()}
        className={`${base} hover:bg-danger hover:text-accent-ink`}
        aria-label="关闭"
        title="关闭"
      >
        <IconWinClose />
      </button>
    </div>
  );
}

const VIEWS = [
  { id: 'tonight', label: '今晚观赛', icon: <IconTonight /> },
  { id: 'week', label: '本周规划', icon: <IconWeek /> },
  { id: 'schedule', label: '赛程日历', icon: <IconSchedule /> },
  { id: 'me', label: '我的看台', icon: <IconMe /> }
];



/**
 * 顶栏
 *
 * 降噪要点：
 *   · 版本号从顶栏移除 —— 它不是决策信息，挪到「偏好与数据」底部。
 *   · 右侧原本并存「虚线金边按钮 / 实心青边胶囊 / 纯文字按钮」三种控件语言，
 *     现在只保留两种：一个次级入口（关注球队）与一个 ghost 按钮（偏好与数据）。
 *   · "+8 加成生效中" 是算法内部状态，不该常驻顶栏，收进偏好抽屉。
 *   · 未设置关注球队时的入口不再用品牌金：顶栏同一屏内「激活视图标签」已经是唯一的
 *     强调色，再多一个金色文字，眼睛就不知道该看哪儿了。它保持 ghost 按钮形态，
 *     位置与「已关注」状态完全重合 —— 同一个槽位在等用户填。
 */
function watchPeriodOf(nowTs) {
  const hour = new Date(nowTs + 8 * 3600_000).getUTCHours();
  if (hour >= 2 && hour < 6) return '深宵档';
  if (hour >= 23 || hour < 2) return '子夜档';
  if (hour >= 18) return '黄金档';
  return '日间档';
}

/** 顶栏时钟独立成叶子组件，避免每秒 tick 触发整个 TopBar 重渲染；窗口隐藏时自动停表。 */
function TopBarClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t = null;
    const syncVisibility = () => {
      if (t) {
        clearInterval(t);
        t = null;
      }
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        setNow(Date.now());
        t = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    syncVisibility();
    document?.addEventListener?.('visibilitychange', syncVisibility);
    return () => {
      if (t) clearInterval(t);
      document?.removeEventListener?.('visibilitychange', syncVisibility);
    };
  }, []);

  return (
    <div className="no-drag hidden shrink-0 items-center lg:flex">
      <div className="flex items-center gap-2 rounded-full border border-line-hairline bg-surface-card px-2.5 py-1 xl:px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-accent/80" aria-hidden="true" />
        <span className="font-num text-xs font-semibold tabular-nums text-text-primary">
          {bjClock(now)}
        </span>
        <span className="hidden font-num text-xs tabular-nums text-text-faint xl:inline">{bjDate(now)}</span>
        <span className="hidden border-l border-line-hairline pl-2 text-xs font-medium text-text-muted xl:inline">
          {watchPeriodOf(now)}
        </span>
      </div>
    </div>
  );
}

export default function TopBar({
  view,
  onViewChange,
  liveCount,
  pendingQueueCount = 0,
  prefs,
  dataHealth = null,
  onOpenSettings,
  onOpenSettingsTab,
  onOpenMyTeams,
  updateAvailable = false,
  updateVersion = null,
  onOpenUpdate,
  onOpenPalette,
  onOpenStandings
}) {

  // 平台感知：macOS 的 hiddenInset 需要给交通灯留位；Windows/Linux 走自绘按钮，不留白。
  // （此前无条件 paddingLeft:80 是给 macOS 交通灯让位的，在 Windows 上凭空留白，
  //   把图标与名称整体推右 —— 这就是顶栏「不靠左」的根因。）
  const isDesktop = typeof window !== 'undefined' && !!window.desktop;
  const isMacDesktop = isDesktop && window.desktop.platform === 'darwin';
  const showSelfDrawnControls = isDesktop && !isMacDesktop;

  const primaryTeam = prefs.followedTeams[0];

  return (
    <header
      className="drag-region relative grid h-[52px] min-h-[52px] select-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-line-hairline bg-surface-panel/95 px-3.5 xl:px-5 backdrop-blur-xl shadow-sm"
      style={{ paddingLeft: isMacDesktop ? 80 : undefined }}
    >
      <div className="flex min-w-0 items-center gap-3 xl:gap-5">
        <div className="flex shrink-0 items-center gap-2.5">
          <BrandLogo size={26} rounded="md" withGlow={false} />
          <span className="whitespace-nowrap text-sm font-bold tracking-tight text-text-primary">
            夜猫看台
          </span>
        </div>

        <nav className="no-drag flex shrink-0 items-center gap-0.5 xl:gap-1" aria-label="视图切换" role="tablist">
          {VIEWS.map(it => {
            const active = it.id === view;
            const showLiveBadge = it.id === 'tonight' && liveCount > 0;
            const showQueueBadge = it.id === 'me' && pendingQueueCount > 0;
            return (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onViewChange(it.id)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 xl:px-3 py-1.5 text-xs transition-all active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                  active
                    ? 'bg-surface-raised font-semibold text-text-primary shadow-card'
                    : 'text-text-muted hover:bg-surface-raised/60 hover:text-text-primary'
                }`}
              >
                <span className={active ? 'text-accent' : 'text-text-faint'}>{it.icon}</span>
                {it.label}
                {showLiveBadge && (
                  <span
                    className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-live/10 px-1.5 py-px font-num text-2xs font-semibold tabular-nums text-live"
                    title={`${liveCount} 场比赛正在进行`}
                  >
                    <LiveDot />
                    {liveCount}
                  </span>
                )}
                {showQueueBadge && (
                  <span
                    className="ml-0.5 inline-flex items-center rounded-full bg-accent/15 px-1.5 py-px font-num text-2xs font-semibold tabular-nums text-accent"
                    title={`${pendingQueueCount} 场待补看`}
                  >
                    {pendingQueueCount > 9 ? '9+' : pendingQueueCount}
                  </span>
                )}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 -bottom-[10px] h-0.5 rounded-full bg-accent"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <TopBarClock />

      <div className="no-drag flex shrink-0 items-center justify-end gap-1.5">
        {dataHealth && dataHealth.state !== 'unknown' && (() => {
          const compactOk = dataHealth.state === 'ok' && dataHealth.label !== '正在更新比分…';
          return (
            <button
              type="button"
              onClick={() => (onOpenSettingsTab ? onOpenSettingsTab('system') : onOpenSettings?.())}
              title={`数据状态：${dataHealth.label}（点击查看服务与诊断）`}
              aria-label={`数据状态：${dataHealth.label}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border text-xs transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                compactOk ? 'h-7 w-7 justify-center xl:w-auto xl:px-2.5' : 'max-w-[160px] px-2.5 py-1'
              } ${
                dataHealth.state === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : dataHealth.state === 'warn'
                    ? 'border-warn/30 bg-warn/10 text-warn'
                    : 'border-line-hairline bg-surface-card text-text-secondary'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  dataHealth.state === 'error'
                    ? 'bg-danger'
                    : dataHealth.state === 'warn'
                      ? 'bg-warn'
                      : 'bg-resource'
                }`}
                aria-hidden="true"
              />
              <span className={compactOk ? 'hidden truncate font-medium xl:inline' : 'truncate font-medium'}>
                {dataHealth.label}
              </span>
            </button>
          );
        })()}
        <button
          type="button"
          onClick={onOpenPalette}
          title={`搜索球队、比赛或功能（${isMacDesktop ? '⌘K' : 'Ctrl+K'}）`}
          aria-label="搜索"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-hairline bg-surface-card px-2.5 text-xs text-text-secondary transition-colors hover:border-line-control hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <IconSearch size={13} />
          <span className="hidden sm:inline">搜索</span>
          <kbd className="hidden shrink-0 rounded border border-line-hairline bg-surface-panel px-1 py-px font-num text-2xs text-text-faint md:inline">
            {isMacDesktop ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
        <button
          type="button"
          onClick={onOpenStandings}
          title="查看完整积分榜"
          aria-label="积分榜"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-hairline bg-surface-card text-text-muted transition-colors hover:border-line-control hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <IconStandings size={14} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-line-hairline" aria-hidden="true" />
        {primaryTeam ? (
          <button
            type="button"
            onClick={() => (onOpenMyTeams ? onOpenMyTeams() : onOpenSettings?.())}
            title="管理关注球队"
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1 text-xs text-text-primary transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <Crest id={primaryTeam} size={16} />
            <span className="font-medium">{teamName(primaryTeam)}</span>
            {prefs.followedTeams.length > 1 && (
              <span className="font-num text-2xs text-text-muted">+{prefs.followedTeams.length - 1}</span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (onOpenMyTeams ? onOpenMyTeams() : onOpenSettings?.())}
            title="管理关注球队"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            设置关注球队
          </button>
        )}

        <span className="mx-0.5 h-4 w-px bg-line-hairline" aria-hidden="true" />

        {updateAvailable && (
          <button
            type="button"
            onClick={onOpenUpdate}
            title={updateVersion ? `新版本 v${updateVersion} 可用，点击查看` : '有新版本可用，点击查看'}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/45 bg-accent/15 px-2.5 py-1 text-2xs font-medium text-accent transition-colors hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            {updateVersion ? `新版本 v${updateVersion}` : '新版本'}
          </button>
        )}

        <button
          type="button"
          onClick={() => (onOpenSettingsTab ? onOpenSettingsTab('rules') : onOpenSettings?.())}
          className="relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <IconSettings />
          偏好与数据
          {/* 设置按钮上的角标：即使气泡被无视，点开设置也能看到入口 */}
          {updateAvailable && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg-app"
              aria-hidden="true"
            />
          )}
        </button>

        {/* 窗口按钮放在右侧容器内 —— 若作为 header 的第 4 个直接子元素，
            justify-between 会把左侧的品牌区推离边缘 */}
        {showSelfDrawnControls && <WindowControls />}
      </div>
    </header>
  );
}
