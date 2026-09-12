import { hm, liveMinute } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts } from '../core/engine.js';
import { Crest, SleepBadge, Stars, Pill, ScoreText, LiveDot } from './atoms.jsx';

/**
 * 紧凑比赛行（两行式高辨识度卡片）
 *
 * 优化重点：
 *   1. 队名独占第二行完整宽度，根除单字截断（如「桑...」「阿...」）
 *   2. 进行中赛事（LIVE）强视觉标注：红色呼吸光晕、高亮左侧光条、LIVE 分钟徽标
 *   3. 状态与比分受防剧透控制
 */
export default function MatchRow({
  m,
  state,
  active = false,
  now,
  onSelect,
  spoilerFree = true,
  revealed = false,
  onReveal,
  star = null,
  rivalry = null,
  locked = false,
  flash = false
}) {
  const isMine = locked; // 雷区
  const kickTs = ts(m.t);
  const live = state === 'live';
  const minute = live ? liveMinute(kickTs, now) : 0;

  const cardStyle = live
    ? 'bg-gradient-to-r from-live-red/[0.14] via-surface-card to-surface-card shadow-xs'
    : active
      ? 'bg-primary-gold/15 shadow-xs'
      : isMine
        ? 'bg-danger-orange/[0.06] hover:bg-danger-orange/[0.10]'
        : 'bg-surface-card/70 hover:bg-surface-hover shadow-2xs hover:shadow-xs';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(m.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(m.id);
        }
      }}
      className={`relative w-full select-none rounded-lg px-3 py-2 text-left transition-all duration-150 ${cardStyle} ${
        flash ? 'animate-gold-flash' : ''
      }`}
    >
      {/* 活跃指示光条（LIVE 时发红光，选中时发金光） */}
      {live && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3.5px] rounded-r-sm bg-live-red shadow-[0_0_8px_rgba(226,75,74,0.9)]" />
      )}
      {!live && active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-primary-gold" />
      )}

      {/* 第一行：时间 · 联赛 · 星级 · 状态/比分 */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={`font-mono text-[11px] font-bold tabular-nums ${live ? 'text-live-red' : 'text-text-primary'}`}>
            {hm(m.t)}
          </span>
          <span className="font-mono text-[10px] text-text-muted">{leagueName(m.l)}</span>
          {m.tbd ? <Pill>待定</Pill> : <SleepBadge match={m} compact />}
          {star != null && <Stars star={star} />}
          {rivalry && <Pill tone="purple">{rivalry}</Pill>}
          {isMine && <Pill tone="warn">⚠ 建议睡觉</Pill>}
        </div>

        {/* 右侧：状态 / 比分 / 强 LIVE 徽标 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {live ? (
            <div className="flex items-center gap-1 rounded bg-live-red/15 px-1.5 py-0.5">
              <LiveDot />
              <span className="font-mono text-[10px] font-extrabold text-live-red tracking-tight">
                LIVE {minute}′
              </span>
            </div>
          ) : (
            <ScoreText
              match={m}
              state={state}
              revealed={revealed}
              spoilerFree={spoilerFree}
              onReveal={e => {
                e.stopPropagation();
                onReveal?.(m.id);
              }}
            />
          )}
        </div>
      </div>

      {/* 第二行：主队队徽+队名 vs 客队队名+队徽（全行舒展，彻底消除截断与内部白线） */}
      <div className="mt-1.5 flex items-center justify-between gap-1">
        {/* 主队 */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Crest id={m.h} size={18} />
          <span
            className="truncate font-headline text-[12px] font-semibold text-text-primary"
            title={teamName(m.h)}
          >
            {teamName(m.h)}
          </span>
        </div>

        {/* VS 分隔符 */}
        <span className="shrink-0 px-1 font-mono text-[10px] font-semibold text-text-dim">vs</span>

        {/* 客队 */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <span
            className="truncate font-headline text-[12px] font-semibold text-text-primary text-right"
            title={teamName(m.a)}
          >
            {teamName(m.a)}
          </span>
          <Crest id={m.a} size={18} />
        </div>
      </div>
    </div>
  );
}
