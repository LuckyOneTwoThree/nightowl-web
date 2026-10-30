import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  addToQueue,
  markQueueWatched,
  normalizeQueue,
  removeFromQueue,
} from '@core/queue.js';
import type { Match } from '@/types';

export type WatchLaterItem = {
  id: string;
  night: string;
  addedAt: number;
  status: 'pending' | 'watched';
};

type AddResult = {
  ok: boolean;
  added: boolean;
  reason: string;
  queue: WatchLaterItem[];
};

type QueueStore = {
  items: WatchLaterItem[];
  add: (match: Match) => AddResult;
  remove: (id: string) => void;
  markWatched: (id: string) => void;
};

export const useWatchLaterStore = create<QueueStore>()(
  persist(
    (set, get) => ({
      items: [],
      add: match => {
        const result = addToQueue(get().items, match) as AddResult;
        if (result.ok && result.added) set({ items: result.queue });
        return result;
      },
      remove: id => set({ items: removeFromQueue(get().items, id) as WatchLaterItem[] }),
      markWatched: id =>
        set({ items: markQueueWatched(get().items, id) as WatchLaterItem[] }),
    }),
    {
      name: 'nightowl:watchLater:v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ items: state.items }),
      merge: (persisted, current) => {
        const saved = persisted as { items?: unknown[] } | undefined;
        return {
          ...current,
          items: normalizeQueue(saved?.items) as WatchLaterItem[],
        };
      },
    }
  )
);
