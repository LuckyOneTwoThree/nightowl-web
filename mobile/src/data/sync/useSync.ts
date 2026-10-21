import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { useAppStore } from '@/state/app';
import { syncNow } from './run';

const STALE_MS = 10 * 60 * 1000;

export function useSyncOnLaunch() {
  const refresh = useCallback(async () => {
    try {
      return await syncNow();
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
      const last = useAppStore.getState().lastCheckedAt;
      if (!last || Date.now() - last > STALE_MS) refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return { refresh };
}

export function useSyncState() {
  const syncing = useAppStore(state => state.syncing);
  const syncError = useAppStore(state => state.syncError);
  const lastCheckedAt = useAppStore(state => state.lastCheckedAt);
  const lastSyncedAt = useAppStore(state => state.lastSyncedAt);
  return { syncing, syncError, lastCheckedAt, lastSyncedAt };
}
