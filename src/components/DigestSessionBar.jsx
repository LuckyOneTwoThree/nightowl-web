import { hm } from '../core/format.js';
import { leagueName, teamName } from '../data/index.js';
import { useReviewStatus } from '../hooks/useReviewStatus.js';
import { Button, Meta } from './atoms.jsx';
import { IconChevronLeft, IconChevronRight } from './icons.jsx';

/**
 * 连续补看会话条
 *
 * 早晨摘要的主行动从「稍后再看」换成「开始依序补看」之后，用户需要一个**始终知道自己在哪**的
 * 位置指示：第几场、还有几场、怎么跳过。这条常驻在舞台上方，而不是回到摘要里逐条点。
 *
 * 关于「不可补看」：回顾资源是逐场异步查询的，请求回来之前谁也不知道有没有。
 * 所以这里不提前判断，只等 `useReviewStatus` 收到**两边都是 empty**的事实后才改口 ——
 * 改口时把主行动换成「标记已看，看下一场」，并把原因写在旁边，
 * 不把用户留在一个只有失败提示的空页面上。
 */
export default function DigestSessionBar({
  match,
  position,
  onPrev,
  onNext,
  onMarkWatchedAndNext,
  onExit,
  marking = false
}) {
  const review = useReviewStatus(match?.id || null);
  if (!match || !position || position.total < 1) return null;

  // 只有两边都明确「没有」才算没有资源；loading / error / idle 都不下结论
  const noReview = review.recap === 'empty' && review.highlights === 'empty';
  const index = position.index + 1;

  return (
    <section
      aria-label="连续补看"
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-line-hairline bg-surface-panel/85 px-3 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Meta className="shrink-0">连续补看</Meta>
        <span className="shrink-0 font-num text-xs font-semibold tabular-nums text-text-primary">
          第 {index} / {position.total} 场
        </span>
        <span className="text-text-faint" aria-hidden="true">·</span>
        <span className="min-w-0 truncate text-xs text-text-secondary">
          {leagueName(match.l)} · {hm(match.t)} · {teamName(match.h)} vs {teamName(match.a)}
        </span>
        {position.watchedCount > 0 && (
          <Meta className="shrink-0">已看 {position.watchedCount}</Meta>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="xs" onClick={onPrev} disabled={!position.hasPrev}>
          <IconChevronLeft size={12} />
          上一场
        </Button>
        <Button variant="ghost" size="xs" onClick={onNext} disabled={!position.hasNext}>
          下一场
          <IconChevronRight size={12} />
        </Button>
        <Button variant="primary" size="xs" onClick={onMarkWatchedAndNext} disabled={marking}>
          {marking ? '标记中…' : noReview ? '没有回顾，看下一场' : '标记已看，看下一场'}
        </Button>
        <Button variant="ghost" size="xs" onClick={onExit}>
          结束补看
        </Button>
      </div>

      {noReview && (
        <p className="w-full text-2xs leading-relaxed text-warn">
          这场上游没有回顾资源（文字事件与官方集锦都为空）。可以直接标记已看，顺序不会乱。
        </p>
      )}
    </section>
  );
}
