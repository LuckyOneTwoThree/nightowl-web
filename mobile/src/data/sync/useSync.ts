import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { useAppStore } from '@/state/app';
import { syncNow } from './run';

const STALE_MS = 10 * 60 * 1000;
const FAILED_RETRY_MS = 2 * 60 * 1000;
const CHECK_TICK_MS = 60 * 1000;

export function useSyncOnLaunch() {
  // 启动/回前台只做比分快检。完整同步仍保留在「我的 → 立即同步」和
  // 首页失败重试里，避免 25s 超时 × 多次重试的完整链路占住首页状态。
  const refresh = useCallback(async () => {
    try {
      return await syncNow({ quick: true });
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const last = useAppStore.getState().lastCheckedAt;
      if (!last || Date.now() - last > STALE_MS) refresh();
    }, 1500);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const { lastCheckedAt, lastSyncErrorAt, syncError } = useAppStore.getState();
      const last = syncError ? lastSyncErrorAt : lastCheckedAt;
      const wait = syncError ? FAILED_RETRY_MS : STALE_MS;
      if (!last || Date.now() - last > wait) refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // 失败后的短退避：不能把失败当成 10 分钟「已检查」，否则用户要等一整个周期。
  // 只在应用前台轮询；后台不做网络请求。
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const { lastCheckedAt, lastSyncErrorAt, syncError } = useAppStore.getState();
      const last = syncError ? lastSyncErrorAt : lastCheckedAt;
      const wait = syncError ? FAILED_RETRY_MS : STALE_MS;
      if (!last || Date.now() - last > wait) refresh();
    }, CHECK_TICK_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { refresh };
}

export function useSyncState() {
  const syncing = useAppStore(state => state.syncing);
  const syncError = useAppStore(state => state.syncError);
  const lastCheckedAt = useAppStore(state => state.lastCheckedAt);
  const lastSyncedAt = useAppStore(state => state.lastSyncedAt);
  const lastSyncErrorAt = useAppStore(state => state.lastSyncErrorAt);
  return { syncing, syncError, lastCheckedAt, lastSyncedAt, lastSyncErrorAt };
}
