import { create } from 'zustand';

export type DataSource = 'bundled' | 'stored';

type AppStore = {
  rev: number;
  source: DataSource;
  syncing: boolean;
  syncError: string | null;
  lastCheckedAt: number | null;
  lastSyncedAt: number | null;
  bump: (meta?: {
    source?: DataSource;
    checkedAt?: number;
    syncedAt?: number;
  }) => void;
  setSyncing: (value: boolean) => void;
  setSyncError: (message: string | null) => void;
  setMeta: (meta: { source?: DataSource; lastCheckedAt?: number | null; lastSyncedAt?: number | null }) => void;
};

export const useAppStore = create<AppStore>(set => ({
  rev: 0,
  source: 'bundled',
  syncing: false,
  syncError: null,
  lastCheckedAt: null,
  lastSyncedAt: null,
  bump: meta =>
    set(state => ({
      rev: state.rev + 1,
      source: meta?.source ?? state.source,
      lastCheckedAt: meta?.checkedAt ?? state.lastCheckedAt,
      lastSyncedAt: meta?.syncedAt ?? state.lastSyncedAt,
    })),
  setSyncing: value => set({ syncing: value }),
  setSyncError: message => set({ syncError: message }),
  setMeta: meta =>
    set(state => ({
      source: meta.source ?? state.source,
      lastCheckedAt:
        meta.lastCheckedAt !== undefined ? meta.lastCheckedAt : state.lastCheckedAt,
      lastSyncedAt:
        meta.lastSyncedAt !== undefined ? meta.lastSyncedAt : state.lastSyncedAt,
    })),
}));

export function useDataRev(): number {
  return useAppStore(state => state.rev);
}
