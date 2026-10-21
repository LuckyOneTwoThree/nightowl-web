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
};

let inFlight: Promise<SyncOutcome> | null = null;

export function syncNow(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;

  const app = useAppStore.getState();
  app.setSyncing(true);
  app.setSyncError(null);

  const task = (async (): Promise<SyncOutcome> => {
    const fixtures = getFixtures();
    const result = await syncScores({ fixtures, rules, log: console });

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
    useAppStore.getState().bump({ source, checkedAt, syncedAt: checkedAt });

    return {
      changed,
      checkedAt,
      errors: result.errors ?? [],
      stats: result.stats ?? {},
      months: result.months ?? [],
    };
  })();

  inFlight = task;

  return task
    .catch(error => {
      useAppStore
        .getState()
        .setSyncError(error instanceof Error ? error.message : String(error));
      throw error;
    })
    .finally(() => {
      useAppStore.getState().setSyncing(false);
      inFlight = null;
    });
}
