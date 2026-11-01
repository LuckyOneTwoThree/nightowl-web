/**
 * 单场「最后检查时间」记录
 *
 * 为什么需要单独一份：`/api/scores/status` 里的 lastSync 是**全局**的
 * "最后一轮同步什么时候跑的"，它回答不了「我盯的这场到底查没查过」。
 * 而用户点「重查该场」之后最想知道的就是这一点。
 *
 * 判定"查过"的口径：一次成功同步会把该联赛该日期的上游数据拉一遍，
 * 因此凡是 `已经过了完赛时间且仍无比分` 的场次，本轮都确实被查过 —— 这是诚实的近似，
 * 不假装能精确到单场请求（多源合并后无法逐场回溯请求轨迹）。
 *
 * 落在 userData，与 fixtures 同目录；30 天外自动丢弃，上限 800 条。
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { userDataDir } from './data-store.js';

const FILE = 'score-checks.json';
const MAX_AGE_MS = 30 * 86400000;
const MAX_ENTRIES = 800;

function filePath() {
  try {
    return resolve(userDataDir(), FILE);
  } catch {
    return null;
  }
}

/** 读取有效记录（丢弃过期项） */
export function loadChecks(now = Date.now()) {
  const file = filePath();
  if (!file) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [id, ts] of Object.entries(raw)) {
      if (typeof id === 'string' && id && Number.isFinite(ts) && now - ts <= MAX_AGE_MS) out[id] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

function saveChecks(map) {
  const file = filePath();
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(map), 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    console.warn('[checks] 写入失败（不影响同步）:', err?.message || err);
  }
}

/** 记录一批场次在本轮被检查过 */
export function recordChecks(ids, at = Date.now()) {
  const list = Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && id) : [];
  if (!list.length) return loadChecks(at);
  const map = loadChecks(at);
  for (const id of list) map[id] = at;
  // 控制体积：按最近时间保留前 N 条
  const trimmed = Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ENTRIES)
  );
  saveChecks(trimmed);
  return trimmed;
}

/** 取指定场次的检查时间（未记录过的不出现在结果里） */
export function checksFor(ids, now = Date.now()) {
  const want = new Set(Array.isArray(ids) ? ids : []);
  if (!want.size) return {};
  const map = loadChecks(now);
  const out = {};
  for (const id of want) if (map[id]) out[id] = map[id];
  return out;
}
