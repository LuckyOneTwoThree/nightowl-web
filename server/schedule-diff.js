/**
 * 赛程变动检测（纯函数）
 *
 * 产品口径（PRD FR-05）：一次成功同步后，关注球队 / 计划精选 / 补看队列中的比赛
 * 若「开球时间变化 ≥ 5 分钟」或「状态变为延期」，必须让用户知道 ——
 * 否则用户按旧时间安排睡眠，到了点发现比赛已经改期。
 *
 * 为什么只做三种变化：
 *   · time       开球时间变了（含原本 tbd 现在公布时间）
 *   · postponed  变成延期
 *   · resumed    延期后又回到有安排
 *   比分写入不算「计划变化」—— 那是数据保鲜，不是日程变更，混在一起会让提醒变成噪声。
 *
 * 判定放在服务端：只有服务端能同时看到「同步前」与「同步后」两份 fixtures。
 */

import { ts } from '../src/core/engine.js';

/** 时间变化小于这个阈值不提醒（上游经常有几秒到几分钟的对齐误差） */
export const TIME_CHANGE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * @param {Array} before 同步前的 fixtures
 * @param {Array} after  应用补丁后的 fixtures
 * @param {object} [opts]
 * @returns {Array<{id:string, league:string, h:string, a:string, kind:string, from:any, to:any}>}
 */
export function diffFixtures(before, after, opts = {}) {
  const threshold = Number.isFinite(opts.timeThresholdMs) ? opts.timeThresholdMs : TIME_CHANGE_THRESHOLD_MS;
  const prevById = new Map((before || []).map(m => [m.id, m]));
  const changes = [];

  for (const next of after || []) {
    const prev = prevById.get(next.id);
    if (!prev) continue; // 新增场次不在本阶段范围（数据只走脚本）

    // 1) 开球时间
    const prevTs = ts(prev.t);
    const nextTs = ts(next.t);
    const wasTbd = !!prev.tbd;
    const timeMoved =
      Number.isFinite(prevTs) && Number.isFinite(nextTs) && Math.abs(nextTs - prevTs) >= threshold;
    if (timeMoved) {
      changes.push({
        id: next.id,
        league: next.l,
        h: next.h,
        a: next.a,
        kind: 'time',
        from: prev.t,
        to: next.t,
        // 从「待定」变成「确定」是好事，文案要区分，不该读成改期
        fromTbd: wasTbd
      });
      continue;
    }

    // 2) 状态：延期 / 恢复
    if (prev.st !== next.st) {
      if (next.st === 'pp') {
        changes.push({ id: next.id, league: next.l, h: next.h, a: next.a, kind: 'postponed', from: prev.st, to: next.st });
      } else if (prev.st === 'pp' && next.st === 'sched') {
        changes.push({ id: next.id, league: next.l, h: next.h, a: next.a, kind: 'resumed', from: prev.st, to: next.st });
      }
      // prev.st === 'sched' && next.st === 'done'（比分补上）不算计划变化
    }
  }

  return changes;
}
