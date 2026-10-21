import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Prefs = {
  followedTeams: string[];
  followedLeagues: string[];
  weeklyBudget: number;
  spoilerFree: boolean;
  notifyBefore15: boolean;
  notifyLiveEvents: boolean;
  theme: 'dark';
  onboardingDone: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  followedTeams: [],
  followedLeagues: ['PL'],
  weeklyBudget: 4,
  spoilerFree: true,
  notifyBefore15: true,
  notifyLiveEvents: true,
  theme: 'dark',
  onboardingDone: false,
};

type PrefsStore = {
  prefs: Prefs;
  hydrated: boolean;
  setPrefs: (patch: Partial<Prefs>) => void;
  toggleTeam: (id: string) => void;
  toggleLeague: (code: string) => void;
  setBudget: (hours: number) => void;
  finishOnboarding: () => void;
  restartOnboarding: () => void;
  setHydrated: (value: boolean) => void;
};

export const usePrefsStore = create<PrefsStore>()(
  persist(
    set => ({
      prefs: DEFAULT_PREFS,
      hydrated: false,
      setPrefs: patch => set(state => ({ prefs: { ...state.prefs, ...patch } })),
      toggleTeam: id =>
        set(state => {
          const existing = state.prefs.followedTeams;
          const followedTeams = existing.includes(id)
            ? existing.filter(team => team !== id)
            : [...existing, id];
          return { prefs: { ...state.prefs, followedTeams } };
        }),
      toggleLeague: code =>
        set(state => {
          const existing = state.prefs.followedLeagues;
          const followedLeagues = existing.includes(code)
            ? existing.filter(league => league !== code)
            : [...existing, code];
          return { prefs: { ...state.prefs, followedLeagues } };
        }),
      setBudget: hours =>
        set(state => ({ prefs: { ...state.prefs, weeklyBudget: hours } })),
      finishOnboarding: () =>
        set(state => ({ prefs: { ...state.prefs, onboardingDone: true } })),
      restartOnboarding: () =>
        set(state => ({ prefs: { ...state.prefs, onboardingDone: false } })),
      setHydrated: value => set({ hydrated: value }),
    }),
    {
      name: 'nightowl:prefs:v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ prefs: state.prefs }),
      merge: (persisted, current) => {
        const saved = persisted as { prefs?: Partial<Prefs> } | undefined;
        return {
          ...current,
          prefs: { ...DEFAULT_PREFS, ...(saved?.prefs || {}) },
        };
      },
      onRehydrateStorage: () => state => {
        state?.setHydrated(true);
      },
    }
  )
);

export function usePrefs(): Prefs {
  return usePrefsStore(state => state.prefs);
}

export function usePrefsHydrated(): boolean {
  return usePrefsStore(state => state.hydrated);
}
