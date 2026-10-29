import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { getFixtures } from '@data/index.js';
import { MATCH_DURATION_MS, ts } from '@core/engine.js';
import { useAppStore } from '@/state/app';
import { syncNow } from './run';

const STALE_MS = 10 * 60 * 1000;
const LIVE_STALE_MS = 90 * 1000;
const RECENT_PENDING_STALE_MS = 3 * 60 * 1000;
// 只对仍落在快检窗口内的近期待录场次加速；更早的积压交给显式完整同步。
const RECENT_PENDING_WINDOW_MS = 72 * 60 * 1000;
const FAILED_RETRY_MS = 2 * 60 * 1000;
const CHECK_TICK_MS = 60 * 1000;
const BACKFILL_COOLDOWN_MS = 30 * 60 * 1000;
const BACKFILL_SAME_GAP_RETRY_MS = 6 * 60 * 60 * 1000;
const BACKFILL_WINDOW_MS = 14 * 86400000;

/**
 * 快检只覆盖 72h；更早但仍属于近期的待录比分需要一次完整补扫。
 * 返回具体 ID 指纹：同一批「上游也补不到」的场次不要每 30 分钟重扫一次。
 */
function backfillGapIds(now = Date.now()) {
  const ids: string[] = [];
  for (const match of getFixtures() as Array<{ id?: string; st?: string; tbd?: boolean; t?: string }>) {
    if (match.st !== 'sched' || match.tbd || !match.id) continue;
    const kickoff = ts(match.t);
    if (!Number.isFinite(kickoff)) continue;
    const endedAt = kickoff + MATCH_DURATION_MS;
    if (now > endedAt && now - endedAt <= BACKFILL_WINDOW_MS && now - kickoff > 72 * 3600000) {
      ids.push(match.id);
    }
  }
  return ids.sort();
}

/** 90 秒刷新直播/刚终场，3 分钟刷新近期待录；空闲时回到 10 分钟低频。 */
function staleThreshold(now = Date.now()) {
  let live = false;
  let recentPending = false;
  for (const match of getFixtures() as Array<{ st?: string; tbd?: boolean; t?: string }>) {
    if (match.st !== 'sched' || match.tbd) continue;
    const kickoff = ts(match.t);
    if (!Number.isFinite(kickoff)) continue;
    if (now >= kickoff && now <= kickoff + MATCH_DURATION_MS) {
      live = true;
      break;
    }
    if (now > kickoff + MATCH_DURATION_MS && now - kickoff <= RECENT_PENDING_WINDOW_MS) {
      recentPending = true;
    }
  }
  if (live) return LIVE_STALE_MS;
  if (recentPending) return RECENT_PENDING_STALE_MS;
  return STALE_MS;
}

export function useSyncOnLaunch() {
  // 启动/回前台只做比分快检；只有发现「72h 快检窗口之外、14 天内」的积压待录时，
  // 才在后台追加一次完整补扫。完整同步仍不跟随每次手势。
  const lastBackfillAtRef = useRef(0);
  const lastBackfillGapRef = useRef('');
  const refresh = useCallback(async () => {
    let outcome: Awaited<ReturnType<typeof syncNow>> | null = null;
    try {
      outcome = await syncNow({ quick: true });
    } catch {
      // 快检失败仍可能靠副源完整补扫成功；继续检查积压。
    }
    if (outcome?.busy) return outcome;
    const gapIds = backfillGapIds();
    // 单场长期缺分通常是上游确实没有；不要每次启动都花几十秒重扫，交给「立即同步」。
    if (gapIds.length >= 2) {
      const gapKey = gapIds.join(',');
      const sameGap = gapKey === lastBackfillGapRef.current;
      const wait = sameGap ? BACKFILL_SAME_GAP_RETRY_MS : BACKFILL_COOLDOWN_MS;
      if (Date.now() - lastBackfillAtRef.current > wait) {
        lastBackfillGapRef.current = gapKey;
        lastBackfillAtRef.current = Date.now();
        void syncNow().catch(() => {});
      }
    }
    return outcome;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const last = useAppStore.getState().lastCheckedAt;
      if (!last || Date.now() - last > staleThreshold()) refresh();
    }, 1500);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const { lastCheckedAt, lastSyncErrorAt, syncError } = useAppStore.getState();
      const last = syncError ? lastSyncErrorAt : lastCheckedAt;
      const wait = syncError ? FAILED_RETRY_MS : staleThreshold();
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
      const wait = syncError ? FAILED_RETRY_MS : staleThreshold();
      if (!last || Date.now() - last > wait) refresh();
    }, CHECK_TICK_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { refresh };
}

export function useSyncState() {
  const syncing = useAppStore(state => state.syncing);
  const quickSyncing = useAppStore(state => state.quickSyncing);
  const syncError = useAppStore(state => state.syncError);
  const lastCheckedAt = useAppStore(state => state.lastCheckedAt);
  const lastSyncedAt = useAppStore(state => state.lastSyncedAt);
  const lastSyncErrorAt = useAppStore(state => state.lastSyncErrorAt);
  return { syncing, quickSyncing, syncError, lastCheckedAt, lastSyncedAt, lastSyncErrorAt };
}
