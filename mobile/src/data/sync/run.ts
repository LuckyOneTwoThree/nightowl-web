import { getFixtures, setFixtures } from '@data/index.js';
import rules from '../../shared/server/rules.json';

import { saveFixtures } from '@/data/fixtures';
import { classifySyncOutcome } from '@core/sync-outcome.js';
import { useAppStore } from '@/state/app';

import { applyPatches, syncScores as syncScoresRaw, validateFixtures } from './scores.js';

const syncScores = syncScoresRaw as (options: Record<string, unknown>) => Promise<any>;

export type SyncStatus =
  | 'not_needed'
  | 'up_to_date'
  | 'updated'
  | 'partial_failure'
  | 'failed';

export type SyncOutcome = {
  status: SyncStatus;
  changed: number;
  checkedAt: number;
  errors: unknown[];
  stats: Record<string, number>;
  months: string[];
  quick: boolean;
  attempted: boolean;
  /** 完整同步正在进行，快检没有等待它，直接返回 busy */
  busy?: boolean;
};

type SyncOptions = { quick?: boolean; silent?: boolean };

let inFlight: Promise<SyncOutcome> | null = null;
let inFlightQuick = false;

export function syncNow(options: SyncOptions = {}): Promise<SyncOutcome> {
  const quick = !!options.quick;
  // 自动补扫不占用首页的「正在更新比分…」状态：它可能跑几十秒，
  // 但用户没有发起同步，不该被一个常驻 spinner 误认为卡死。
  const silent = !quick && !!options.silent;

  if (inFlight) {
    // 完整同步在飞时，下拉快检不能陪它一起等：手势应立即结束，
    // 由完整同步在后台继续写盘。否则用户会看到“正在检查比分…”卡很久。
    if (quick && !inFlightQuick) {
      return Promise.resolve({
        status: 'not_needed',
        changed: 0,
        checkedAt: Date.now(),
        errors: [],
        stats: {},
        months: [],
        quick: true,
        attempted: false,
        busy: true
      });
    }
    // 已在跑的快检：复用同一个任务，不能把它升级成完整同步状态。
    if (quick) return inFlight;
    if (inFlightQuick) {
      // 用户显式点了完整同步：先告诉界面“正在更新”，等快检结束后再启动完整同步
      if (!silent) useAppStore.getState().setSyncing(true);
      return inFlight.catch(() => undefined).then(() => syncNow(options));
    }
    if (!silent) {
      useAppStore.getState().setSyncing(true);
      // 原任务可能是静默补扫，它不会在 finally 里清 syncing；
      // 由这次显式请求的包装器负责归还状态，并把失败暴露给用户。
      return inFlight
        .catch(error => {
          useAppStore
            .getState()
            .setSyncError(error instanceof Error ? error.message : String(error));
          useAppStore.getState().setMeta({ lastSyncErrorAt: Date.now() });
          throw error;
        })
        .finally(() => useAppStore.getState().setSyncing(false));
    }
    return inFlight;
  }

  const app = useAppStore.getState();
  if (quick) {
    app.setQuickSyncing(true);
  } else if (!silent) {
    app.setSyncing(true);
    app.setSyncError(null);
  }
  inFlightQuick = quick;

  const task = (async (): Promise<SyncOutcome> => {
    const fixtures = getFixtures();
    // 移动端固定 ESPN 单源：这里没有桌面端的 curl 兜底，openfootball 的整季文件
    // 在弱网/受限网络下会连续超时，把一轮同步拖到截止时间之后，用户只看到
    // 状态灯常亮和“上游未提供”。ESPN 已覆盖当前待录场次；桌面端仍保留多源。
    const result = await syncScores({
      fixtures,
      rules,
      log: console,
      quick,
      sources: ['espn']
    });

    let changed = 0;
    let source = useAppStore.getState().source;

    if (result.patches.size > 0) {
      const applied = applyPatches(fixtures, result.patches);
      const issues = validateFixtures(applied.fixtures);
      if (issues.length) {
        throw new Error(issues.join('；'));
      }

      const saved = await saveFixtures(applied.fixtures);
      if (!saved.ok) {
        throw new Error(saved.reason || '写入本地数据失败');
      }

      setFixtures(applied.fixtures);
      changed = applied.changed;
      source = 'stored';
    }

    const checkedAt = Date.now();
    const attempted = result.attempted !== false;
    const errors = result.errors ?? [];
    const fullySuccessful = attempted && errors.length === 0;
    const status = classifySyncOutcome({
      attempted,
      changed,
      errors: errors.length,
    }) as SyncStatus;

    if (changed > 0) {
      // 部分失败时补丁已经落盘，必须刷新界面，但不要把 lastCheckedAt
      // 当成「完整成功」推进；lastSyncErrorAt 单独记录失败时间。
      useAppStore.getState().bump({
        source,
        ...(fullySuccessful ? { checkedAt } : {}),
        syncedAt: checkedAt,
      });
    } else if (fullySuccessful || status === 'not_needed') {
      // 健康检查无变化也必须推进 lastCheckedAt，否则每次回前台都会再查一次；
      // 只更新时间、不递增 rev，避免整页数据重算。
      useAppStore.getState().setMeta({ lastCheckedAt: checkedAt });
    }

    if (status === 'failed' || status === 'partial_failure') {
      const message =
        status === 'partial_failure'
          ? `部分来源失败（${errors.length} 个），已保留成功补丁`
          : `同步失败（${errors.length} 个来源未返回有效数据）`;
      // 后台静默补扫失败不劫持首页错误条；用户没有发起这次同步。
      if (!silent) {
        useAppStore.getState().setSyncError(message);
        useAppStore.getState().setMeta({ lastSyncErrorAt: checkedAt });
      }
    } else if (attempted || status === 'not_needed') {
      // 成功（包括静默补扫）也要清掉之前留下的错误条，否则用户会一直看到
      // 一次早已恢复的「比分同步失败」。
      useAppStore.getState().setSyncError(null);
      useAppStore.getState().setMeta({ lastSyncErrorAt: null });
    }

    return {
      status,
      changed,
      checkedAt,
      errors,
      stats: result.stats ?? {},
      months: result.months ?? [],
      quick,
      attempted,
    };
  })();

  const tracked = task
    .catch(error => {
      if (!silent) {
        useAppStore
          .getState()
          .setSyncError(error instanceof Error ? error.message : String(error));
        useAppStore.getState().setMeta({ lastSyncErrorAt: Date.now() });
      }
      throw error;
    })
    .finally(() => {
      if (quick) useAppStore.getState().setQuickSyncing(false);
      else if (!silent) useAppStore.getState().setSyncing(false);
      inFlight = null;
      inFlightQuick = false;
    });

  inFlight = tracked;
  return tracked;
}
