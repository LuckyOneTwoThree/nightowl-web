/**
 * 观赛源深链
 *
 * 纯函数，放 core 以便 Node 侧直接测试：
 *   · 直播/赛前 → searchTemplate（单队名）或首页
 *   · 赛后 → replayTemplate（双方队名 + 回放），没有再退回 searchTemplate
 *
 * 模板只接受 {q}；调用方负责把最终 URL 交给系统浏览器。
 */

import { teamName } from '../data/index.js';

export function replayQuery(match) {
  if (!match) return '回放';
  return `${teamName(match.h)} ${teamName(match.a)} 回放`;
}

export function sourceUrlFor(src, match, { replay = false } = {}) {
  const tpl = replay ? src?.replayTemplate || src?.searchTemplate : src?.searchTemplate;
  if (tpl && match) {
    const q = replay ? replayQuery(match) : teamName(match.h);
    return tpl.replace('{q}', encodeURIComponent(q));
  }
  return src?.homeUrl || '';
}
