import { useEffect, useState } from 'react';

/**
 * 赛后回顾资源的可用性广播
 *
 * 为什么需要这一层：`/api/recap` 与 `/api/highlights` 都是**逐场异步**取数，
 * 「这场有没有回顾资源」在请求回来之前无人知道。连续补看会话因此不能提前筛掉
 * 不可补看的场次 —— 那是猜。正确做法是等事实到达：两个面板本来就知道自己的状态，
 * 上报一次，会话条据此当场改口，而不是让用户点进去看到一个空页面。
 *
 * 为什么不让会话条自己拉一遍接口：那会为同一个 matchId 再打两次上游
 * （recap 走的是 ESPN summary，没有本地缓存），既慢又没必要。
 */

const EVENT = 'nightowl:review-status';

/** 由 RecapTimeline / HighlightsPanel 在状态变化时调用（必须放在 effect 里，不要在 render 期派发） */
export function reportReviewStatus(kind, matchId, status) {
  if (!matchId || !kind) return;
  window.dispatchEvent(
    new CustomEvent(EVENT, { detail: { kind, matchId, status } })
  );
}

/**
 * 订阅某一场的回顾资源状态。
 * 返回 `{ recap, highlights }`，各自是 idle / loading / ready / empty / error 之一。
 * 只关心「确定没有」：两边都是 empty 才算这场没有回顾资源。
 */
export function useReviewStatus(matchId) {
  const [status, setStatus] = useState({});

  useEffect(() => {
    setStatus({});
    if (!matchId) return undefined;
    const onReport = event => {
      const detail = event?.detail;
      if (!detail || detail.matchId !== matchId) return;
      setStatus(prev => (prev[detail.kind] === detail.status ? prev : { ...prev, [detail.kind]: detail.status }));
    };
    window.addEventListener(EVENT, onReport);
    return () => window.removeEventListener(EVENT, onReport);
  }, [matchId]);

  return status;
}
