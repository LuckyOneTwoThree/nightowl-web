import { bjClock, hm } from '../core/format.js';
import { sleepTier } from '../core/engine.js';
import { teamName } from '../data/index.js';

/**
 * 决策条 · 全屏唯一结论条
 *
 * 只回答四件事：值不值得看、几点结束、欠多少睡眠、有没有更轻的一场。
 * 指数本身仍只出现在 Hero 顶部（data-hero-index），这里不再重复大数字。
 *
 * 同一屏只出现一次；移动端是同一份语义的两行两列版本。
 */

const VERDICT_COPY = {
  recommended: { label: '值得熬', tone: 'text-accent' },
  neutral: { label: '可看可不看', tone: 'text-text-secondary' },
  defer: { label: '建议换一场', tone: 'text-live' },
  unknown: { label: '暂时无法判断', tone: 'text-text-faint' }
};

const REASON_COPY = {
  followed: '关注球队',
  highlight: '今晚焦点',
  'lighter-alternative': '有更轻的同夜场',
  'below-floor': '看完低于底线',
  'low-index': '看点一般',
  tbd: '时间未定',
  invalid: '时间无效',
  'missing-index': '缺少指数'
};

/**
 * 文案表对外导出：情报面板的「结论」单元格必须与决策条逐字一致 ——
 * 同一个语义在两处用不同措辞，用户会以为是两个判断。
 */
export { VERDICT_COPY, REASON_COPY };

/** 低于底线时保留“关注球队”这个原因，再补上真正的代价。 */
export function reasonTextOf(decision) {
  if (!decision) return '';
  if (decision.belowFloor && decision.followed) return '关注球队 · 看完低于底线';
  return REASON_COPY[decision.reason] || '';
}

function hoursOf(minutes) {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h.toFixed(h === Math.round(h) ? 0 : 1)}h`;
}

function Segment({ label, children, muted = false }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-2xs text-text-faint">{label}</span>
      <span
        className={`truncate font-num text-xs font-semibold tabular-nums ${
          muted ? 'text-text-muted' : 'text-text-primary'
        }`}
      >
        {children}
      </span>
    </div>
  );
}

export default function DecisionStrip({ decision, match, alternative, onSelectAlternative, onOpenSettings }) {
  if (!decision || !match) return null;
  const verdict = VERDICT_COPY[decision.verdict] || VERDICT_COPY.unknown;
  const reason = reasonTextOf(decision);

  const endLabel = match.tbd || decision.endAt == null ? '待定' : bjClock(decision.endAt, false);
  const tierLabel = match.tbd ? null : sleepTier(match.t).label;

  const costLabel = (() => {
    if (!decision.sleepKnown) return '未开睡眠账本';
    if (decision.costMinutes > 0) return `欠 ${hoursOf(decision.costMinutes)}${tierLabel ? ` · ${tierLabel}` : ''}`;
    return '不欠睡眠';
  })();

  return (
    <section aria-label="今晚决策结论" className="px-0.5 pt-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="sr-only">结论</span>
        <span className={`shrink-0 text-sm font-semibold ${verdict.tone}`}>{verdict.label}</span>
        {reason && <span className="min-w-0 truncate text-2xs text-text-faint">{reason}</span>}
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <Segment label="结束" muted={match.tbd}>
          {endLabel}
        </Segment>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-2xs text-text-faint">睡眠代价</span>
          {decision.sleepKnown ? (
            <span
              className={`truncate font-num text-xs font-semibold tabular-nums ${
                decision.costMinutes > 0 ? 'text-text-primary' : 'text-text-muted'
              }`}
            >
              {costLabel}
            </span>
          ) : (
            <button
              type="button"
              onClick={onOpenSettings}
              title="点击开启个人睡眠账本"
              className="truncate text-left text-xs font-semibold text-accent underline-offset-2 hover:underline"
            >
              未开睡眠账本
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-2xs text-text-faint">同夜替代</span>
          {alternative ? (
            <button
              type="button"
              onClick={() => onSelectAlternative?.(alternative.m.id)}
              className="truncate text-left text-xs font-semibold text-accent underline-offset-2 hover:underline"
              title={`${teamName(alternative.m.h)} vs ${teamName(alternative.m.a)}`}
            >
              {`换 ${hm(alternative.m.t)} 那场`}
            </button>
          ) : (
            <span className="truncate text-xs font-semibold text-text-faint">—</span>
          )}
        </div>
      </div>
    </section>
  );
}
