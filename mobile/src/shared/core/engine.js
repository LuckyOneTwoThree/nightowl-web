/**
 * 夜猫看台 · 推荐引擎
 *
 * 来源：参考项目/nightowl-terrace/miniprogram/utils/engine.js（原版 499 行，CommonJS 纯函数）
 * 验证：与原版在全量 1,897 场上交叉比对 0 处偏差（见 spike/algo-baseline/BASELINE.md）
 *
 * 移植改造点（依据《开工前技术检查清单》Step 1）：
 *   1. CommonJS → ESM
 *   2. 清理 evaluate() 内的 getApp() 兜底；followedTeams / followedLeagues 改为显式传参
 *      —— 保留兜底会让 Web 端恒定落成「6 个联赛全选」，铁律一（+8）永远为 0
 *   3. 档位唯一入口改为运行时计算：tierOf(m) → sleepTier(m.t)，数据层已删除烘焙字段 s
 *   4. 权重与背包策略参数化；DEFAULT_* 供回归比对，PRODUCT_* 是交付口径
 *   5. 未移植 settlePred（盲评结算判据）与 replays（补番推荐）—— 互动玩法与补番
 *      入口已在桌面版彻底删除，留着只是死代码（replays 确认零调用后已删）。
 *
 * ⚠️ 本文件是算法的唯一权威实现。spike/algo-baseline/ 的验证脚本直接引用本文件，
 *    不得另存副本（避免判据漂移）。
 */

// ---------- 时间 ----------

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 北京墙钟串 → 真实时间戳。纯 UTC 算术，禁止 new Date(t) 本地解析 */
export function ts(t) {
  const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 8 * 3600000;
}

/** "2026-08-22T03:00" → 当日分钟数 */
export function parseMin(t) {
  const hm = t.split('T')[1].split(':');
  return Number(hm[0]) * 60 + Number(hm[1]);
}

export function dateOf(t) { return t.split('T')[0]; }

/** 夜猫口径「展示日」：北京时间 00:00–06:00 的场次归属前一晚 */
export function owlDay(t) {
  const f = String(t || '').split('T');
  const hm = (f[1] || '00:00').split(':');
  let day = f[0];
  if (Number(hm[0]) < 6) {
    const p = day.split('-');
    const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - 86400000);
    day = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  return day;
}

/** 夜猫口径「今日」：设备时区无关 */
export function nightOf(now) {
  const t = (now instanceof Date) ? now.getTime() : Number(now);
  let bj = new Date(t + 8 * 3600000);
  if (bj.getUTCHours() < 6) bj = new Date(bj.getTime() - 86400000);
  return bj.getUTCFullYear() + '-' + pad2(bj.getUTCMonth() + 1) + '-' + pad2(bj.getUTCDate());
}

// ---------- 睡眠成本分档（北京时间开球） ----------

export const TIERS = [
  { tier: 0, label: 'S0', cost: 0.0, zh: '零成本' },
  { tier: 1, label: 'S1', cost: 1.0, zh: '轻度' },
  { tier: 2, label: 'S2', cost: 2.5, zh: '中度' },
  { tier: 3, label: 'S3', cost: 3.5, zh: '重度' },
  { tier: 4, label: 'S4', cost: 4.5, zh: '极限' }
];

export function sleepTier(t) {
  const m = parseMin(t);
  if (m <= 30) return TIERS[1];            // 00:00–00:30 → S1
  if (m <= 150) return TIERS[2];           // 00:30–02:30 → S2
  if (m < 240) return TIERS[3];            // 02:30–04:00 → S3
  if (m < 420) return TIERS[4];            // 04:00–07:00 → S4
  if (m <= 22 * 60 + 30) return TIERS[0];  // 白天–22:30 → S0
  return TIERS[1];                         // 22:30–24:00 → S1
}

/** 档位唯一入口：运行时从 m.t 计算，不读数据中的静态档位字段 */
export function tierOf(match) { return sleepTier(match.t); }

// ---------- 比赛状态 ----------

export const MATCH_DURATION_MS = 120 * 60 * 1000;

export function isFinished(m) {
  return !!m && (m.st === 'done' || m.st === 'ft');
}

/** 推导 'finished' | 'live' | 'ended_pending' | 'sched' | 'pp' */
export function matchState(m, nowTs) {
  if (!m) return 'sched';
  if (isFinished(m)) return 'finished';
  if (m.st === 'pp') return 'pp';
  const now = nowTs || Date.now();
  const kickTs = ts(m.t);
  if (isNaN(kickTs)) return m.st || 'sched';
  if (now < kickTs) return 'sched';
  if (now < kickTs + MATCH_DURATION_MS) return 'live';
  return 'ended_pending';
}

// ---------- 北京时区日历工具 ----------

export function bjDateStr(t) {
  const b = new Date(t + 8 * 3600000);
  return b.getUTCFullYear() + '-' + pad2(b.getUTCMonth() + 1) + '-' + pad2(b.getUTCDate());
}

export function mondayOfWall(ds) {
  const f = String(ds || '').split('-');
  const wall = Date.UTC(Number(f[0]), Number(f[1]) - 1, Number(f[2]));
  const wd = new Date(wall).getUTCDay();
  const mon = new Date(wall - ((wd + 6) % 7) * 86400000);
  return mon.getUTCFullYear() + '-' + pad2(mon.getUTCMonth() + 1) + '-' + pad2(mon.getUTCDate());
}

export function weekStartBJ(nowTs) {
  const str = mondayOfWall(bjDateStr(nowTs));
  const f = str.split('-');
  return { str, ts: Date.UTC(Number(f[0]), Number(f[1]) - 1, Number(f[2])) - 8 * 3600000 };
}

// ---------- 权重（可标定） ----------

export const BIG_SIX = ['ARS', 'MCI', 'LIV', 'CHE', 'MUN', 'TOT'];

/** 默认值 = 原版 engine.js 的硬编码值 */
export const DEFAULT_WEIGHTS = {
  followedBonus: 25,        // 主队加成
  storyBonusKeyNode: 10,    // 故事线关键节点
  storyBonusStory: 5,       // 一般故事线节点
  leagueBonus: 8,           // 关注联赛加成（仅已选 < 6 时生效）
  watchCost: 0              // 观看占用（新增项，默认 0 = 与原版等价）
};

/**
 * 观看占用默认值（D6 标定结论）
 *
 * 背景：公式 W ÷ (1 + 睡眠成本) 让"零成本"获得乘性特权——S0 ★1 中立赛指数恒为 10.0，
 * 而凌晨主队欧冠（S4 ★★）只有 8.2，违背"指数高 = 更值得熬"的直觉。
 * 根因：模型只算睡眠成本、没算观看成本（看一场球本身要占 2 小时，与睡不睡无关）。
 * 标定依据见 spike/algo-baseline/CALIBRATION.md
 */
export const WATCH_COST = 0.5;

/**
 * 产品最终配置（D1–D9 排定结果，2026-09-12）
 *
 * 与 DEFAULT_WEIGHTS 的区别：DEFAULT_WEIGHTS 是"与原版等价"的验证基准，
 * PRODUCT_* 是**排定后实际要交付的口径**。两者并存是为了让回归比对仍然可做。
 *
 * 依据见 spike/algo-baseline/CALIBRATION.md 与 pm/决策排定与开工执行清单.md
 */
export const PRODUCT_WEIGHTS = { ...DEFAULT_WEIGHTS, watchCost: WATCH_COST };

/** 背包：数量上限 5 + 零成本场次分离（D8） */
export const PRODUCT_PLAN_OPTS = {
  weights: PRODUCT_WEIGHTS,
  maxPicks: 5,
  separateZeroCost: true
};

/** Hero 低看点分档阈值（D9）：≥高光 / ≥标准 / 否则弱化 */
export const HERO_TIERS = { highlight: 15, standard: 5 };

/** 按指数给出 Hero 展示档位 */
export function heroTierOf(index) {
  if (index >= HERO_TIERS.highlight) return 'highlight';
  if (index >= HERO_TIERS.standard) return 'standard';
  return 'weak';
}



// ---------- 星级判据 ----------

export function rivalryOf(match, rivalries) {
  return (rivalries || []).find(r => r.pair.indexOf(match.h) >= 0 && r.pair.indexOf(match.a) >= 0);
}

export function isBigSixClash(match) {
  return BIG_SIX.indexOf(match.h) >= 0 && BIG_SIX.indexOf(match.a) >= 0;
}

export function storylinesOf(match, storylines) {
  return (storylines || []).filter(s => s.status !== 'draft' && s.nodes.indexOf(match.id) >= 0);
}

export function isKeyNode(match, storylines) {
  return (storylines || []).some(s => (s.keyNodes || []).indexOf(match.id) >= 0);
}

/**
 * 计算一场比赛的最终星级与加成
 * 注意：followedLeagues 必须显式传入，不存在任何全局兜底
 */
export function evaluate(match, recMap, rivalries, storylines, followed, followedLeagues) {
  followed = followed || [];
  followedLeagues = Array.isArray(followedLeagues) ? followedLeagues : [];
  const rec = recMap && recMap[match.id];
  const stories = storylinesOf(match, storylines);
  const keyNode = isKeyNode(match, storylines);
  const rivalry = rivalryOf(match, rivalries);
  const bonuses = [];

  let base = 1;
  if (rec && rec.star) base = rec.star;
  else if (rivalry || isBigSixClash(match)) base = 3;
  else if (stories.length) base = 2;

  let star = base;
  if (keyNode && star < 3) { star = 3; bonuses.push('故事线关键节点'); }

  const isFollowed = (followed.indexOf(match.h) >= 0 || followed.indexOf(match.a) >= 0);
  if (isFollowed) {
    if (star < 2) star = 2;
    else if (star < 3) star = 3;
    bonuses.push('关注主队');
  }

  const isLeagueFollowed = (followedLeagues.indexOf(match.l) >= 0);
  if (isLeagueFollowed && followedLeagues.length < 6 && !isFollowed) {
    bonuses.push('关注联赛');
  }

  return {
    star, base, isFollowed, isLeagueFollowed,
    followedLeaguesCount: followedLeagues.length,
    stories, storyIds: stories.map(s => s.id),
    keyNode,
    rivalry: rivalry ? rivalry.zh : null,
    rec: rec || null,
    bonuses
  };
}

// ---------- 夜猫指数 ----------

export function storyBonus(ev, w = DEFAULT_WEIGHTS) {
  if (ev.keyNode) return w.storyBonusKeyNode;
  if (ev.storyIds.length) return w.storyBonusStory;
  return 0;
}

export function followedBonus(ev, w = DEFAULT_WEIGHTS) {
  return ev.isFollowed ? w.followedBonus : 0;
}

/** 铁律一：仅当已选关注联赛 < 6 时给予加成 */
export function leagueBonus(ev, w = DEFAULT_WEIGHTS) {
  return (ev.isLeagueFollowed && ev.followedLeaguesCount < 6) ? w.leagueBonus : 0;
}

export function owlIndex(ev, match, w = DEFAULT_WEIGHTS) {
  const watch = w.watchCost || 0;
  const weight = ev.star * 10 + storyBonus(ev, w) + followedBonus(ev, w) + leagueBonus(ev, w);
  return weight / (1 + tierOf(match).cost + watch);
}

// ---------- 今晚之选 ----------

export function pickToday(matches, recMap, rivalries, storylines, followed, followedLeagues, w = DEFAULT_WEIGHTS) {
  const evs = matches
    .filter(m => m.st === 'sched' && !m.tbd)
    .map(m => {
      const ev = evaluate(m, recMap, rivalries, storylines, followed, followedLeagues);
      return { m, ev, index: owlIndex(ev, m, w) };
    });

  evs.sort((x, y) => {
    if (y.ev.isFollowed !== x.ev.isFollowed) return (y.ev.isFollowed ? 1 : 0) - (x.ev.isFollowed ? 1 : 0);

    const lpx = x.ev.isLeagueFollowed ? 1 : 0;
    const lpy = y.ev.isLeagueFollowed ? 1 : 0;
    if (lpy !== lpx) {
      if (y.ev.isLeagueFollowed && y.ev.star >= 2 && x.ev.star <= 2) return 1;
      if (x.ev.isLeagueFollowed && x.ev.star >= 2 && y.ev.star <= 2) return -1;
    }

    if (y.ev.star !== x.ev.star) return y.ev.star - x.ev.star;

    const cx = tierOf(x.m).cost, cy = tierOf(y.m).cost;
    if (cx !== cy) return cx - cy;

    const sx = storyBonus(x.ev, w), sy = storyBonus(y.ev, w);
    if (sy !== sx) return sy - sx;

    return y.index - x.index;
  });

  return {
    hero: evs[0] || null,
    extras: evs.slice(1).filter(e => e.ev.star >= 2)
  };
}

// ---------- 0-1 背包 ----------

/** 二维 DP，勿改一维滚动数组（pick 标记会被覆盖，无法回溯） */
export function knapsack(entries, budgetHours, w = DEFAULT_WEIGHTS, capRatio = 1) {
  const cap = Math.round(budgetHours * 2);
  let pool = entries;
  if (capRatio < 1) {
    const maxWt = capRatio * cap;
    pool = entries.filter(e => Math.round(tierOf(e.m).cost * 2) <= maxWt);
  }
  const n = pool.length;
  const val = pool.map(e => Math.round(e.index * 10));
  const wt = pool.map(e => Math.round(tierOf(e.m).cost * 2));

  const dp = [];
  for (let i = 0; i <= n; i++) {
    dp[i] = [];
    for (let x = 0; x <= cap; x++) dp[i][x] = 0;
  }
  for (let i = 1; i <= n; i++) {
    for (let x = 0; x <= cap; x++) {
      dp[i][x] = dp[i - 1][x];
      if (wt[i - 1] <= x && dp[i - 1][x - wt[i - 1]] + val[i - 1] > dp[i][x]) {
        dp[i][x] = dp[i - 1][x - wt[i - 1]] + val[i - 1];
      }
    }
  }
  const chosen = [];
  let x = cap;
  for (let i = n; i >= 1; i--) {
    if (dp[i][x] !== dp[i - 1][x]) {
      chosen.unshift(pool[i - 1]);
      x -= wt[i - 1];
    }
  }
  return chosen;
}

/**
 * 带**数量上限**的 0-1 背包（D8 修复）
 *
 * 为什么需要：原版背包重量 = 睡眠成本 × 2，S0 场次成本 0 → 重量 0 → 不消耗容量，
 * 于是当周全部零成本场次被一次装入（实测周预算 1.0h 也返回 20 场）。
 * 这里把「预算」与「场次数量」作为两个独立约束，用二维 DP 求最优。
 */
export function knapsackLimited(entries, budgetHours, w = DEFAULT_WEIGHTS, maxCount = 5) {
  const cap = Math.round(budgetHours * 2);
  const n = entries.length;
  const K = Math.min(maxCount, n);
  const NEG = -1e9;

  const val = entries.map(e => Math.round(e.index * 10));
  const wt = entries.map(e => Math.round(tierOf(e.m).cost * 2));

  const dp = [];
  for (let i = 0; i <= n; i++) {
    dp[i] = [];
    for (let c = 0; c <= K; c++) dp[i][c] = new Array(cap + 1).fill(NEG);
  }
  dp[0][0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let c = 0; c <= K; c++) {
      for (let x = 0; x <= cap; x++) {
        let best = dp[i - 1][c][x];
        if (c > 0 && wt[i - 1] <= x) {
          const prev = dp[i - 1][c - 1][x - wt[i - 1]];
          if (prev > NEG / 2 && prev + val[i - 1] > best) best = prev + val[i - 1];
        }
        dp[i][c][x] = best;
      }
    }
  }

  let bestVal = NEG, bestC = 0, bestX = 0;
  for (let c = 0; c <= K; c++) {
    for (let x = 0; x <= cap; x++) {
      if (dp[n][c][x] > bestVal) { bestVal = dp[n][c][x]; bestC = c; bestX = x; }
    }
  }

  const chosen = [];
  let c = bestC, x = bestX;
  for (let i = n; i >= 1; i--) {
    if (c > 0 && dp[i][c][x] !== dp[i - 1][c][x]) {
      chosen.unshift(entries[i - 1]);
      x -= wt[i - 1];
      c -= 1;
    }
  }
  return chosen;
}

export function planWeek(matches, recMap, rivalries, storylines, followed, budget, followedLeagues, opts = {}) {
  const w = opts.weights || DEFAULT_WEIGHTS;
  const capRatio = opts.knapsackCapRatio == null ? 1 : opts.knapsackCapRatio;
  const softGuarantee = !!opts.followedSoftGuarantee;
  const maxPicks = opts.maxPicks == null ? Infinity : opts.maxPicks;   // D8：数量上限
  const separateZero = !!opts.separateZeroCost;                        // D8：S0 场次分离

  // ⚠️ 不能用 `budget || 4.0`：0 是**合法意图**（"本周一点都不熬"），但它 falsy，
  //    会被静默改成 4.0 —— 结果是滑杆拖到 0 又弹回 4，而偏好里存的其实还是 0，
  //    界面与存储各说各话。只对「非有限数」回落默认值。
  budget = typeof budget === 'number' && Number.isFinite(budget) ? budget : 4.0;

  const eligible = matches.filter(m => m.st === 'sched' && !m.tbd);
  const isZero = (m) => tierOf(m).cost === 0;

  const build = (list) => list
    .map(m => {
      const ev = evaluate(m, recMap, rivalries, storylines, followed, followedLeagues);
      return { m, ev, index: owlIndex(ev, m, w) };
    })
    .sort((a, b) => b.index - a.index);

  // 分离零成本场次（它们在原版背包里重量为 0，会污染结果）
  const zeroPool = separateZero ? eligible.filter(isZero) : [];
  const pool = separateZero ? eligible.filter(m => !isZero(m)) : eligible;

  const evs = build(pool);
  const zeroEvs = build(zeroPool);

  const followedEvs = evs.filter(e => e.ev.isFollowed);
  const followedLeagueNeutralEvs = evs.filter(e => !e.ev.isFollowed && e.ev.isLeagueFollowed);
  const otherNeutralEvs = evs.filter(e => !e.ev.isFollowed && !e.ev.isLeagueFollowed);

  const limited = Number.isFinite(maxPicks);
  const fill = (list, bud, remaining) => limited
    ? knapsackLimited(list, bud, w, remaining)
    : knapsack(list, bud, w, capRatio);

  let best = [];
  let curBudget = budget;
  const room = () => (limited ? maxPicks - best.length : Infinity);

  // 主队比赛：预算内必保（原版行为）；softGuarantee 时额外受单场占比约束
  followedEvs.forEach(e => {
    if (room() <= 0) return;
    const cost = tierOf(e.m).cost;
    const underCap = capRatio >= 1 || cost <= capRatio * budget;
    if (cost <= curBudget && underCap) {
      best.push(e);
      curBudget -= cost;
    }
  });

  if (curBudget >= 0 && room() > 0 && followedLeagueNeutralEvs.length > 0) {
    const filled = fill(followedLeagueNeutralEvs, Math.max(0, curBudget), room());
    best = best.concat(filled);
    filled.forEach(e => { curBudget -= tierOf(e.m).cost; });
  }

  if (curBudget >= 0 && room() > 0 && otherNeutralEvs.length > 0) {
    const filled = fill(otherNeutralEvs, Math.max(0, curBudget), room());
    best = best.concat(filled);
    curBudget -= filled.reduce((s, e) => s + tierOf(e.m).cost, 0);
  }

  const bestIds = {};
  best.forEach(e => { bestIds[e.m.id] = true; });
  const alt = evs.filter(e => !bestIds[e.m.id]).slice(0, 3);
  const usedCost = best.reduce((s, e) => s + tierOf(e.m).cost, 0);

  return { best, alt, budget, used: usedCost, evs, zeroList: zeroEvs, zeroCount: zeroEvs.length };
}

// ---------- 雷区预警 ----------

export function minefield(matches, recMap, rivalries, storylines, followed, followedLeagues) {
  return matches
    .filter(m => m.st === 'sched' && !m.tbd)
    .map(m => ({ m, ev: evaluate(m, recMap, rivalries, storylines, followed, followedLeagues) }))
    .filter(e => {
      const cost = tierOf(e.m).cost;
      if (cost >= 3.5 && e.ev.star <= 1 && e.ev.storyIds.length === 0) return true;
      if (!e.ev.isLeagueFollowed && cost >= 2.5 && e.ev.star <= 1 && e.ev.storyIds.length === 0) return true;
      return false;
    })
    .map(e => {
      if (!e.ev.isLeagueFollowed) {
        e.reason = '非关注联赛 · ' + tierOf(e.m).label + ' 档看点有限，建议睡觉养生';
      } else {
        e.reason = '凌晨 ' + tierOf(e.m).label + ' 档，看点有限，建议睡觉';
      }
      return e;
    });
}

// ---------- 下一场焦点战 ----------

export function nextFocal(matches, recMap, rivalries, storylines, followed, nowTs, followedLeagues) {
  const future = matches
    .filter(m => m.st === 'sched' && !m.tbd && ts(m.t) > nowTs)
    .map(m => ({ m, ev: evaluate(m, recMap, rivalries, storylines, followed, followedLeagues) }))
    .sort((a, b) => {
      if (b.ev.isLeagueFollowed !== a.ev.isLeagueFollowed && b.ev.star === a.ev.star) {
        return (b.ev.isLeagueFollowed ? 1 : 0) - (a.ev.isLeagueFollowed ? 1 : 0);
      }
      if (b.ev.star !== a.ev.star) return b.ev.star - a.ev.star;
      return ts(a.m.t) - ts(b.m.t);
    });
  return future[0] || null;
}

// ---------- 倒计时 ----------

export function countdown(targetTs, nowTs) {
  const diff = Math.max(0, targetTs - nowTs);
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
    over: diff <= 0
  };
}
