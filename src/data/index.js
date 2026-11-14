/**
 * 数据层入口
 *
 * 6 项数据资产由 `tools/migrate-data.mjs` 从旧项目迁移生成（见该脚本注释）：
 *   fixtures / teams / rivalries / storylines / recommendations / crests
 *
 * ⚠️ 数据文件不得手工编辑，一律走迁移脚本或后续的保鲜脚本。
 *
 * ⚠️ JSON 导入必须带 `with { type: 'json' }`（与 src/core/stats.js 保持一致）。
 *    少了它，本模块只能在打包器里工作，Node 直接 import 会抛
 *    ERR_IMPORT_ATTRIBUTE_MISSING —— 于是依赖它的 src/core/owl.js 整层
 *    都进不了 Node 测试，只能靠浏览器端验证，这是实打实的测试盲区。
 *
 * ⚠️ `id` 与 `r` 是**两件事**，不要「顺手改一致」：
 *    · `id` 形如 `PD-4-RSO-CEL`，中间段是**快照生成时**的轮次，此后永不改动 ——
 *      它是稳定主键，用户本地的补看清单（watchLater）、线路记忆（line-memory）、
 *      ICS 日历、赛程变更通知全部以它为键，改 id 会让这些历史数据**全量孤立失效**。
 *    · `r` 是**展示字段**，由保鲜同步按权威源（openfootball 的 `round`）校正。
 *      2026-11-05 那次校正修了 26 场西甲，于是出现「id 段 4、r 为 6」的受控不一致 ——
 *      这是**预期状态**，不是数据损坏。详见 docs/archive/DEEP-REVIEW-2026-11-05-b.md 的 P1-1。
 */

import fixtures from './fixtures.json' with { type: 'json' };
import fixturesMeta from './fixtures-meta.json' with { type: 'json' };
import teams from './teams.json' with { type: 'json' };
import rivalries from './rivalries.json' with { type: 'json' };
import storylines from './storylines.json' with { type: 'json' };
import recommendations from './recommendations.json' with { type: 'json' };
import quips from './quips.json' with { type: 'json' };

export { fixtures, fixturesMeta, teams, rivalries, storylines, recommendations, quips };

/** 联赛中文名。SCG 是数据集中唯一的非联赛赛事（德国超级杯），单独归为「其他」以便筛选器兜住 */
export const LEAGUE_NAMES = {
  PL: '英超',
  PD: '西甲',
  SA: '意甲',
  BL: '德甲',
  FL: '法甲',
  UCL: '欧冠',
  SCG: '其他'
};

/** 筛选器展示顺序（七大联赛，含 SCG —— 不可漏） */
export const LEAGUE_ORDER = ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL', 'SCG'];

/** 可被用户设为「关注联赛」的六个主要联赛（不带 SCG，单场赛事不作为偏好项） */
export const FOLLOWABLE_LEAGUES = ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL'];

export const TEAM_MAP = teams.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {});

export const REC_MAP = recommendations.reduce((acc, r) => {
  acc[r.m] = r;
  return acc;
}, {});

export function teamName(id) {
  const t = TEAM_MAP[id];
  return t ? t.zh : id;
}

export function teamColor(id) {
  const t = TEAM_MAP[id];
  return t ? t.color : '#64748B';
}

export function leagueName(code) {
  return LEAGUE_NAMES[code] || code;
}

/**
 * 联赛识别色 —— 与 src/index.css 的 --league-* token 一一对应。
 *
 * 用途单一：赛程列表左侧 2px 色条。饱和度刻意压低，因为它是**辅助扫描的
 * 身份标记**，不是强调元素；真正的强调只留给品牌金。
 * 色条之外仍保留联赛文字标签，不依赖颜色作为唯一信息通道。
 */
export const LEAGUE_COLORS = {
  PL: '#A8559F',
  PD: '#E07A45',
  SA: '#4FA97F',
  BL: '#D05561',
  FL: '#5B8AD0',
  UCL: '#7C8FE8',
  SCG: '#6B7686'
};

export function leagueColor(code) {
  return LEAGUE_COLORS[code] || LEAGUE_COLORS.SCG;
}

/**
 * 文件名特殊映射。
 * `AUX` 是 Windows 保留设备名（CON/PRN/AUX/NUL…），`AUX.png` 这个文件
 * 在 Windows 上无法被 git 检出 —— GitHub Actions 的 Checkout 一步因此失败过。
 * 文件改名为 `AUX_.png`，数据 id 保持 AUX 不动（避免波及 fixtures 等外键），
 * 在此集中映射，而不是在组件里散落特判。
 */
const CREST_FILE_OVERRIDES = { AUX: 'AUX_' };

/** 队徽：本地 111 张 PNG（public/crests/）。未收录时返回 null，由调用方回退纯色圆标 */
export function crestUrl(id) {
  if (!TEAM_MAP[id]) return null;
  return `/crests/${CREST_FILE_OVERRIDES[id] ?? id}.png`;
}

/* ------------------------------------------------------------------ */
/* 运行时数据源                                                        */
/* ------------------------------------------------------------------ */
/**
 * 打包后 fixtures 是构建期内联的只读快照。保鲜同步把新数据写到 userData，
 * 前端通过 /api/fixtures 拉取后调用 setFixtures 替换这里，
 * 于是「刚结束的比赛显示待录比分」能在应用内被修好，而不必重启或重装。
 */
let _fixtures = fixtures;

export function getFixtures() {
  return _fixtures;
}

/**
 * 最小结构校验。
 *
 * 热门路径直接裸用 `m.t.split('T')[0]`（WeekView / SettingsDrawer / ScheduleView），
 * 一条 t 为 null 的记录就抛 TypeError。而 main.jsx 只有**一个**根 ErrorBoundary，
 * 且只能「重新加载」——单条脏数据（手改 userData、旧版本残留、异常写入）
 * 足以把整页打成「界面遇到错误」。宁可丢掉这一条，也不要丢掉整个应用。
 */
function isValidFixture(m) {
  return !!m
    && typeof m.id === 'string' && m.id.length > 0
    && typeof m.h === 'string'
    && typeof m.a === 'string'
    && typeof m.l === 'string'
    && typeof m.t === 'string' && m.t.length >= 10;
}

/** 返回是否真的替换成功（过滤后为空一律拒绝，避免把界面清空） */
export function setFixtures(next) {
  if (!Array.isArray(next) || next.length === 0) return false;
  const clean = next.filter(isValidFixture);
  if (clean.length === 0) return false;
  if (clean.length !== next.length) {
    console.warn(`[fixtures] 丢弃 ${next.length - clean.length} 条结构不完整的记录（id/h/a/l/t）`);
  }
  _fixtures = clean;
  return true;
}

/* ------------------------------------------------------------------ */
/* 赛程差分合并与计算（桌面 server 与移动端共用）                        */
/* ------------------------------------------------------------------ */

/** 旧式「整份副本」用户文件里可以信任的字段（都是同步真正会写的结果字段） */
const DENSE_TRUSTED_FIELDS = ['sc', 'st', 'tbd'];

/** 去掉内部的 at 映射，别让它漏给消费方（界面/测试都不认识这个字段） */
function stripMeta(m) {
  if (!m || !m.at) return m;
  const { at: _at, ...rest } = m;
  return rest;
}

/**
 * 内置快照 + 用户数据按 id 合并（桌面 server 与移动端共用）。
 *
 * @param {object[]} builtin 内置快照
 * @param {object[]} user    用户数据（sparse 差分或旧式整份副本）
 * @param {object}   [opts]
 * @param {'sparse'|'dense'} [opts.writer='dense'] 用户文件的写盘方式
 * @param {string|null} [opts.builtinRev=null] 内置快照的修订时刻（ISO）
 */
export function mergeFixtures(builtin, user, opts = {}) {
  if (!Array.isArray(user) || user.length === 0) return builtin || [];
  if (!Array.isArray(builtin) || builtin.length === 0) return user.map(stripMeta);
  const { writer = 'dense', builtinRev = null } = opts;
  const revTs = builtinRev ? Date.parse(builtinRev) : NaN;
  const byId = new Map();
  for (const m of builtin) {
    if (m && m.id) byId.set(m.id, m);
  }
  for (const m of user) {
    if (!m || !m.id) continue;
    const base = byId.get(m.id);
    if (!base) {
      byId.set(m.id, stripMeta(m));
      continue;
    }
    const at = m.at || {};
    const next = { ...base };
    for (const [k, v] of Object.entries(m)) {
      if (k === 'id' || k === 'at') continue;
      // 旧式整份副本：t/r 分不清「同步写的」还是「抄内置的」，只信结果字段
      if (writer !== 'sparse' && !DENSE_TRUSTED_FIELDS.includes(k)) continue;
      // 时间戳裁决（sparse）：内置这次修订比该字段的写入时刻更新 → 内置胜
      if (writer === 'sparse' && Number.isFinite(revTs)) {
        const fieldTs = at[k] ? Date.parse(at[k]) : NaN;
        if (Number.isFinite(fieldTs) && revTs > fieldTs) continue;
      }
      next[k] = v;
    }
    byId.set(m.id, next);
  }
  return [...byId.values()];
}

/**
 * 计算全量赛程相对于内置快照的稀疏差分，保留未变字段的原始写入时刻。
 *
 * @param {object[]} builtin  内置快照
 * @param {object[]} next     最新全量赛程
 * @param {object[]} [prevUser] 上一次落盘的用户差分
 * @param {string}   [nowIso]   当前写入时刻 ISO
 * @returns {{ out: object[], changedFields: string[] }}
 */
export function buildFixturesDiff(builtin, next, prevUser = [], nowIso = new Date().toISOString()) {
  const builtinById = new Map((builtin || []).filter(m => m && m.id).map(m => [m.id, m]));
  const prevById = new Map((prevUser || []).filter(row => row && row.id).map(row => [row.id, row]));
  const out = [];
  const changedFields = [];

  for (const m of next || []) {
    if (!m || !m.id) continue;
    const base = builtinById.get(m.id);
    // 内置没有这条（历史遗留/人为导入）：整条保留，否则读回来就丢了
    if (!base) {
      out.push(stripMeta(m));
      continue;
    }
    const prev = prevById.get(m.id);
    const diff = { id: m.id };
    const at = {};
    let dirty = 0;
    for (const k of Object.keys(m)) {
      if (k === 'id' || k === 'at') continue;
      if (m[k] === base[k]) continue;
      diff[k] = m[k];
      dirty++;
      // 值没变过的字段沿用上一次的写入时刻
      at[k] = prev && prev[k] === m[k] && prev.at?.[k] ? prev.at[k] : nowIso;
      changedFields.push(`${m.id}.${k}`);
    }
    if (dirty) {
      diff.at = at;
      out.push(diff);
    }
  }

  return { out, changedFields };
}
