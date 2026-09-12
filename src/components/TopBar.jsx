import { bjClock, bjDate } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { Crest } from './atoms.jsx';

const VIEWS = [
  { id: 'tonight', label: '今晚观赛', icon: '🌙' },
  { id: 'week', label: '本周规划', icon: '📊' },
  { id: 'schedule', label: '赛程日历', icon: '📅' }
];

/** 夜猫看台标记（纯 SVG，不依赖外部图片资源） */
function OwlMark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#131722" stroke="#232A3B" strokeWidth="1" />
      <path d="M8 10.5 L13 6.5 L13 13 Z" fill="#FFB800" opacity="0.85" />
      <path d="M24 10.5 L19 6.5 L19 13 Z" fill="#FFB800" opacity="0.85" />
      <circle cx="12" cy="17" r="4.2" fill="none" stroke="#FFB800" strokeWidth="1.6" />
      <circle cx="20" cy="17" r="4.2" fill="none" stroke="#FFB800" strokeWidth="1.6" />
      <circle cx="12" cy="17" r="1.5" fill="#FFB800" />
      <circle cx="20" cy="17" r="1.5" fill="#FFB800" />
      <path d="M14.6 22.4 L16 24.6 L17.4 22.4 Z" fill="#FFB800" />
    </svg>
  );
}

export default function TopBar({ view, onViewChange, now, liveCount, prefs, onOpenSettings }) {
  const primaryTeam = prefs.followedTeams[0];

  return (
    <header
      className="drag-region flex h-[52px] min-h-[52px] select-none items-center justify-between border-b border-border-subtle bg-surface-panel px-6"
      style={{ paddingLeft: '80px' /* macOS 交通灯避让 pl-20 */ }}
    >
      {/* 左：品牌 + 三视图切换（导航唯一入口，D2） */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <OwlMark />
          <div className="flex items-baseline gap-2">
            <span className="font-headline text-[15px] font-bold tracking-tight text-slate-100">
              夜猫看台
            </span>
            <span className="rounded border border-border-subtle bg-surface-card px-1.5 py-px font-mono text-[9px] text-slate-500">
              v1.0
            </span>
          </div>
        </div>

        <nav className="no-drag ml-2 flex items-center gap-1" aria-label="视图切换">
          {VIEWS.map(v => {
            const active = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onViewChange(v.id)}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary-gold/15 text-primary-gold shadow-[inset_0_-2px_0_0_rgba(255,184,0,0.9)]'
                    : 'text-slate-400 hover:bg-surface-hover hover:text-slate-200'
                }`}
              >
                <span className="mr-1 text-[11px]">{v.icon}</span>
                {v.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* 中：北京时间 + 进行中计数 */}
      <div className="no-drag hidden items-center gap-2 lg:flex">
        <div className="flex items-center gap-2 rounded border border-border-subtle bg-surface-card px-3 py-1">
          <span className="font-mono text-[10px] tracking-wider text-slate-500">北京时间</span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
            {bjClock(now)}
          </span>
          <span className="font-mono text-[10px] text-slate-500">{bjDate(now)}</span>
        </div>
        {liveCount > 0 && (
          <div className="flex items-center gap-1.5 rounded border border-live-red/40 bg-live-red/10 px-2.5 py-1">
            <span className="inline-block h-1.5 w-1.5 animate-live-pulse rounded-full bg-live-red" />
            <span className="font-mono text-[10px] font-semibold text-live-red">
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
            className="flex items-center gap-2 rounded-full border border-border-subtle bg-surface-card px-3 py-1 transition-colors hover:border-border-strong"
          >
            <Crest id={primaryTeam} size={16} />
            <span className="text-[11px] font-medium text-slate-200">{teamName(primaryTeam)}</span>
            {prefs.followedTeams.length > 1 && (
              <span className="font-mono text-[10px] text-slate-500">+{prefs.followedTeams.length - 1}</span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenSettings}
            title="设置关注球队后，推荐会优先排入主队比赛"
            className="rounded-full border border-dashed border-primary-gold/50 bg-primary-gold/[0.06] px-3 py-1 text-[11px] text-primary-gold transition-colors hover:bg-primary-gold/[0.12]"
          >
            + 设置关注球队
          </button>
        )}

        {prefs.followedLeagues.length > 0 && prefs.followedLeagues.length < 6 && (
          <span className="hidden rounded border border-accent-teal/30 bg-accent-teal/10 px-2 py-1 font-mono text-[10px] text-accent-teal xl:inline-flex">
            关注联赛 +8 生效
          </span>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-card px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:bg-surface-hover hover:text-slate-100"
        >
          <span aria-hidden="true">⚙</span>
          偏好与数据
        </button>
      </div>
    </header>
  );
}
