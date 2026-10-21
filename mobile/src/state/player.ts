import { create } from 'zustand';

import type { StreamLine } from '@/data/useLiveSources';
import type { Match } from '@/types';

type PlayerSession = {
  match: Match;
  lines: StreamLine[];
  activeId: string | null;
};

type PlayerStore = {
  session: PlayerSession | null;
  start: (session: PlayerSession) => void;
  setActive: (id: string) => void;
  clear: () => void;
};

export const usePlayerStore = create<PlayerStore>(set => ({
  session: null,
  start: session => set({ session }),
  setActive: id =>
    set(state =>
      state.session ? { session: { ...state.session, activeId: id } } : state
    ),
  clear: () => set({ session: null }),
}));
