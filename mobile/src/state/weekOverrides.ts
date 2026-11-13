import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  EMPTY_WEEK_OVERRIDES,
  normalizeWeekOverrides,
  pruneWeekOverridesMap,
  toggleBlockedNight,
  toggleExcludedMatch,
  togglePinnedMatch,
} from '@core/week-overrides.js';

export type WeekOverrideEntry = {
  pinnedIds: string[];
  excludedIds: string[];
  blockedNights: string[];
};

type WeekOverridesStore = {
  byWeek: Record<string, WeekOverrideEntry>;
  hydrated: boolean;
  getForWeek: (weekKey: string) => WeekOverrideEntry;
  togglePin: (weekKey: string, matchId: string | number, minWeekKey?: string | null) => boolean;
  toggleExclude: (weekKey: string, matchId: string | number, minWeekKey?: string | null) => boolean;
  toggleBlockNight: (weekKey: string, dateKey: string, minWeekKey?: string | null) => boolean;
  resetWeek: (weekKey: string) => void;
  setHydrated: (value: boolean) => void;
};

export const useWeekOverridesStore = create<WeekOverridesStore>()(
  persist(
    (set, get) => ({
      byWeek: {},
      hydrated: false,
      getForWeek: weekKey => {
        if (!weekKey) return EMPTY_WEEK_OVERRIDES as unknown as WeekOverrideEntry;
        return normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
      },
      togglePin: (weekKey, matchId, minWeekKey = null) => {
        if (!weekKey) return false;
        const current = normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
        const next = togglePinnedMatch(current, String(matchId)) as WeekOverrideEntry;
        const pinnedNow = next.pinnedIds.includes(String(matchId));
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            { ...state.byWeek, [weekKey]: next },
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
        }));
        return pinnedNow;
      },
      toggleExclude: (weekKey, matchId, minWeekKey = null) => {
        if (!weekKey) return false;
        const current = normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
        const next = toggleExcludedMatch(current, String(matchId)) as WeekOverrideEntry;
        const excludedNow = next.excludedIds.includes(String(matchId));
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            { ...state.byWeek, [weekKey]: next },
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
        }));
        return excludedNow;
      },
      toggleBlockNight: (weekKey, dateKey, minWeekKey = null) => {
        if (!weekKey || !dateKey) return false;
        const current = normalizeWeekOverrides(get().byWeek[weekKey]) as WeekOverrideEntry;
        const next = toggleBlockedNight(current, dateKey) as WeekOverrideEntry;
        const blockedNow = next.blockedNights.includes(dateKey);
        set(state => ({
          byWeek: pruneWeekOverridesMap(
            { ...state.byWeek, [weekKey]: next },
            minWeekKey as null | undefined
          ) as Record<string, WeekOverrideEntry>,
        }));
        return blockedNow;
      },
      resetWeek: weekKey => {
        if (!weekKey) return;
        set(state => {
          const copy = { ...state.byWeek };
          delete copy[weekKey];
          return { byWeek: copy };
        });
      },
      setHydrated: value => set({ hydrated: value }),
    }),
    {
      name: 'owl:week-overrides:v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ byWeek: state.byWeek }),
      merge: (persisted, current) => {
        const saved = persisted as { byWeek?: Record<string, unknown> } | undefined;
        return {
          ...current,
          byWeek: pruneWeekOverridesMap(saved?.byWeek || {}) as Record<string, WeekOverrideEntry>,
        };
      },
      onRehydrateStorage: () => state => {
        state?.setHydrated(true);
      },
    }
  )
);
