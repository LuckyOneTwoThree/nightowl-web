import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  EMPTY_WEEK_OVERRIDES,
  normalizeWeekOverrides,
  pruneWeekOverridesMap,
  setPinnedMatch,
  toggleBlockedNight,
  toggleExcludedMatch,
  togglePinnedMatch,
} from '@core/week-overrides.js';

export type WeekOverrideEntry = {
  pinnedIds: string[];
  excludedIds: string[];
  blockedNights: string[];
};

function sanitizeWeekTs(
  raw: Record<string, unknown> | undefined,
  minWeekKey?: string | null
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [wk, val] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wk)) continue;
    if (minWeekKey && wk < minWeekKey) continue;
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) out[wk] = n;
  }
  return out;
}

type WeekOverridesStore = {
  byWeek: Record<string, WeekOverrideEntry>;
  updatedAtByWeek: Record<string, number>;
  updatedAt: number | null;
  hydrated: boolean;
  getForWeek: (weekKey: string) => WeekOverrideEntry;
  setPin: (
    weekKey: string,
    matchId: string | number,
    pinned: boolean,
    minWeekKey?: string | null
  ) => boolean;
  togglePin: (weekKey: string, matchId: string | number, minWeekKey?: string | null) => boolean;
  toggleExclude: (weekKey: string, matchId: string | number, minWeekKey?: string | null) => boolean;
  toggleBlockNight: (weekKey: string, dateKey: string, minWeekKey?: string | null) => boolean;
  resetWeek: (weekKey: string) => void;
  replaceByWeek: (
    nextByWeek: Record<string, unknown>,
    minWeekKey?: string | null,
    nextUpdatedAtByWeek?: Record<string, unknown>,
    nextUpdatedAt?: number | null
  ) => void;
  setHydrated: (value: boolean) => void;
};

export const useWeekOverridesStore = create<WeekOverridesStore>()(
  persist(
    (set, get) => ({
      byWeek: {},
      updatedAtByWeek: {},
      updatedAt: null,
      hydrated: false,
      getForWeek: weekKey => {
        if (!weekKey) return EMPTY_WEEK_OVERRIDES as unknown as WeekOverrideEntry;
        return normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
      },
      setPin: (weekKey, matchId, pinned, minWeekKey = null) => {
        if (!weekKey) return false;
        const current = normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
        const next = setPinnedMatch(current, String(matchId), pinned) as WeekOverrideEntry;
        const pinnedNow = next.pinnedIds.includes(String(matchId));
        const nowMs = Date.now();
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            { ...state.byWeek, [weekKey]: next },
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: sanitizeWeekTs(
            { ...state.updatedAtByWeek, [weekKey]: nowMs },
            minWeekKey
          ),
          updatedAt: nowMs,
        }));
        return pinnedNow;
      },
      togglePin: (weekKey, matchId, minWeekKey = null) => {
        if (!weekKey) return false;
        const current = normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
        const next = togglePinnedMatch(current, String(matchId)) as WeekOverrideEntry;
        const pinnedNow = next.pinnedIds.includes(String(matchId));
        const nowMs = Date.now();
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            { ...state.byWeek, [weekKey]: next },
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: sanitizeWeekTs(
            { ...state.updatedAtByWeek, [weekKey]: nowMs },
            minWeekKey
          ),
          updatedAt: nowMs,
        }));
        return pinnedNow;
      },
      toggleExclude: (weekKey, matchId, minWeekKey = null) => {
        if (!weekKey) return false;
        const current = normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
        const next = toggleExcludedMatch(current, String(matchId)) as WeekOverrideEntry;
        const excludedNow = next.excludedIds.includes(String(matchId));
        const nowMs = Date.now();
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            { ...state.byWeek, [weekKey]: next },
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: sanitizeWeekTs(
            { ...state.updatedAtByWeek, [weekKey]: nowMs },
            minWeekKey
          ),
          updatedAt: nowMs,
        }));
        return excludedNow;
      },
      toggleBlockNight: (weekKey, dateKey, minWeekKey = null) => {
        if (!weekKey || !dateKey) return false;
        const current = normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
        const next = toggleBlockedNight(current, dateKey) as WeekOverrideEntry;
        const blockedNow = next.blockedNights.includes(dateKey);
        const nowMs = Date.now();
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            { ...state.byWeek, [weekKey]: next },
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: sanitizeWeekTs(
            { ...state.updatedAtByWeek, [weekKey]: nowMs },
            minWeekKey
          ),
          updatedAt: nowMs,
        }));
        return blockedNow;
      },
      resetWeek: weekKey => {
        if (!weekKey) return;
        const nowMs = Date.now();
        set(state => {
          const copy = { ...state.byWeek };
          delete copy[weekKey];
          return {
            byWeek: copy,
            updatedAtByWeek: { ...state.updatedAtByWeek, [weekKey]: nowMs },
            updatedAt: nowMs,
          };
        });
      },
      replaceByWeek: (nextByWeek, minWeekKey = null, nextUpdatedAtByWeek, nextUpdatedAt) =>
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            nextByWeek || {},
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: nextUpdatedAtByWeek
            ? sanitizeWeekTs(nextUpdatedAtByWeek, minWeekKey)
            : sanitizeWeekTs(state.updatedAtByWeek, minWeekKey),
          updatedAt:
            nextUpdatedAt !== undefined
              ? Number.isFinite(nextUpdatedAt) && (nextUpdatedAt as number) > 0
                ? (nextUpdatedAt as number)
                : null
              : state.updatedAt,
        })),
      setHydrated: value => set({ hydrated: value }),
    }),
    {
      name: 'owl:week-overrides:v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        byWeek: state.byWeek,
        updatedAtByWeek: state.updatedAtByWeek,
        updatedAt: state.updatedAt,
      }),
      merge: (persisted, current) => {
        const saved = persisted as
          | {
              byWeek?: Record<string, unknown>;
              updatedAtByWeek?: Record<string, unknown>;
              updatedAt?: unknown;
            }
          | undefined;
        // Number(null) === 0：persisted 的 null（双未知合并结果）必须先判空，
        // 否则 rehydrate 把「未知」读成 epoch 0，配对时击败对端未知一侧
        const rawGlobalTs = saved?.updatedAt;
        const savedGlobalTs = rawGlobalTs == null ? NaN : Number(rawGlobalTs);
        return {
          ...current,
          byWeek: pruneWeekOverridesMap(saved?.byWeek || {}) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: sanitizeWeekTs(saved?.updatedAtByWeek),
          updatedAt: Number.isFinite(savedGlobalTs) && savedGlobalTs > 0 ? savedGlobalTs : null,
        };
      },
      onRehydrateStorage: () => state => {
        state?.setHydrated(true);
      },
    }
  )
);
