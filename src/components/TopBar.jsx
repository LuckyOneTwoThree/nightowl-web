import { useEffect, useState } from 'react';
import { bjClock, bjDate } from '../core/format.js';
import { teamName } from '../data/index.js';
import { BrandLogo, Crest, LiveDot, Segmented } from './atoms.jsx';
import { IconSchedule, IconSettings, IconTonight, IconWeek, IconWinClose, IconWinMax, IconWinMin, IconWinRestore } from './icons.jsx';

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
        className={`${base} hover:bg-rose-500/85 hover:text-white`}
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
  { id: 'schedule', label: '赛程日历', icon: <IconSchedule /> }
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
export default function TopBar({
  view,
  onViewChange,
  liveCount,
  prefs,
  onOpenSettings,
  updateAvailable = false,
  onOpenUpdate
}) {
  // 时钟是全应用唯一需要秒级显示的地方，把 tick 隔离在本地：
  // 否则 App 每秒重渲染会连带重建赛程视图的 2000+ 列表元素（实测约 9% CPU）。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 平台感知：macOS 的 hiddenInset 需要给交通灯留位；Windows/Linux 走自绘按钮，不留白。
  // （此前无条件 paddingLeft:80 是给 macOS 交通灯让位的，在 Windows 上凭空留白，
  //   把图标与名称整体推右 —— 这就是顶栏「不靠左」的根因。）
  const isDesktop = typeof window !== 'undefined' && !!window.desktop;
  const isMacDesktop = isDesktop && window.desktop.platform === 'darwin';
  const showSelfDrawnControls = isDesktop && !isMacDesktop;

  const primaryTeam = prefs.followedTeams[0];

  return (
    <header
      className="drag-region relative flex h-[52px] min-h-[52px] select-none items-center justify-between bg-gradient-to-r from-[#0d1226]/95 via-[#090b14]/90 to-[#190e30]/95 px-5 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
      style={{ paddingLeft: isMacDesktop ? 80 : undefined }}
    >
      {/* 底部极光微流光边线：左侧星空蓝 -> 中段低调冰霜 -> 右侧极光紫 */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-blue-500/30 via-white/[0.08] to-purple-500/40"
        aria-hidden="true"
      />

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2.5">
          <BrandLogo size={26} rounded="md" withGlow />
          <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-300 bg-clip-text text-sm font-bold tracking-tight text-transparent drop-shadow-[0_0_12px_rgba(245,185,66,0.35)]">
            夜猫看台
          </span>
        </div>

        <nav className="no-drag" aria-label="视图切换">
          <Segmented items={VIEWS} value={view} onChange={onViewChange} />
        </nav>
      </div>

      <div className="no-drag hidden items-center gap-3 lg:flex">
        <div className="flex items-baseline gap-2">
          <span className="text-2xs text-text-faint">北京时间</span>
          <span className="font-num text-sm font-semibold tabular-nums text-text-primary">
            {bjClock(now)}
          </span>
          <span className="font-num text-2xs tabular-nums text-text-faint">{bjDate(now)}</span>
        </div>
        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-live/12 px-2.5 py-0.5">
            <LiveDot />
            <span className="text-2xs font-medium text-live">{liveCount} 场进行中</span>
          </span>
        )}
      </div>

      <div className="no-drag flex items-center gap-1.5">
        {primaryTeam ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-text-primary transition-colors hover:bg-surface-raised"
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
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
          >
            设置关注球队
          </button>
        )}

        <span className="mx-1 h-4 w-px bg-line-hairline" aria-hidden="true" />

        {/* 版本更新气泡 —— 主流产品的做法：有新版本时在顶栏给出**可见**的入口，
            而不是藏在设置面板里等用户自己发现 */}
        {updateAvailable && (
          <button
            type="button"
            onClick={onOpenUpdate}
            title="有新版本可用，点击查看"
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/45 bg-accent/15 px-2.5 py-1 text-2xs font-medium text-accent shadow-[0_0_12px_rgba(245,185,66,0.28)] transition-colors hover:bg-accent/25"
          >
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            新版本
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="relative inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
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
