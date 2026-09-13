import { hm, liveMinute } from '../core/format.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { ts, MATCH_DURATION_MS } from '../core/engine.js';
import { Crest, Chip, LiveDot, ScoreText, SleepBadge, Stars } from './atoms.jsx';
import { IconDerby, IconWarn } from './icons.jsx';

/**
 * 紧凑比赛行
 *
 * 版式对标 FotMob / theScore 的赛程表：**位置即语义，一行一个事实**。
 *
 *   ▌ 03:00   英超 · S2                 ● 63′
 *   ▌         桑德兰 ⚽  vs  ⚽ 阿森纳
 *   └ 2px 联赛色条
 *
 * 相比此前的改动：
 *   1. 联赛从胶囊降为**行首色条 + 文字**，一屏少十几个盒子；色条只表达联赛身份，
 *      不再被复用成"选中/直播"指示器 —— 一个位置只承担一个语义。
 *   2. 第一行标签收敛到最多两个（档位 + 德比/雷区）。此前星级、待定、档位、德比、
 *      警告五个胶囊并排，等于一行里没有主次。
 *   3. 选中用底色，直播用右侧红点与分钟数。去掉渐变底、外发光与 gold-flash。
 *   4. 队名独占第二行完整宽度，中文队名不再被截成「桑…」。
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
  minefield = false
}) {
  const live = state === 'live';
  const minute = live ? liveMinute(ts(m.t), now) : 0;

  const rowBg = live
    ? 'bg-live/[0.07] hover:bg-live/[0.10]'
    : active
      ? 'bg-surface-accent'
      : 'hover:bg-surface-raised';

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
      aria-current={active ? 'true' : undefined}
      className={`relative w-full cursor-pointer select-none overflow-hidden rounded-md py-2 pr-2.5 pl-3 text-left transition-colors ${rowBg}`}
    >
      {/* 联赛身份条 */}
      <span
        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
        style={{ backgroundColor: leagueColor(m.l) }}
        aria-hidden="true"
      />

      <div className="flex gap-2.5">
        {/* 时刻列：固定宽度，让所有行的开球时间纵向对齐 */}
        <span
          className={`w-10 shrink-0 pt-px font-num text-xs font-semibold tabular-nums ${
            live ? 'text-live' : 'text-text-secondary'
          }`}
        >
          {m.tbd ? '--:--' : hm(m.t)}
        </span>

        <div className="min-w-0 flex-1">
          {/* 元信息行 */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-2xs text-text-muted">{leagueName(m.l)}</span>
            {m.tbd ? (
              <span className="shrink-0 text-2xs text-text-faint">时间待定</span>
            ) : (
              <SleepBadge match={m} compact />
            )}
            {star != null && star >= 2 && <Stars star={star} />}
            {rivalry && (
              <span className="inline-flex min-w-0 items-center gap-1 text-2xs text-warn" title={rivalry}>
                <IconDerby size={11} />
                德比
              </span>
            )}
            {minefield && (
              <Chip tone="danger">
                <IconWarn size={11} />
                建议睡觉
              </Chip>
            )}

            <span className="ml-auto shrink-0">
              {live ? (
                <span className="inline-flex items-center gap-1.5">
                  <LiveDot />
                  <span className="font-num text-xs font-semibold tabular-nums text-live">{minute}′</span>
                </span>
              ) : (
                <ScoreText
                  match={m}
                  stalePending={state === 'ended_pending' && !!now && Date.now() - (ts(m.t) + MATCH_DURATION_MS) > 24 * 3600000}
                  state={state}
                  revealed={revealed}
                  spoilerFree={spoilerFree}
                  onReveal={e => {
                    e.stopPropagation();
                    onReveal?.(m.id);
                  }}
                />
              )}
            </span>
          </div>

          {/* 对阵行：独占整行宽度 */}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
              <span className="truncate text-xs font-medium text-text-primary" title={teamName(m.h)}>
                {teamName(m.h)}
              </span>
              <Crest id={m.h} size={16} />
            </div>
            <span className="shrink-0 font-num text-2xs text-text-faint">vs</span>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Crest id={m.a} size={16} />
              <span className="truncate text-xs font-medium text-text-primary" title={teamName(m.a)}>
                {teamName(m.a)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
