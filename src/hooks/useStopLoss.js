import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ignoreStopLoss,
  markStopLossPrompted,
  shouldStopLossPrompt,
  sleepStopLoss,
  snoozeStopLoss,
  stopLossNightKey
} from '../core/stop-loss.js';
import { loadStopLossStates, saveStopLossStates } from '../components/stop-loss-storage.js';

/**
 * 止损提醒（只在前台、到达个人止损点且比赛尚未结束时出现）
 *
 * 从 App.jsx 抽出：状态（三份）+ 两个 effect（触发 / 过期收起）+ 三个动作
 * 原本散落在组件各段，读起来要来回跳。这里把「什么时候弹、弹了怎么处理」
 * 收成一处；判定逻辑仍全部在 core/stop-loss.js，hook 不自己造判据。
 *
 * @param {object} p
 * @param {string|null} p.activeMatchId  当前选中场次 id（切场时收起旧提示）
 * @param {object|null} p.activeMatch    当前选中场次对象
 * @param {number} p.clockTs             30 秒粒度时钟
 * @param {object} p.prefs               偏好（sleepEnabled / sleepWakeTime / sleepMinHours）
 * @param {boolean} p.blocked           任一全屏浮层打开时禁止弹出
 * @param {Function} p.addWatchLater     加补看队列
 * @param {Function} p.markWatchLaterWatched 标记已看
 */
export function useStopLoss({
  activeMatchId,
  activeMatch,
  clockTs,
  prefs,
  blocked,
  addWatchLater,
  markWatchLaterWatched
}) {
  const [stopLossStates, setStopLossStates] = useState(() => loadStopLossStates());
  const statesRef = useRef(stopLossStates);
  statesRef.current = stopLossStates;

  const [stopLossContext, setStopLossContext] = useState(null);
  const [stopLossNotice, setStopLossNotice] = useState(null);
  const [stopPlaybackRequest, setStopPlaybackRequest] = useState(0);

  const commitStopLoss = useCallback((night, state) => {
    const next = { ...statesRef.current, [night]: state };
    statesRef.current = next;
    setStopLossStates(next);
    saveStopLossStates(next);
  }, []);

  // 切换比赛时收起上一场的提示，避免旧止损卡停留在新场次上。
  useEffect(() => {
    setStopLossContext(null);
    setStopLossNotice(null);
  }, [activeMatchId]);

  // 到达止损点且比赛未结束 → 弹提示
  useEffect(() => {
    if (!activeMatch || !prefs.sleepEnabled || stopLossContext || blocked) return;
    const night = stopLossNightKey(activeMatch);
    if (!night) return;
    const profile = {
      enabled: true,
      wakeTime: prefs.sleepWakeTime,
      minSleep: prefs.sleepMinHours
    };
    const prompt = shouldStopLossPrompt(activeMatch, profile, clockTs, stopLossStates[night]);
    if (!prompt) return;
    setStopLossContext({ ...prompt, match: activeMatch });
    setStopLossNotice(null);
    commitStopLoss(night, markStopLossPrompted(stopLossStates[night]));
  }, [
    activeMatch, clockTs, prefs.sleepEnabled, prefs.sleepWakeTime, prefs.sleepMinHours,
    stopLossStates, stopLossContext, blocked, commitStopLoss
  ]);

  // 已过结束时间 → 收起
  useEffect(() => {
    if (!stopLossContext) return;
    if (clockTs > stopLossContext.ledger.endTs) {
      setStopLossContext(null);
      setStopLossNotice(null);
    }
  }, [clockTs, stopLossContext]);

  const handleStopLossSleep = useCallback(() => {
    if (!stopLossContext) return;
    const result = addWatchLater(stopLossContext.match);
    if (!result?.ok) {
      setStopLossNotice('补看队列已满，请先在「偏好与数据 → 明早补看」移除旧条目');
      return;
    }
    commitStopLoss(stopLossContext.night, sleepStopLoss(statesRef.current[stopLossContext.night]));
    // 先落队列与止损状态，再通知 PlayerStage 停止；即便播放器已卸载，也只是多一次无效请求。
    setStopPlaybackRequest(value => value + 1);
    setStopLossContext(null);
    setStopLossNotice(null);
  }, [stopLossContext, addWatchLater, commitStopLoss]);

  const handleStopLossSnooze = useCallback(() => {
    if (!stopLossContext) return;
    commitStopLoss(
      stopLossContext.night,
      snoozeStopLoss(statesRef.current[stopLossContext.night])
    );
    setStopLossContext(null);
    setStopLossNotice(null);
  }, [stopLossContext, commitStopLoss]);

  const handleStopLossIgnore = useCallback(() => {
    if (!stopLossContext) return;
    markWatchLaterWatched(stopLossContext.match.id);
    commitStopLoss(
      stopLossContext.night,
      ignoreStopLoss(statesRef.current[stopLossContext.night])
    );
    setStopLossContext(null);
    setStopLossNotice(null);
  }, [stopLossContext, markWatchLaterWatched, commitStopLoss]);

  return {
    stopLossContext,
    stopLossNotice,
    stopPlaybackRequest,
    handleStopLossSleep,
    handleStopLossSnooze,
    handleStopLossIgnore
  };
}
