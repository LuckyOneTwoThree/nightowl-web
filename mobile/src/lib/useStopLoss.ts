import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ignoreStopLoss,
  markStopLossPrompted,
  shouldStopLossPrompt,
  sleepStopLoss,
  snoozeStopLoss,
  stopLossNightKey,
} from '@core/stop-loss.js';
import type { Match } from '@/types';
import type { Prefs } from '@/state/prefs';
import { useWatchLaterStore } from '@/state/queue';

const KEY = 'nightowl:stopLoss:v1';

type NightState = {
  status: string;
  snoozeUntil: number;
  snoozeCount: number;
};

type StopLossContext = {
  night: string;
  ledger: any;
  match: Match;
};

type SleepPrefs = Pick<Prefs, 'sleepEnabled' | 'sleepWakeTime' | 'sleepMinHours'>;

export function useStopLossPrompt(
  match: Match | null,
  prefs: SleepPrefs,
  now: number,
  enabled = true
) {
  const [states, setStates] = useState<Record<string, NightState>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const [loaded, setLoaded] = useState(false);
  const [context, setContext] = useState<StopLossContext | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const addWatchLater = useWatchLaterStore(state => state.add);
  const markWatchLaterWatched = useWatchLaterStore(state => state.markWatched);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then(raw => {
        if (!alive || !raw) return;
        const saved = JSON.parse(raw) as Record<string, NightState>;
        if (saved && typeof saved === 'object') setStates(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const writeState = useCallback((night: string, state: NightState) => {
    const next = { ...statesRef.current, [night]: state };
    statesRef.current = next;
    setStates(next);
    void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // 切场收起上一场的卡片，避免旧场次提示覆盖新场次。
  useEffect(() => {
    setContext(null);
    setNotice(null);
  }, [match?.id]);

  useEffect(() => {
    if (enabled) return;
    setContext(null);
    setNotice(null);
  }, [enabled]);

  // 首页与比赛详情各自持有 hook；重新聚焦时同步一次持久化状态，
  // 避免另一个页面已经提示/跳过，当前页面仍按旧状态重复弹卡。
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoaded(false);
    AsyncStorage.getItem(KEY)
      .then(raw => {
        if (!alive || !raw) return;
        const saved = JSON.parse(raw) as Record<string, NightState>;
        if (saved && typeof saved === 'object') setStates(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !loaded || !match || !prefs.sleepEnabled || context) return;
    const night = stopLossNightKey(match);
    if (!night) return;
    const profile = {
      enabled: true,
      wakeTime: prefs.sleepWakeTime,
      minSleep: prefs.sleepMinHours,
    };
    const prompt = shouldStopLossPrompt(match, profile, now, states[night] as any);
    if (!prompt) return;
    setContext({ ...prompt, match } as StopLossContext);
    setNotice(null);
    writeState(night, markStopLossPrompted(states[night] as any) as NightState);
  }, [enabled, loaded, match, prefs.sleepEnabled, prefs.sleepWakeTime, prefs.sleepMinHours, now, states, context, writeState]);

  useEffect(() => {
    if (!context) return;
    if (now > context.ledger.endTs) {
      setContext(null);
      setNotice(null);
    }
  }, [now, context]);

  const sleep = useCallback(() => {
    if (!context) return;
    const result = addWatchLater(context.match);
    if (!result?.ok) {
      setNotice(
        result?.reason === 'full'
          ? '补看队列已满，请先在「我的 → 明早补看」移除旧条目'
          : '加入补看失败'
      );
      return;
    }
    writeState(context.night, sleepStopLoss(statesRef.current[context.night]) as NightState);
    setContext(null);
    setNotice(null);
  }, [context, addWatchLater, writeState]);

  const snooze = useCallback(() => {
    if (!context) return;
    writeState(context.night, snoozeStopLoss(statesRef.current[context.night]) as NightState);
    setContext(null);
    setNotice(null);
  }, [context, writeState]);

  const ignore = useCallback(() => {
    if (!context) return;
    markWatchLaterWatched(context.match.id);
    writeState(context.night, ignoreStopLoss(statesRef.current[context.night]) as NightState);
    setContext(null);
    setNotice(null);
  }, [context, markWatchLaterWatched, writeState]);

  return { context, notice, sleep, snooze, ignore };
}
