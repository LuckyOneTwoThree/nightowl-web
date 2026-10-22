import { getFixtures, setFixtures } from '@data/index.js';
import rules from '../../shared/server/rules.json';

import { saveFixtures } from '@/data/fixtures';
import { useAppStore } from '@/state/app';

import { applyPatches, syncScores as syncScoresRaw, validateFixtures } from './scores.js';

const syncScores = syncScoresRaw as (options: Record<string, unknown>) => Promise<any>;

export type SyncOutcome = {
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

type SyncOptions = { quick?: boolean };

let inFlight: Promise<SyncOutcome> | null = null;
let inFlightQuick = false;

export function syncNow(options: SyncOptions = {}): Promise<SyncOutcome> {
  const quick = !!options.quick;

  if (inFlight) {
    // 完整同步在飞时，下拉快检不能陪它一起等：手势应立即结束，
    // 由完整同步在后台继续写盘。否则用户会看到“正在检查比分…”卡很久。
    if (quick && !inFlightQuick) {
      return Promise.resolve({
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
    if (!quick && inFlightQuick) {
      // 用户显式点了完整同步：先告诉界面“正在更新”，等快检结束后再启动完整同步
      useAppStore.getState().setSyncing(true);
      return inFlight.catch(() => undefined).then(() => syncNow());
    }
    if (!quick) useAppStore.getState().setSyncing(true);
    return inFlight;
  }

  if (!quick) {
    const app = useAppStore.getState();
    app.setSyncing(true);
    app.setSyncError(null);
  }
  inFlightQuick = quick;

  const task = (async (): Promise<SyncOutcome> => {
    const fixtures = getFixtures();
    const result = await syncScores({ fixtures, rules, log: console, quick });

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
    const attempted = !!result.attempted;
    const errors = result.errors ?? [];
    if (changed > 0) {
      useAppStore.getState().bump({ source, checkedAt, syncedAt: checkedAt });
    } else {
      // 快检无变化也必须推进 lastCheckedAt，否则每次回前台都会再查一次；
      // 只更新时间、不递增 rev，避免整页数据重算。
      useAppStore.getState().setMeta({ lastCheckedAt: checkedAt });
    }
    if (quick && attempted && errors.length === 0) {
      useAppStore.getState().setSyncError(null);
    }

    return {
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
      useAppStore
        .getState()
        .setSyncError(error instanceof Error ? error.message : String(error));
      throw error;
    })
    .finally(() => {
      if (!quick) useAppStore.getState().setSyncing(false);
      inFlight = null;
      inFlightQuick = false;
    });

  inFlight = tracked;
  return tracked;
}
