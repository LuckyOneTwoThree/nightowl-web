import { hm, liveMinute } from '../core/format.js';
import { teamName, leagueName, leagueColor } from '../data/index.js';
import { ts, MATCH_DURATION_MS } from '../core/engine.js';
import { Crest, Chip, LiveDot, ScoreText, SleepBadge } from './atoms.jsx';
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
function parseWinner(sc) {
  if (!sc || !/^\d+-\d+$/.test(sc)) return null;
  const [h, a] = sc.split('-').map(Number);
  if (h > a) return 'h';
  if (a > h) return 'a';
  return 'd';
}

export default function MatchRow({
  m,
  state,
  active = false,
  now,
  onSelect,
  spoilerFree = true,
  revealed = false,
  onReveal,
  rivalry = null,
  minefield = false,
  dateLabel = null,
  badge = null,
  showSleep = true,
  followedTeams = [],
  index = null
}) {
  const live = state === 'live';
  const minute = live ? liveMinute(ts(m.t), now) : 0;
  const homeFollowed = followedTeams.includes(m.h);
  const awayFollowed = followedTeams.includes(m.a);
  const scoreShown = m.st === 'done' && (!spoilerFree || revealed);
  const winner = scoreShown ? parseWinner(m.sc) : null;

  const rowBg = active
    ? 'bg-surface-raised border border-accent/35 shadow-card'
    : live
      ? 'bg-surface-card/90 border border-live/25 hover:border-live/40'
      : 'border border-transparent hover:border-line-hairline hover:bg-surface-raised/60';

  // 单行标签上限：最多展示 1 个高优状态标签（外部自定义 badge > 雷区 > 德比），避免满行胶囊挤压
  const primaryTag =
    badge ||
    (minefield ? (
      <span title="凌晨低性价比场次，建议优先休息">
        <Chip tone="warn">
          <IconWarn size={11} />
          雷区
        </Chip>
      </span>
    ) : rivalry ? (
      <span className="inline-flex min-w-0 items-center gap-1 text-2xs font-medium text-warn" title={rivalry}>
        <IconDerby size={11} />
        德比
      </span>
    ) : null);

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
      className={`relative w-full cursor-pointer select-none overflow-hidden rounded-lg py-2 pr-3 pl-3.5 text-left transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${rowBg}`}
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
          className={`w-11 shrink-0 pt-px font-num text-xs font-semibold tabular-nums ${
            live ? 'text-live' : 'text-text-secondary'
          }`}
        >
          {m.tbd ? '--:--' : hm(m.t)}
        </span>

        <div className="min-w-0 flex-1">
          {/* 第一行：元信息与夜猫指数（严禁使用 ★ 星号混淆看点星级） */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-text-muted">{leagueName(m.l)}</span>
            {dateLabel && <span className="shrink-0 text-xs text-text-faint">{dateLabel}</span>}
            {m.tbd ? (
              <span className="shrink-0 text-xs text-text-faint">待定</span>
            ) : (
              showSleep && <SleepBadge match={m} compact />
            )}
            {primaryTag}

            <span className="ml-auto shrink-0">
              {live ? (
                <span className="inline-flex items-center gap-1.5">
                  <LiveDot />
                  <span className="font-num text-xs font-semibold tabular-nums text-live">{minute}′</span>
                </span>
              ) : state === 'sched' && index != null ? (
                <span
                  className="inline-flex items-baseline gap-1 font-num text-xs font-semibold tabular-nums"
                  title="夜猫指数"
                  aria-label={`夜猫指数 ${index.toFixed(1)}`}
                >
                  <span className="text-2xs font-normal text-text-faint">指数</span>
                  <span className={index >= 8 ? 'text-accent' : 'text-text-secondary'}>
                    {index.toFixed(1)}
                  </span>
                </span>
              ) : scoreShown ? (
                <span className="text-2xs text-text-faint">终场</span>
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

          {/* 第二行：对阵主视觉（13px text-sm + 18px 队徽） */}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
              {homeFollowed && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  title="关注球队"
                  aria-hidden="true"
                />
              )}
              <span
                className={`truncate text-sm ${
                  winner === 'h'
                    ? 'font-semibold text-text-primary'
                    : winner === 'a'
                      ? 'font-normal text-text-muted'
                      : 'font-medium text-text-primary'
                }`}
                title={teamName(m.h)}
              >
                {teamName(m.h)}
              </span>
              <Crest id={m.h} size={18} />
            </div>

            {scoreShown ? (
              <span
                className={`shrink-0 rounded bg-surface-raised px-1.5 py-px font-num text-xs font-bold tabular-nums text-text-primary ${
                  spoilerFree && revealed ? 'animate-score-pop inline-block' : ''
                }`}
              >
                {m.sc || '—'}
              </span>
            ) : m.st === 'done' && spoilerFree && !revealed ? (
              <span className="shrink-0 font-num text-xs text-text-faint" title="比分已隐藏">
                • : •
              </span>
            ) : (
              <span className="shrink-0 font-num text-xs text-text-faint">vs</span>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Crest id={m.a} size={18} />
              <span
                className={`truncate text-sm ${
                  winner === 'a'
                    ? 'font-semibold text-text-primary'
                    : winner === 'h'
                      ? 'font-normal text-text-muted'
                      : 'font-medium text-text-primary'
                }`}
                title={teamName(m.a)}
              >
                {teamName(m.a)}
              </span>
              {awayFollowed && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  title="关注球队"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
