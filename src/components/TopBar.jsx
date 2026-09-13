import { useEffect, useState } from 'react';
import { bjClock, bjDate } from '../core/format.js';
import { teamName } from '../data/index.js';
import { Crest, LiveDot, Segmented } from './atoms.jsx';
import { IconSchedule, IconSettings, IconTonight, IconWeek } from './icons.jsx';

const VIEWS = [
  { id: 'tonight', label: '今晚观赛', icon: <IconTonight /> },
  { id: 'week', label: '本周规划', icon: <IconWeek /> },
  { id: 'schedule', label: '赛程日历', icon: <IconSchedule /> }
];

/** 夜猫看台标记（纯 SVG，跟随品牌色变量） */
function OwlMark() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" className="shrink-0">
      <path d="M8 10.5 L13 6.5 L13 13 Z" fill="var(--accent)" opacity="0.9" />
      <path d="M24 10.5 L19 6.5 L19 13 Z" fill="var(--accent)" opacity="0.9" />
      <circle cx="12" cy="17" r="4.2" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      <circle cx="20" cy="17" r="4.2" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      <circle cx="12" cy="17" r="1.5" fill="var(--accent)" />
      <circle cx="20" cy="17" r="1.5" fill="var(--accent)" />
      <path d="M14.6 22.4 L16 24.6 L17.4 22.4 Z" fill="var(--accent)" />
    </svg>
  );
}

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
export default function TopBar({ view, onViewChange, liveCount, prefs, onOpenSettings }) {
  // 时钟是全应用唯一需要秒级显示的地方，把 tick 隔离在本地：
  // 否则 App 每秒重渲染会连带重建赛程视图的 2000+ 列表元素（实测约 9% CPU）。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const primaryTeam = prefs.followedTeams[0];

  return (
    <header
      className="drag-region flex h-[52px] min-h-[52px] select-none items-center justify-between border-b border-line-hairline bg-bg-app px-5"
      style={{ paddingLeft: 80 /* macOS 交通灯避让 */ }}
    >
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <OwlMark />
          <span className="text-sm font-semibold tracking-tight text-text-primary">夜猫看台</span>
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

        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
        >
          <IconSettings />
          偏好与数据
        </button>
      </div>
    </header>
  );
}
