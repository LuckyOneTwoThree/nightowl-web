/**
 * 赛程变动的文案层（纯函数）
 *
 * 服务端只给结构化差异（kind / from / to），中文怎么说在这里统一 ——
 * 界面、通知、以后的手機端都用同一份，避免三处各写一套。
 */

import { hm } from './format.js';

/** 单条变动的短描述（用于列表行） */
export function describeChange(change) {
  if (!change) return '有变动';
  if (change.kind === 'time') {
    if (change.fromTbd) return `开球时间已确定：${hm(change.to)}`;
    return `${hm(change.from)} → ${hm(change.to)}`;
  }
  if (change.kind === 'postponed') return '已延期';
  if (change.kind === 'resumed') return '恢复赛程';
  return '有变动';
}

/** 一句话标题：先给结论，再给细节 */
export function summarizeChanges(changes) {
  const list = Array.isArray(changes) ? changes : [];
  if (!list.length) return { total: 0, title: '', detail: '' };
  const byKind = list.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  const parts = [];
  if (byKind.time) parts.push(`${byKind.time} 场时间调整`);
  if (byKind.postponed) parts.push(`${byKind.postponed} 场延期`);
  if (byKind.resumed) parts.push(`${byKind.resumed} 场恢复`);
  return {
    total: list.length,
    title: `计划有变 · ${list.length} 场`,
    detail: parts.join(' · ')
  };
}
