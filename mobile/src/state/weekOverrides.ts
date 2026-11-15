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
    if (Number.isFinite(n) && n >= 0) out[wk] = n;
  }
  return out;
}

type WeekOverridesStore = {
  byWeek: Record<string, WeekOverrideEntry>;
  updatedAtByWeek: Record<string, number>;
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
    nextUpdatedAtByWeek?: Record<string, unknown>
  ) => void;
  setHydrated: (value: boolean) => void;
};

export const useWeekOverridesStore = create<WeekOverridesStore>()(
  persist(
    (set, get) => ({
      byWeek: {},
      updatedAtByWeek: {},
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
          };
        });
      },
      replaceByWeek: (nextByWeek, minWeekKey = null, nextUpdatedAtByWeek) =>
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            nextByWeek || {},
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: nextUpdatedAtByWeek
            ? sanitizeWeekTs(nextUpdatedAtByWeek, minWeekKey)
            : sanitizeWeekTs(state.updatedAtByWeek, minWeekKey),
        })),
      setHydrated: value => set({ hydrated: value }),
    }),
    {
      name: 'owl:week-overrides:v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ byWeek: state.byWeek, updatedAtByWeek: state.updatedAtByWeek }),
      merge: (persisted, current) => {
        const saved = persisted as
          | { byWeek?: Record<string, unknown>; updatedAtByWeek?: Record<string, unknown> }
          | undefined;
        return {
          ...current,
          byWeek: pruneWeekOverridesMap(saved?.byWeek || {}) as Record<string, WeekOverrideEntry>,
          updatedAtByWeek: sanitizeWeekTs(saved?.updatedAtByWeek),
        };
      },
      onRehydrateStorage: () => state => {
        state?.setHydrated(true);
      },
    }
  )
);
