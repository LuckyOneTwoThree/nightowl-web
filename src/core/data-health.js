/**
 * 单场数据健康口径（纯函数）
 *
 * 产品要回答的唯一问题是：这场比赛的数据**为什么**是这样 —— 是「还没同步」，
 * 还是「上游就没有」？两者对用户的含义完全不同：
 *   · 待同步 → 等一会儿 / 点一下重查，会好；
 *   · 上游未提供 → 别再等了，去官方平台看。
 *
 * 判定只看三件事：开球时刻、完赛近似时刻（+120 分钟）、上游是否给出比分。
 * 24 小时阈值与 server/data-store.js 的 `stalePendingCount` 同口径 —— 那边
 * 统计「上游缺分」，这边解释单场，两个数字必须能对上。
 */

import { MATCH_DURATION_MS, ts } from './engine.js';

/** 超过这个时长仍无比分 → 判定为「上游未提供」，提示用户别再等 */
export const MISSING_AFTER_MS = 24 * 3600000;

export const DATA_STATE = Object.freeze({
  NONE: 'none', // 没有比赛
  OK: 'ok', // 已同步（有比分）
  UPCOMING: 'upcoming', // 还没到完赛时间，本就不该有比分
  PENDING: 'pending', // 已过完赛时间但 24h 内，等待同步
  MISSING: 'missing', // 超过 24h 仍无比分，上游未提供
  TBD: 'tbd', // 开球时间待定
  POSTPONED: 'postponed' // 延期
});

/**
 * 单场数据状态
 * @param {object} match
 * @param {number} nowTs
 * @returns {string} DATA_STATE 之一
 */
export function matchDataState(match, nowTs = Date.now()) {
  if (!match) return DATA_STATE.NONE;
  if (match.tbd) return DATA_STATE.TBD;

  const hasScore = typeof match.sc === 'string' && /^\d+-\d+$/.test(match.sc);
  if (match.st === 'done') return hasScore ? DATA_STATE.OK : DATA_STATE.MISSING;
  if (match.st === 'pp') return DATA_STATE.POSTPONED;
  if (hasScore) return DATA_STATE.OK; // 极端情况：状态未同步但比分已在

  const kick = ts(match.t);
  if (!Number.isFinite(kick)) return DATA_STATE.MISSING;
  const end = kick + MATCH_DURATION_MS;
  if (nowTs < end) return DATA_STATE.UPCOMING;
  return nowTs - end <= MISSING_AFTER_MS ? DATA_STATE.PENDING : DATA_STATE.MISSING;
}

const LABELS = {
  [DATA_STATE.NONE]: '—',
  [DATA_STATE.OK]: '已同步',
  [DATA_STATE.UPCOMING]: '未开赛',
  [DATA_STATE.PENDING]: '待同步',
  [DATA_STATE.MISSING]: '上游未提供',
  [DATA_STATE.TBD]: '开球时间待定',
  [DATA_STATE.POSTPONED]: '已延期'
};

export function dataStateLabel(state) {
  return LABELS[state] || '—';
}

/**
 * 「数据可信度」单元格的措辞 —— 与 `dataStateLabel` 的区别只在 `upcoming`：
 * 那格回答的是「这份快照有多可信」，不是「比赛到哪一步」，所以叫「赛前快照」。
 * 双端共用，勿在界面再写一份。
 */
const TRUST_LABELS = {
  [DATA_STATE.OK]: '已同步',
  [DATA_STATE.UPCOMING]: '赛前快照',
  [DATA_STATE.PENDING]: '待同步',
  [DATA_STATE.MISSING]: '上游未提供',
  [DATA_STATE.TBD]: '时间待定',
  [DATA_STATE.POSTPONED]: '已延期'
};

export function dataStateTrustLabel(state) {
  return TRUST_LABELS[state] || dataStateLabel(state);
}

/** 只有这两种状态值得给「重查该场」入口：其余重查没有意义 */
export function canRecheck(state) {
  return state === DATA_STATE.PENDING || state === DATA_STATE.MISSING;
}

/** 状态语气：与界面语义色对应（warn = 还能补救，danger = 别等了） */
export function dataStateTone(state) {
  if (state === DATA_STATE.PENDING) return 'warn';
  if (state === DATA_STATE.MISSING) return 'danger';
  return 'muted';
}

/**
 * 一句人能读懂的说明
 *
 * 注意文案里的「24 小时」与 MISSING_AFTER_MS 必须同源 —— 阈值改了这个句子要跟着改。
 */
export function dataStateHint(state, checkedAt = 0, nowTs = Date.now(), canRecheck = true) {
  const checked = Number.isFinite(checkedAt) && checkedAt > 0 ? formatClock(checkedAt) : null;
  // 「可以重查一次」只有在调用方真的提供重查按钮时才成立 —— 手机端没有这个入口，
  // 照搬会让文案把用户指向一个不存在的操作。
  const tail = canRecheck ? '可以重查一次，或直接去官方平台看。' : '可以直接去官方平台看。';
  switch (state) {
    case DATA_STATE.PENDING:
      return checked
        ? `已过完赛时间，最后一次检查在 ${checked}，稍后会自动再查。`
        : '已过完赛时间，比分还没有同步进来。';
    case DATA_STATE.MISSING:
      return checked
        ? `最后一次检查在 ${checked}，上游仍未提供这场比分。${tail}`
        : `上游没有提供这场比分。${tail}`;
    case DATA_STATE.UPCOMING:
      return '比赛还没开始，不需要比分。';
    case DATA_STATE.TBD:
      return '联赛尚未公布开球时间，时间确定后才会有比分。';
    case DATA_STATE.POSTPONED:
      return '这场已延期，新时间公布后会更新。';
    case DATA_STATE.OK:
      return '比分已从上游同步到本地。';
    default:
      return '';
  }
}

/** 时间戳 → 北京墙钟 HH:mm（本模块自用，避免为了一个格式化引入整包依赖） */
function formatClock(ms) {
  const d = new Date(Number(ms) + 8 * 3600000);
  const pad = n => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
