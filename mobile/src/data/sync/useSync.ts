import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
const BACKFILL_META_KEY = 'nightowl:sync:backfill:v3';

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
  // 才在后台追加一次完整补扫。完整同步不跟随手势，也不占用首页的同步状态。
  const backfillMetaRef = useRef({ at: 0, gap: '' });
  const backfillMetaPromiseRef = useRef<Promise<void> | null>(null);
  const backfillRetryAtRef = useRef(0);

  useEffect(() => {
    backfillMetaPromiseRef.current = AsyncStorage.getItem(BACKFILL_META_KEY)
      .then(raw => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { at?: number; gap?: string };
        backfillMetaRef.current = {
          at: Number.isFinite(saved?.at) ? Number(saved.at) : 0,
          gap: typeof saved?.gap === 'string' ? saved.gap : '',
        };
      })
      .catch(() => {})
      .finally(() => {});
  }, []);

  const refresh = useCallback(async () => {
    let outcome: Awaited<ReturnType<typeof syncNow>> | null = null;
    try {
      outcome = await syncNow({ quick: true });
    } catch {
      // 快检失败仍可能靠副源完整补扫成功；继续检查积压。
    }
    if (outcome?.busy) return outcome;

    // 等持久化的补扫冷却读出来，避免每次冷启动都重扫同一批积压。
    await backfillMetaPromiseRef.current?.catch(() => {});

    const gapIds = backfillGapIds();
    // 单场也会补：ESPN 单源完整同步已压到约 20–30 秒，且冷却持久化，
    // 不会因为一场上游确实缺分而每次启动都重扫。
    if (gapIds.length >= 1 && Date.now() >= backfillRetryAtRef.current) {
      const gapKey = gapIds.join(',');
      const meta = backfillMetaRef.current;
      const sameGap = gapKey === meta.gap;
      const wait = sameGap ? BACKFILL_SAME_GAP_RETRY_MS : BACKFILL_COOLDOWN_MS;
      if (Date.now() - meta.at > wait) {
        // 先在内存里占位，防止本轮 60s tick 又触发一次；
        // 成功完成后再把结果持久化，进程被杀时下次仍会重试。
        backfillMetaRef.current = { at: Date.now(), gap: gapKey };
        void syncNow({ silent: true })
          .then(outcome => {
            if (outcome.status === 'failed' || outcome.status === 'partial_failure') {
              // 弱网下部分来源失败：不落 6 小时冷却，5 分钟后允许再试。
              backfillMetaRef.current = { at: 0, gap: gapKey };
              backfillRetryAtRef.current = Date.now() + 5 * 60 * 1000;
              return;
            }
            const remaining = backfillGapIds();
            const next = {
              at: Date.now(),
              gap: remaining.length ? remaining.join(',') : '',
            };
            backfillMetaRef.current = next;
            backfillRetryAtRef.current = 0;
            void AsyncStorage.setItem(
              BACKFILL_META_KEY,
              JSON.stringify(next)
            ).catch(() => {});
          })
          .catch(() => {
            // 失败不落 6 小时冷却；5 分钟后允许再试，避免一次弱网把待录锁死。
            backfillMetaRef.current = { at: 0, gap: gapKey };
            backfillRetryAtRef.current = Date.now() + 5 * 60 * 1000;
          });
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
