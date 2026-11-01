/**
 * 线路成功率记忆（纯函数，桌面端本机）
 *
 * 产品口径（PRD FR-07）：
 *   · 按线路身份记录：尝试次数、成功起播次数、最近成功时间、最近失败原因；
 *   · 排序：本地成功率优先 → 最近成功时间 → 原有顺序；
 *   · 失败线路**当天降权但不禁用**，新线路始终可见；
 *   · 7 天无数据衰减回默认；
 *   · 只记本机、不跨设备，用户可清除。
 *
 * 为什么身份用「域名 + 类型」而不是线路名：
 *   聚合站的线路名会轮换（线C6 / 线A2 / 集数），而真正决定能不能看的是域名与水类型；
 *   同一域名下不同房间的可用性高度相关，按域名聚合样本量才够。
 *   同时保留 name 只作展示，不参与身份 —— 改名不该把历史清零。
 *
 * 为什么用拉普拉斯平滑而不是裸成功率：
 *   裸 1/1 = 100% 会压过 9/10 = 90%，一条只试过一次的新线路排在老黄牛前面，
 *   用户反而更容易点到没验证过的线。平滑后样本量小的线路自然回到中线附近，
 *   试得多的线路才真正体现出差异。
 */

export const LINE_MEMORY_TTL_MS = 7 * 24 * 3600000;
/** 失败降权窗口：当天失败过的线路排到后面，但不隐藏 */
export const LINE_FAIL_DEMOTE_MS = 24 * 3600000;
/** 记录条数上限，按最近使用淘汰（避免本地存储无限增长） */
export const LINE_MEMORY_LIMIT = 80;

/** 从线路对象取主机名；取不到返回空串（此时不参与记忆） */
export function lineHost(line) {
  try {
    return new URL(String(line?.url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 线路身份：域名 + 媒体类型。取不到域名时返回空串（不记录） */
export function lineKey(line) {
  const host = lineHost(line);
  if (!host) return '';
  const kind = typeof line?.kind === 'string' && line.kind ? line.kind : 'other';
  return `${host}|${kind}`;
}

function isEntry(v) {
  return (
    v &&
    typeof v === 'object' &&
    Number.isFinite(v.attempts) &&
    Number.isFinite(v.successes) &&
    v.attempts >= 0 &&
    v.successes >= 0 &&
    v.successes <= v.attempts
  );
}

/**
 * 收敛任意存储内容成可计算结构；丢弃过期条目
 * @param {object} raw 本地存储读出的对象
 * @param {number} now
 * @returns {Record<string, {attempts:number, successes:number, lastOkAt:number, lastFailAt:number, lastFailReason:string}>}
 */
export function normalizeLineMemory(raw, now = Date.now()) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!isEntry(value)) continue;
    const lastOkAt = Number.isFinite(value.lastOkAt) ? value.lastOkAt : 0;
    const lastFailAt = Number.isFinite(value.lastFailAt) ? value.lastFailAt : 0;
    const touched = Math.max(lastOkAt, lastFailAt);
    // 7 天没有任何尝试记录 → 衰减回默认（直接丢弃，等价于「没有记忆」）
    if (!touched || now - touched > LINE_MEMORY_TTL_MS) continue;
    out[key] = {
      attempts: Math.trunc(value.attempts),
      successes: Math.trunc(value.successes),
      lastOkAt,
      lastFailAt,
      lastFailReason: typeof value.lastFailReason === 'string' ? value.lastFailReason.slice(0, 40) : ''
    };
  }
  return out;
}

/** 记录一次尝试；返回新对象（不改入参） */
export function recordLineAttempt(memory, line, { ok = false, reason = '', now = Date.now() } = {}) {
  const key = lineKey(line);
  if (!key) return normalizeLineMemory(memory, now);
  const base = normalizeLineMemory(memory, now);
  const prev = base[key] || { attempts: 0, successes: 0, lastOkAt: 0, lastFailAt: 0, lastFailReason: '' };
  const next = {
    attempts: prev.attempts + 1,
    successes: prev.successes + (ok ? 1 : 0),
    lastOkAt: ok ? now : prev.lastOkAt,
    lastFailAt: ok ? prev.lastFailAt : now,
    lastFailReason: ok ? prev.lastFailReason : String(reason || '起播失败').slice(0, 40)
  };

  const merged = { ...base, [key]: next };

  // 超限时淘汰「最久没动过」的条目
  const keys = Object.keys(merged);
  if (keys.length > LINE_MEMORY_LIMIT) {
    keys
      .sort((a, b) => Math.max(merged[a].lastOkAt, merged[a].lastFailAt) - Math.max(merged[b].lastOkAt, merged[b].lastFailAt))
      .slice(0, keys.length - LINE_MEMORY_LIMIT)
      .forEach(k => delete merged[k]);
  }
  return merged;
}

/**
 * 单条线路的记忆摘要（供界面标注）
 * @returns {null | {attempts:number, successes:number, rate:number, lastOkAt:number, failedRecently:boolean, failReason:string}}
 */
export function lineMemoryFor(memory, line, now = Date.now()) {
  const key = lineKey(line);
  if (!key) return null;
  const mem = normalizeLineMemory(memory, now)[key];
  if (!mem) return null;
  const failedRecently = mem.lastFailAt > mem.lastOkAt && now - mem.lastFailAt <= LINE_FAIL_DEMOTE_MS;
  return {
    attempts: mem.attempts,
    successes: mem.successes,
    rate: mem.attempts ? mem.successes / mem.attempts : 0,
    lastOkAt: mem.lastOkAt,
    failedRecently,
    failReason: mem.lastFailReason
  };
}

/** 平滑成功率：样本越少越接近 0.5，避免 1/1 压过 9/10 */
function smoothedRate(mem) {
  if (!mem) return 0.5;
  return (mem.successes + 1) / (mem.attempts + 2);
}

/**
 * 按本地经验重排序（稳定排序，未命中记忆的线路保持原有相对顺序）
 *
 * 排序键（逐级比较）：
 *   1. 当天失败过的沉底（但仍可见）—— 其它条件相同才比较，避免老数据永久压住新线路
 *   2. 平滑成功率降序
 *   3. 最近成功时间降序
 *   4. 原有索引（保证确定性）
 *
 * @param {Array} lines 原始线路
 * @param {object} memory normalizeLineMemory 的结果
 * @param {number} now
 */
export function orderLinesByMemory(lines, memory, now = Date.now()) {
  const list = Array.isArray(lines) ? lines : [];
  const mem = normalizeLineMemory(memory, now);
  const decorated = list.map((line, index) => {
    const entry = mem[lineKey(line)] || null;
    const failedRecently =
      !!entry && entry.lastFailAt > entry.lastOkAt && now - entry.lastFailAt <= LINE_FAIL_DEMOTE_MS;
    return { line, index, entry, failedRecently, rate: smoothedRate(entry) };
  });

  decorated.sort((a, b) => {
    if (a.failedRecently !== b.failedRecently) return a.failedRecently ? 1 : -1;
    if (a.rate !== b.rate) return b.rate - a.rate;
    const ao = a.entry?.lastOkAt || 0;
    const bo = b.entry?.lastOkAt || 0;
    if (ao !== bo) return bo - ao;
    return a.index - b.index;
  });

  return decorated.map(d => d.line);
}
