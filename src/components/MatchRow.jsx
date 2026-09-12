import { hm, liveMinute, datePart } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts } from '../core/engine.js';
import { Crest, SleepBadge, Stars, Pill, ScoreText, LiveDot } from './atoms.jsx';

/**
 * 紧凑比赛行（三视图共用）
 *
 * 状态呈现规则：
 *   tbd            → 不显示档位徽章（铁律二），显示「时间待定」
 *   live           → 进行分钟 + LIVE 点（不显示比分，见 D3）
 *   ended_pending  → 「待录比分」
 *   done           → 比分（受防剧透控制）
 *   雷区场次        → 弱化样式 + ⚠ 徽章
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

  const border = active
    ? 'border-l-[3px] border-l-primary-gold border-y-border-subtle border-r-border-subtle bg-surface-highlight'
    : isMine
      ? 'border border-dashed border-border-subtle/80 bg-surface-card/40'
      : 'border border-border-subtle bg-surface-card hover:bg-surface-hover';

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      className={`w-full rounded-md px-2.5 py-2 text-left transition-all ${border} ${
        flash ? 'animate-gold-flash' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        {/* 时间 */}
        <div className="w-[42px] shrink-0">
          <span className="font-mono text-[12px] font-semibold tabular-nums text-slate-300">{hm(m.t)}</span>
        </div>

        {/* 对阵 */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Crest id={m.h} size={20} />
          <span className="truncate text-[12px] text-slate-200">{teamName(m.h)}</span>
          <span className="shrink-0 font-mono text-[10px] text-slate-600">vs</span>
          <span className="truncate text-[12px] text-slate-200">{teamName(m.a)}</span>
          <Crest id={m.a} size={20} />
        </div>

        {/* 状态 / 比分 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {live && (
            <>
              <LiveDot />
              <span className="font-mono text-[11px] font-semibold text-live-red">{minute}′</span>
            </>
          )}
          {!live && (
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

      {/* 徽章行 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[50px]">
        {m.tbd ? (
          <Pill>时间待定</Pill>
        ) : (
          <SleepBadge match={m} compact />
        )}
        {star != null && <Stars star={star} />}
        {rivalry && <Pill tone="purple">{rivalry}</Pill>}
        <span className="font-mono text-[9px] text-slate-600">{leagueName(m.l)}</span>
        {isMine && <Pill tone="warn">⚠ 建议睡觉</Pill>}
      </div>
    </button>
  );
}
