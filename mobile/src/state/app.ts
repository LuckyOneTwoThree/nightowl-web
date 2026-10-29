import { create } from 'zustand';

export type DataSource = 'bundled' | 'stored';

type AppStore = {
  rev: number;
  source: DataSource;
  syncing: boolean;
  quickSyncing: boolean;
  syncError: string | null;
  lastCheckedAt: number | null;
  lastSyncedAt: number | null;
  lastSyncErrorAt: number | null;
  revealedIds: Record<string, boolean>;
  bump: (meta?: {
    source?: DataSource;
    checkedAt?: number;
    syncedAt?: number;
  }) => void;
  setSyncing: (value: boolean) => void;
  setQuickSyncing: (value: boolean) => void;
  setSyncError: (message: string | null) => void;
  setMeta: (meta: {
    source?: DataSource;
    lastCheckedAt?: number | null;
    lastSyncedAt?: number | null;
    lastSyncErrorAt?: number | null;
  }) => void;
  revealMatch: (id: string) => void;
  hideMatch: (id: string) => void;
  clearRevealed: () => void;
};

export const useAppStore = create<AppStore>(set => ({
  rev: 0,
  source: 'bundled',
  syncing: false,
  quickSyncing: false,
  syncError: null,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastSyncErrorAt: null,
  revealedIds: {},
  bump: meta =>
    set(state => ({
      rev: state.rev + 1,
      source: meta?.source ?? state.source,
      lastCheckedAt: meta?.checkedAt ?? state.lastCheckedAt,
      lastSyncedAt: meta?.syncedAt ?? state.lastSyncedAt,
      lastSyncErrorAt: null,
    })),
  setSyncing: value => set({ syncing: value }),
  setQuickSyncing: value => set({ quickSyncing: value }),
  setSyncError: message => set({ syncError: message }),
  setMeta: meta =>
    set(state => ({
      source: meta.source ?? state.source,
      lastCheckedAt:
        meta.lastCheckedAt !== undefined ? meta.lastCheckedAt : state.lastCheckedAt,
      lastSyncedAt:
        meta.lastSyncedAt !== undefined ? meta.lastSyncedAt : state.lastSyncedAt,
      lastSyncErrorAt:
        meta.lastSyncErrorAt !== undefined ? meta.lastSyncErrorAt : state.lastSyncErrorAt,
    })),
  revealMatch: id =>
    set(state => ({
      revealedIds: { ...state.revealedIds, [id]: true },
    })),
  hideMatch: id =>
    set(state => {
      const next = { ...state.revealedIds };
      delete next[id];
      return { revealedIds: next };
    }),
  clearRevealed: () => set({ revealedIds: {} }),
}));

export function useDataRev(): number {
  return useAppStore(state => state.rev);
}

export function useMatchRevealed(id: string | undefined, spoilerFree: boolean): boolean {
  const revealed = useAppStore(state => (id ? !!state.revealedIds[id] : false));
  return !spoilerFree || revealed;
}
