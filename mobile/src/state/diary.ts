import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DIARY_VERSION,
  normalizeDiary,
  removeDiaryEntry,
  upsertDiaryEntry,
} from '@core/diary.js';

export type DiaryEntry = {
  matchId: string;
  mode: 'live' | 'second_half' | 'replay';
  stamp: 'epic' | 'heartbreak' | 'sleepy' | 'disaster';
  note: string;
  recordedAt: number;
  updatedAt: number;
};

export type DiaryState = {
  version: number;
  entries: Record<string, DiaryEntry>;
};

type DiaryStore = {
  diary: DiaryState;
  upsertEntry: (patch: Partial<DiaryEntry> & { matchId: string }) => void;
  removeEntry: (matchId: string) => void;
  importDiary: (raw: unknown) => void;
};

const EMPTY_DIARY: DiaryState = {
  version: DIARY_VERSION,
  entries: {},
};

export const useDiaryStore = create<DiaryStore>()(
  persist(
    set => ({
      diary: EMPTY_DIARY,
      upsertEntry: patch =>
        set(state => ({
          diary: upsertDiaryEntry(state.diary, patch, Date.now()) as DiaryState,
        })),
      removeEntry: matchId =>
        set(state => ({
          diary: removeDiaryEntry(state.diary, matchId) as DiaryState,
        })),
      importDiary: raw =>
        set({
          diary: normalizeDiary(raw) as DiaryState,
        }),
    }),
    {
      name: 'nightowl_diary_v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    }
  )
);
