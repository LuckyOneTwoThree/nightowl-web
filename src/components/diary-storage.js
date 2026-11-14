/**
 * 观赛情绪印章本机持久化（localStorage：nightowl_diary_v1）
 */
import { DIARY_VERSION, normalizeDiary, removeDiaryEntry, upsertDiaryEntry } from '../core/diary.js';

const KEY = 'nightowl_diary_v1';

export function loadDiary() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: DIARY_VERSION, entries: {} };
    return normalizeDiary(JSON.parse(raw));
  } catch {
    return { version: DIARY_VERSION, entries: {} };
  }
}

export function saveDiary(diary) {
  const clean = normalizeDiary(diary);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* 隐私/无痕模式兜底 */
  }
  return clean;
}

export function applyDiaryPatch(prev, patch, nowTs = Date.now()) {
  return saveDiary(upsertDiaryEntry(prev, patch, nowTs));
}

export function deleteDiaryEntry(prev, matchId) {
  return saveDiary(removeDiaryEntry(prev, matchId));
}
