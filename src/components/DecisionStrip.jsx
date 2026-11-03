import { bjClock, hm } from '../core/format.js';
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
  const reason = REASON_COPY[decision.reason] || '';

  const endLabel = match.tbd || decision.endAt == null ? '待定' : `${bjClock(decision.endAt, false)} 结束`;

  const costLabel = (() => {
    if (!decision.sleepKnown) return '未开睡眠账本';
    if (decision.costMinutes > 0) return `欠 ${hoursOf(decision.costMinutes)}`;
    return '不欠睡眠';
  })();

  return (
    <section
      aria-label="今晚决策结论"
      className="rounded-lg border border-line-hairline bg-surface-panel/55 px-2.5 py-2"
    >
      {/* 列数按容器宽度决定，不按视口：这一条放在 330px 的左栏里，
          视口断点（sm:grid-cols-4）会让四段各挤成 70px 换行，把 Hero 撑高一截。 */}
      <div className="grid gap-x-3 gap-y-1.5 [grid-template-columns:repeat(auto-fit,minmax(118px,1fr))]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-2xs text-text-faint">结论</span>
          <span className={`truncate text-xs font-bold ${verdict.tone}`}>
            {verdict.label}
            {reason && <span className="ml-1 font-normal text-text-faint">· {reason}</span>}
          </span>
        </div>

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
              className="truncate text-left text-xs font-semibold text-accent underline-offset-2 hover:underline"
            >
              {costLabel} → 去开启
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
