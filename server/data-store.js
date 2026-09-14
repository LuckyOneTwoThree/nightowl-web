/**
 * fixtures 数据的落点层
 *
 * 背景（实测暴露的产品缺口）：数据一直是只读快照 —— 安装版放在 Program Files，
 * 保鲜同步即使拿到新比分也写不回去，于是「刚结束的比赛永远显示待录比分」。
 * 现在把落点分成两层：
 *
 *   · 内置快照  ROOT/src/data/fixtures.json（打包后在只读安装目录，出厂数据）
 *   · 用户数据  process.env.NIGHTOWL_USER_DATA/fixtures.json（可写，保鲜写入）
 *
 * 读取优先级：用户数据 > 内置快照。
 * 桌面端由 main.cjs 把 app.getPath('userData') 注入 NIGHTOWL_USER_DATA。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ts, MATCH_DURATION_MS } from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUILT_IN = resolve(ROOT, 'src/data/fixtures.json');

/** 用户可写目录（桌面端注入；未注入时自动回落到本地 server/cache/user-data） */
export function userDataDir() {
  const d = process.env.NIGHTOWL_USER_DATA;
  if (d && String(d).trim()) return String(d).trim();
  // 本地服务/开发模式自动回落至 server/cache/user-data，确保保鲜写入能力在全环境生效
  return resolve(ROOT, 'server/cache/user-data');
}

export function userFixturesPath() {
  const d = userDataDir();
  return d ? resolve(d, 'fixtures.json') : null;
}

/** 当前生效的数据文件（用户优先，否则内置） */
export function activeFixturesPath() {
  const p = userFixturesPath();
  return p && existsSync(p) ? p : BUILT_IN;
}

export async function loadFixtures() {
  const raw = await readFile(activeFixturesPath(), 'utf8');
  return JSON.parse(raw);
}

/**
 * 写入用户数据目录。返回 { ok, path, bytes }；
 * 没有可写目录（如纯本地 server 模式未注入 userData）时返回 ok:false，
 * 由调用方降级为「只预览」而不是把应用搞崩。
 */
export function saveFixtures(next) {
  const p = userFixturesPath();
  if (!p) {
    return { ok: false, reason: '未配置可写的数据目录（NIGHTOWL_USER_DATA 未注入）' };
  }
  const body = JSON.stringify(next);
  try {
    // 原子写：先写临时文件再重命名，避免写一半崩溃导致数据损坏
    const tmp = `${p}.tmp`;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, p);
    return { ok: true, path: p, bytes: Buffer.byteLength(body) };
  } catch (err) {
    return { ok: false, reason: err.message, path: p };
  }
}

/**
 * 数据新鲜度：给界面用，避免用户以为「应用坏了」——
 * 其实是数据旧。返回最后比分时间、落后场数、来源。
 */
export function freshness(fixtures, nowTs = Date.now()) {
  let lastScoreTs = 0;
  let stale = 0;
  let live = 0;
  for (const m of fixtures) {
    const t = ts(m.t);
    if (Number.isNaN(t)) continue;
    if (m.st === 'done' && m.sc) lastScoreTs = Math.max(lastScoreTs, t);
    if (m.st === 'sched' && !m.tbd && nowTs > t + MATCH_DURATION_MS) stale++;
    else if (m.st === 'sched' && !m.tbd && nowTs >= t && nowTs <= t + MATCH_DURATION_MS) live++;
  }
  return {
    source: activeFixturesPath() === BUILT_IN ? 'builtin' : 'user',
    lastScoreAt: lastScoreTs ? new Date(lastScoreTs).toISOString() : null,
    staleHours: lastScoreTs ? +((nowTs - lastScoreTs) / 3600000).toFixed(1) : null,
    pendingCount: stale,
    liveCount: live,
    writable: !!userFixturesPath()
  };
}
