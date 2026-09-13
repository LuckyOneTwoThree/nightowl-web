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
 */

import fixtures from './fixtures.json' with { type: 'json' };
import teams from './teams.json' with { type: 'json' };
import rivalries from './rivalries.json' with { type: 'json' };
import storylines from './storylines.json' with { type: 'json' };
import recommendations from './recommendations.json' with { type: 'json' };
import quips from './quips.json' with { type: 'json' };

export { fixtures, teams, rivalries, storylines, recommendations, quips };

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

/** 返回是否真的替换成功（空数组 / 非数组一律拒绝，避免把界面清空） */
export function setFixtures(next) {
  if (!Array.isArray(next) || next.length === 0) return false;
  _fixtures = next;
  return true;
}
