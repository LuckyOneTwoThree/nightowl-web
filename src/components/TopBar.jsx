import { useEffect, useState } from 'react';
import { bjClock, bjDate } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { Crest } from './atoms.jsx';

const VIEWS = [
  { id: 'tonight', label: '今晚观赛', icon: '🌙' },
  { id: 'week', label: '本周规划', icon: '📊' },
  { id: 'schedule', label: '赛程日历', icon: '📅' }
];

/** 夜猫看台标记（纯 SVG，支持主题变量响应） */
function OwlMark() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" className="shrink-0">
      <path d="M8 10.5 L13 6.5 L13 13 Z" fill="var(--primary-gold)" opacity="0.9" />
      <path d="M24 10.5 L19 6.5 L19 13 Z" fill="var(--primary-gold)" opacity="0.9" />
      <circle cx="12" cy="17" r="4.2" fill="none" stroke="var(--primary-gold)" strokeWidth="1.6" />
      <circle cx="20" cy="17" r="4.2" fill="none" stroke="var(--primary-gold)" strokeWidth="1.6" />
      <circle cx="12" cy="17" r="1.5" fill="var(--primary-gold)" />
      <circle cx="20" cy="17" r="1.5" fill="var(--primary-gold)" />
      <path d="M14.6 22.4 L16 24.6 L17.4 22.4 Z" fill="var(--primary-gold)" />
    </svg>
  );
}

export default function TopBar({
  view,
  onViewChange,
  liveCount,
  prefs,
  onOpenSettings
}) {
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
      className="drag-region flex h-[52px] min-h-[52px] select-none items-center justify-between border-b border-white/[0.04] bg-[#0A0D14]/90 backdrop-blur-md px-5 transition-colors duration-200"
      style={{ paddingLeft: '80px' /* macOS 交通灯避让 pl-20 */ }}
    >
      {/* 左：品牌 + 三视图无框胶囊切换 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <OwlMark />
          <div className="flex items-baseline">
            <span className="font-headline text-[15px] font-bold tracking-tight text-text-primary">
              夜猫看台
            </span>
            <span className="ml-1.5 font-mono text-[10px] font-semibold text-text-dim">
              v1.0
            </span>
          </div>
        </div>

        {/* 现代极简 Tab 导航（自然沉浸，无生硬套盒） */}
        <nav className="no-drag ml-2 flex items-center gap-1" aria-label="视图切换">
          {VIEWS.map(v => {
            const active = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onViewChange(v.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${
                  active
                    ? 'bg-primary-gold/15 text-primary-gold font-bold shadow-xs'
                    : 'text-text-muted hover:bg-white/[0.04] hover:text-text-primary'
                }`}
              >
                <span className="text-[12px]">{v.icon}</span>
                <span>{v.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 中：纯净排版时钟 + 进行中计数（无突兀外框） */}
      <div className="no-drag hidden items-center gap-3 lg:flex">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-[10px] tracking-wider uppercase text-text-dim">北京时间</span>
          <span className="font-bold tabular-nums text-text-primary text-[13px]">
            {bjClock(now)}
          </span>
          <span className="text-[11px] text-text-dim">{bjDate(now)}</span>
        </div>
        {liveCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-live-red/10 px-2.5 py-0.5">
            <span className="inline-block h-1.5 w-1.5 animate-live-pulse rounded-full bg-live-red shadow-[0_0_8px_rgba(226,75,74,0.6)]" />
            <span className="font-mono text-[10px] font-extrabold text-live-red tracking-tight">
              {liveCount} 场进行中
            </span>
          </div>
        )}
      </div>

      {/* 右：关注球队 + 设置 */}
      <div className="no-drag flex items-center gap-2">
        {primaryTeam ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-2 rounded-full bg-white/[0.04] hover:bg-white/[0.08] px-3 py-1 transition-all active:scale-95"
          >
            <Crest id={primaryTeam} size={16} />
            <span className="text-[11px] font-semibold text-text-primary">{teamName(primaryTeam)}</span>
            {prefs.followedTeams.length > 1 && (
              <span className="font-mono text-[10px] font-bold text-primary-gold">
                +{prefs.followedTeams.length - 1}
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenSettings}
            title="设置关注球队后，推荐会优先排入主队比赛"
            className="rounded-full px-3 py-1 text-[11px] font-medium text-primary-gold hover:bg-primary-gold/15 transition-all active:scale-95"
          >
            + 设置关注球队
          </button>
        )}

        {prefs.followedLeagues.length > 0 && prefs.followedLeagues.length < 6 && (
          <span className="hidden rounded-full bg-accent-teal/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-accent-teal xl:inline-flex">
            关注联赛 +8
          </span>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-all hover:bg-white/[0.05] hover:text-text-primary active:scale-95"
        >
          <span aria-hidden="true" className="text-[12px]">⚙</span>
          偏好与数据
        </button>
      </div>
    </header>
  );
}
