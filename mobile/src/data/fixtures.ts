import { File, Paths } from 'expo-file-system';
import {
  buildFixturesDiff,
  fixtures,
  fixturesMeta,
  getFixtures,
  mergeFixtures,
  setFixtures,
} from '@data/index.js';
import { MATCH_DURATION_MS, ts } from '@core/engine.js';

import { useAppStore, type DataSource } from '@/state/app';

const FIXTURES_FILE = 'nightowl-fixtures.json';
const META_FILE = 'nightowl-meta.json';

export type FixtureMeta = {
  updatedAt: string;
  count: number;
  season?: string | null;
  writer?: 'sparse' | 'dense';
  builtinRev?: string | null;
};

function fixturesFile(): File {
  return new File(Paths.document, FIXTURES_FILE);
}

function metaFile(): File {
  return new File(Paths.document, META_FILE);
}

export function readMeta(): FixtureMeta | null {
  try {
    const file = metaFile();
    if (!file.exists) return null;
    const parsed = JSON.parse(file.textSync()) as FixtureMeta;
    if (!parsed?.updatedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadStoredFixtures(): Promise<{
  loaded: boolean;
  meta: FixtureMeta | null;
}> {
  try {
    const file = fixturesFile();
    if (!file.exists) {
      useAppStore.getState().setMeta({ source: 'bundled' });
      return { loaded: false, meta: null };
    }

    const meta = readMeta();
    const builtinSeason =
      typeof fixturesMeta?.season === 'string' && fixturesMeta.season ? fixturesMeta.season : null;
    const userSeason =
      typeof meta?.season === 'string' && meta.season ? meta.season : null;

    // 跨赛季隔离：赛季切换时不与上季数据合并，将旧用户文件归档保留后退回新内置快照
    if (builtinSeason && userSeason && builtinSeason !== userSeason) {
      const safe = userSeason.replace(/[^\w.-]/g, '_');
      let archive = new File(Paths.document, `nightowl-fixtures-${safe}.bak.json`);
      if (archive.exists) {
        archive = new File(Paths.document, `nightowl-fixtures-${safe}-${Date.now()}.bak.json`);
      }
      await file.move(archive, { overwrite: true });
      useAppStore.getState().setMeta({ source: 'bundled' });
      return { loaded: false, meta: null };
    }

    const parsed = JSON.parse(file.textSync());
    const writer: 'sparse' | 'dense' = meta?.writer === 'sparse' ? 'sparse' : 'dense';
    const valid =
      Array.isArray(parsed) &&
      (writer === 'sparse' || parsed.length > 0) &&
      parsed.every(
        item =>
          item &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          (writer === 'sparse' || typeof item.t === 'string')
      );
    if (!valid) {
      throw new Error('本地赛程数据不完整');
    }

    const builtinRev = typeof fixturesMeta?.rev === 'string' ? fixturesMeta.rev : null;
    const merged = mergeFixtures(fixtures, parsed, { writer, builtinRev });
    if (!setFixtures(merged)) {
      throw new Error('合并后的赛程数据不完整');
    }
    useAppStore.getState().setMeta({
      source: 'stored',
      lastCheckedAt: meta?.updatedAt ? Date.parse(meta.updatedAt) : null,
      lastSyncedAt: meta?.updatedAt ? Date.parse(meta.updatedAt) : null,
    });
    return { loaded: true, meta };
  } catch (error) {
    console.warn('[fixtures] 读取本地数据失败，沿用内置快照', error);
    useAppStore.getState().setMeta({ source: 'bundled' });
    return { loaded: false, meta: null };
  }
}

export async function saveFixtures(next: unknown[]): Promise<{ ok: boolean; reason?: string }> {
  try {
    const file = fixturesFile();
    let prevUser: object[] = [];
    if (file.exists) {
      try {
        const prevParsed = JSON.parse(file.textSync());
        if (Array.isArray(prevParsed)) prevUser = prevParsed;
      } catch {
        // 旧文件损坏时重新计算完整差分
      }
    }

    const nowIso = new Date().toISOString();
    const { out } = buildFixturesDiff(fixtures, next as object[], prevUser, nowIso);

    // 先写临时文件再整体替换：直接覆盖时进程被杀会留下半截 JSON，
    // 下次启动只能回退内置快照，已同步的比分全部丢失。
    const tmp = new File(Paths.document, `${FIXTURES_FILE}.tmp`);
    if (!tmp.exists) tmp.create();
    await tmp.write(JSON.stringify(out));
    await tmp.move(file, { overwrite: true });

    const meta = metaFile();
    if (!meta.exists) meta.create();
    const body: FixtureMeta = {
      updatedAt: nowIso,
      count: next.length,
      season: typeof fixturesMeta?.season === 'string' ? fixturesMeta.season : null,
      writer: 'sparse',
      builtinRev: typeof fixturesMeta?.rev === 'string' ? fixturesMeta.rev : null,
    };
    await meta.write(JSON.stringify(body));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export type Freshness = {
  source: DataSource;
  lastScoreAt: string | null;
  staleHours: number | null;
  pendingCount: number;
  stalePendingCount: number;
  liveCount: number;
};

export function freshnessOf(
  fixtures: any[] = getFixtures(),
  now = Date.now(),
  source: DataSource = useAppStore.getState().source
): Freshness {
  let lastScoreTs = 0;
  let pendingCount = 0;
  let stalePendingCount = 0;
  let liveCount = 0;

  for (const m of fixtures) {
    const kickoff = ts(m.t);
    if (Number.isNaN(kickoff)) continue;
    if (m.st === 'done' && m.sc) lastScoreTs = Math.max(lastScoreTs, kickoff);
    if (m.st === 'sched' && !m.tbd) {
      if (now > kickoff + MATCH_DURATION_MS) {
        pendingCount++;
        // 只有已经同步到本地后，超过 24h 仍无比分才说明上游没提供；
        // 内置快照本身可能落后，别把「还没同步」误报成「上游缺分」。
        if (source === 'stored' && now - (kickoff + MATCH_DURATION_MS) > 24 * 3600000) {
          stalePendingCount++;
        }
      } else if (now >= kickoff && now <= kickoff + MATCH_DURATION_MS) liveCount++;
    }
  }

  return {
    source,
    lastScoreAt: lastScoreTs ? new Date(lastScoreTs).toISOString() : null,
    staleHours: lastScoreTs ? +((now - lastScoreTs - MATCH_DURATION_MS) / 3600000).toFixed(1) : null,
    pendingCount,
    stalePendingCount,
    liveCount,
  };
}
