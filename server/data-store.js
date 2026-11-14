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

import { accessSync, constants, existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts, MATCH_DURATION_MS } from '../src/core/engine.js';
import { mergeFixtures, buildFixturesDiff } from '../src/data/index.js';

export { mergeFixtures };

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

/**
 * 赛季元数据 —— 解决「跨赛季 id 撞车」。
 *
 * fixtures 的 id 形如 `PL-1-ARS-COV`，**不含赛季**；JSON 顶层是裸数组，没有 season 字段。
 * 于是每年夏天都会撞一次：
 *
 *   新赛季内置: PL-1-ARS-COV  2027-08-15  sched
 *   上季用户文件: PL-1-ARS-COV  2026-08-16  done 3-0
 *   合并结果:    上季比分污染新赛季，且 activeSyncTargets 对 done+sc 硬跳过 → 永不纠正，
 *                还会一起污染积分榜（按联赛聚合，不看赛季）。
 *
 * 为什么单独一个文件而不是改进 fixtures.json：后者是**裸数组**契约，全仓 12+ 个消费点
 * （src/data/index.js、tools/*.mjs、手机共享层）直接按数组用；改成对象要处处解包，
 * 老用户机器上的 userData 也是数组。独立 meta 文件零改动、且天然向后兼容——
 * 读不到 meta 就当「同一赛季」，老用户行为不变。
 */
const BUILT_IN_META = resolve(ROOT, 'src/data/fixtures-meta.json');

export function userMetaPath() {
  const d = userDataDir();
  return d ? resolve(d, 'fixtures-meta.json') : null;
}

/** 内置快照的赛季（由 `npm run sync:scores:apply` 写盘时盖章；读不到返回 null） */
export function builtinSeason() {
  try {
    const meta = JSON.parse(readFileSync(BUILT_IN_META, 'utf8'));
    return typeof meta?.season === 'string' && meta.season ? meta.season : null;
  } catch {
    return null;
  }
}

/** 内置快照的修订时刻（sync-scores --apply 盖章）；读不到返回 null */
export function builtinRev() {
  try {
    const meta = JSON.parse(readFileSync(BUILT_IN_META, 'utf8'));
    return typeof meta?.rev === 'string' && meta.rev ? meta.rev : null;
  } catch {
    return null;
  }
}

export function loadUserMeta() {
  const p = userMetaPath();
  if (!p || !existsSync(p)) return null;
  try {
    const meta = JSON.parse(readFileSync(p, 'utf8'));
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

function saveUserMeta(season, extra = {}) {
  const p = userMetaPath();
  if (!p) return false;
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ season, savedAt: new Date().toISOString(), ...extra }),
      'utf8'
    );
    return true;
  } catch {
    return false;
  }
}

/** 停用旧赛季用户数据：改名归档（不删除），返回归档路径或 null */
function archiveUserFixtures(oldSeason) {
  const p = userFixturesPath();
  if (!p || !existsSync(p)) return null;
  const safe = String(oldSeason || 'unknown').replace(/[^\w.-]/g, '_');
  let target = resolve(dirname(p), `fixtures-${safe}.bak.json`);
  if (existsSync(target)) {
    // 同赛季多次归档：加时间戳，绝不覆盖上一次的备份
    target = resolve(dirname(p), `fixtures-${safe}-${Date.now()}.bak.json`);
  }
  try {
    renameSync(p, target);
    return target;
  } catch {
    return null;
  }
}

/**
 * 数据目录是否真的可写。
 *
 * 只看「路径存在」会恒为 true（本地开发总会回落 server/cache/user-data），
 * 于是设置页永远显示「可写」、同步按钮永远可用，写盘失败时用户没有任何预兆。
 */
export function canWriteUserData() {
  const p = userFixturesPath();
  if (!p) return false;
  try {
    mkdirSync(dirname(p), { recursive: true });
    accessSync(dirname(p), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 当前生效的数据文件（用户优先，否则内置） */
export function activeFixturesPath() {
  const p = userFixturesPath();
  return p && existsSync(p) ? p : BUILT_IN;
}

/**
 * 内置快照 + 用户数据按 id 合并（实现已收敛到 src/data/index.js 供桌面与移动端共用）。
 *
 * 旧实现是「用户文件存在就完全替代内置」，后果不是丢比分，而是**永久锁住出厂赛程**：
 * 老用户同步过一次之后，之后任何新版本带进内置快照的新场次（UCL 淘汰赛对阵、
 * 新赛季、官方更正）都永远送不到他机器上 —— 用户文件把内置文件挡住了。
 *
 * 规则：
 *   · id 并集 —— 内置新增的场次追加进来，用户侧独有的也保留；
 *   · 同 id 字段以用户侧为准 —— 用户文件是「上一次同步的结果」，比分/改期通常比
 *     出厂快照新。
 *
 * ⚠️ 但「用户侧优先」有一个致命的例外：内置的**人工更正**（开球时间、轮次）
 *    会被用户文件里那条上个版本抄下来的旧值挡住，且同步从不写这两个字段 → 永不纠正。
 *    所以从 schemaVersion 2 起，用户文件只存**差分**（writer='sparse'），
 *    并对每个字段记写入时刻；合并时用内置 rev 与之比较，谁新听谁的。
 *    见 src/data/index.js 中的 mergeFixtures。
 */

function parseFixtures(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function loadFixtures() {
  const userPath = userFixturesPath();
  if (!userPath || !existsSync(userPath)) {
    return parseFixtures(await readFile(BUILT_IN, 'utf8'));
  }
  /**
   * 跨赛季：**绝不合并**。
   *
   * 两侧赛季都已知且不同 → 以内置为准，并把上季用户文件改名归档
   * （`fixtures-2026-27.bak.json`，不删除——里面是用户真金白银同步来的数据）。
   * 任一未知（老用户没有 meta、或内置 meta 读不到）→ 按同一赛季处理，保持旧行为。
   */
  const builtinS = builtinSeason();
  const userS = loadUserMeta()?.season ?? null;
  if (builtinS && userS && builtinS !== userS) {
    archiveUserFixtures(userS);
    return parseFixtures(await readFile(BUILT_IN, 'utf8'));
  }
  // 内置读不到（打包异常）时退回用户数据，而不是把界面清空
  const [builtinRaw, userRaw] = await Promise.all([
    readFile(BUILT_IN, 'utf8').catch(() => '[]'),
    readFile(userPath, 'utf8')
  ]);
  const meta = loadUserMeta();
  const merged = mergeFixtures(parseFixtures(builtinRaw), parseFixtures(userRaw), {
    writer: meta?.writer === 'sparse' ? 'sparse' : 'dense',
    builtinRev: builtinRev()
  });
  // 合并结果为空说明两侧都坏了：宁可抛错让上层报「数据不可用」，也不要静默返回空数组
  if (!merged.length) throw new Error('赛程数据为空（内置与用户数据都无法解析）');
  return merged;
}

/**
 * 增量同步的**扩窗**边界（天）。
 *
 * 注意它控制的是「要不要为一场缺分比赛多查前后几天」，不是「要不要查这场比赛」——
 * activeSyncTargets 对任何过期未录的 sched 场次都会 `add(t)`，只是 14 天外的
 * 那些只查本地日期、不再向 ±1 / ±MATH_WINDOW 展开（避免历史积压把请求放大数倍）。
 *
 * 因此**不能**用它来过滤「上游缺分」的统计：窗口外的场次确实被查过，
 * 查不到就是真的没数据，报出来是诚实的。
 */
export const SYNC_WINDOW_DAYS = 14;

/**
 * 写入用户数据目录。返回 { ok, path, bytes, changedFields }；
 * 没有可写目录（如纯本地 server 模式未注入 userData）时返回 ok:false，
 * 由调用方降级为「只预览」而不是把应用搞崩。
 *
 * ⚠️ 只写**差分**（schemaVersion 2 起）。
 *
 * 旧实现把合并结果整份落盘，于是用户文件变成内置的完整副本 —— 之后每次升级，
 * 内置的人工更正（开球时间、轮次）都会被这份「上个版本的复印件」挡住，
 * 而这些字段同步从不写，错了永远不纠正。
 *
 * 现在逐字段与内置比对，只落真正不同的字段，并记下该字段最后一次**变化**的时刻：
 *   { "id": "PD-10-ALA-MAL", "sc": "1-1", "st": "done", "at": { "sc": "...", "st": "..." } }
 * 合并时拿内置 rev 与 at 比大小，谁新听谁的。写入时刻只在值真的变了才刷新，
 * 否则每次同步都会把 at 推到最新，内置就更正不动了。
 */
export function saveFixtures(next) {
  const p = userFixturesPath();
  if (!p) {
    return { ok: false, reason: '未配置可写的数据目录（NIGHTOWL_USER_DATA 未注入）' };
  }
  const now = new Date().toISOString();
  let out;
  let changedFields;
  try {
    const builtin = parseFixtures(readFileSync(BUILT_IN, 'utf8'));
    const prevUser = existsSync(p) ? parseFixtures(readFileSync(p, 'utf8')) : [];
    ({ out, changedFields } = buildFixturesDiff(builtin, next, prevUser, now));
  } catch (err) {
    return { ok: false, reason: `计算差分失败：${err.message}`, path: p };
  }

  const body = JSON.stringify(out);
  try {
    // 原子写：先写临时文件再重命名，避免写一半崩溃导致数据损坏
    const tmp = `${p}.tmp`;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, p);
    // 盖章：这份用户数据属于哪个赛季、以什么方式写、对应哪个内置修订
    saveUserMeta(builtinSeason() || 'unknown', { writer: 'sparse', builtinRev: builtinRev() });
    return { ok: true, path: p, bytes: Buffer.byteLength(body), changedFields };
  } catch (err) {
    return { ok: false, reason: err.message, path: p };
  }
}

/**
 * 数据新鲜度：给界面用，避免用户以为「应用坏了」——
 * 其实是数据旧。返回最后比分时间、落后场数、来源。
 */
export function freshness(fixtures, nowTs = Date.now(), opts = {}) {
  const usingUser = opts.usingUser ?? (activeFixturesPath() !== BUILT_IN);
  let lastScoreTs = 0;
  let stale = 0;
  let staleMissing = 0;
  let live = 0;
  for (const m of fixtures) {
    const t = ts(m.t);
    if (Number.isNaN(t)) continue;
    if (m.st === 'done' && m.sc) lastScoreTs = Math.max(lastScoreTs, t);
    if (m.st === 'sched' && !m.tbd && nowTs > t + MATCH_DURATION_MS) {
      stale++;
      // 只有已经同步到用户数据后，超过 24h 仍无比分才说明上游没提供；
      // 内置快照本身可能落后，别把「还没同步」误报成「上游缺分」。
      if (usingUser && nowTs - (t + MATCH_DURATION_MS) > 24 * 3600000) staleMissing++;
    } else if (m.st === 'sched' && !m.tbd && nowTs >= t && nowTs <= t + MATCH_DURATION_MS) live++;
  }
  return {
    source: usingUser ? 'user' : 'builtin',
    lastScoreAt: lastScoreTs ? new Date(lastScoreTs).toISOString() : null,
    // 最近赛果的**完赛**时刻。之前只有开球时间，于是「最新赛果」的年龄被高估了
    // 整整一场比赛的时长（真实数据里 04:00 开球的场次在 11:10 显示 7.2 小时前，
    // 实际约 2 小时前才完赛）。
    lastScoreEndAt: lastScoreTs ? new Date(lastScoreTs + MATCH_DURATION_MS).toISOString() : null,
    // staleHours 的口径是「距最近赛果完赛多久」，不是「距开球多久」。
    // ⚠️ 它回答的是「赛果有多旧」，不能单独用来判断「数据要不要更新」——
    //    休赛日没有新赛果是正常的，那件事看 pendingCount（见 useDataHealth）。
    staleHours: lastScoreTs ? +((nowTs - lastScoreTs - MATCH_DURATION_MS) / 3600000).toFixed(1) : null,
    pendingCount: stale,
    stalePendingCount: staleMissing,
    liveCount: live,
    writable: canWriteUserData()
  };
}
