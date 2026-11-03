import { useCallback, useRef, useState } from 'react';
import {
  addToQueue,
  markQueueWatched,
  normalizeQueue,
  removeFromQueue,
  toggleQueue
} from '../core/queue.js';
import { loadWatchLater, saveWatchLater } from '../components/watch-later-storage.js';

/**
 * 明早补看队列（单一事实源）
 *
 * 从 App.jsx 抽出：这段是「一个 state + 一个 ref + 四个写操作」的样板，
 * 放进组件会让 App 越来越难读。队列的读写语义全部在 core/queue.js，
 * 这里只负责持久化与避免陈旧闭包（commit 前先读 ref 最新值）。
 *
 * @returns {{
 *   watchLater: Array,
 *   addWatchLater: (match: object) => object,
 *   toggleWatchLater: (match: object) => object,
 *   removeWatchLater: (id: string) => void,
 *   markWatchLaterWatched: (id: string) => void,
 *   commitWatchLater: (next: Array) => Array
 * }}
 */
export function useWatchLater() {
  const [watchLater, setWatchLater] = useState(() => loadWatchLater());
  const ref = useRef(watchLater);
  ref.current = watchLater;

  const commitWatchLater = useCallback(next => {
    const normalized = normalizeQueue(next);
    ref.current = normalized;
    setWatchLater(normalized);
    saveWatchLater(normalized);
    return normalized;
  }, []);

  const addWatchLater = useCallback(
    match => {
      const result = addToQueue(ref.current, match);
      if (result.ok && result.added) commitWatchLater(result.queue);
      return result;
    },
    [commitWatchLater]
  );

  /**
   * 补看按钮的唯一入口：未加入 -> 加入；待看 -> 移出；已看 -> 恢复待看。
   * 组件不再各自保存 queued，避免同一场比赛在不同入口出现不同状态。
   */
  const toggleWatchLater = useCallback(
    match => {
      const result = toggleQueue(ref.current, match);
      if (result.ok) commitWatchLater(result.queue);
      return result;
    },
    [commitWatchLater]
  );

  const removeWatchLater = useCallback(
    id => {
      commitWatchLater(removeFromQueue(ref.current, id));
    },
    [commitWatchLater]
  );

  const markWatchLaterWatched = useCallback(
    id => {
      commitWatchLater(markQueueWatched(ref.current, id));
    },
    [commitWatchLater]
  );

  return {
    watchLater,
    addWatchLater,
    toggleWatchLater,
    removeWatchLater,
    markWatchLaterWatched,
    commitWatchLater
  };
}
