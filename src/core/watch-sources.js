/**
 * 观赛源深链
 *
 * 纯函数，放 core 以便 Node 侧直接测试：
 *   · 直播/赛前 → searchTemplate（单队名）或首页
 *   · 赛后回放 → replayTemplate（双方队名 + 回放），再退回 searchTemplate
 *   · 赛后集锦 → highlightTemplate（双方队名 + 集锦），再退回 searchTemplate
 *
 * 模板只接受 {q}；调用方负责把最终 URL 交给系统浏览器。
 * 集锦只做官方站内搜索，不解析视频地址。
 */

import { teamName } from '../data/index.js';

export function replayQuery(match) {
  if (!match) return '回放';
  return `${teamName(match.h)} ${teamName(match.a)} 回放`;
}

export function highlightQuery(match) {
  if (!match) return '集锦';
  return `${teamName(match.h)} ${teamName(match.a)} 集锦`;
}

export function sourceUrlFor(src, match, { replay = false, highlight = false } = {}) {
  const tpl = highlight
    ? src?.highlightTemplate || src?.searchTemplate
    : replay
      ? src?.replayTemplate || src?.searchTemplate
      : src?.searchTemplate;
  if (tpl && match) {
    const q = highlight ? highlightQuery(match) : replay ? replayQuery(match) : teamName(match.h);
    return tpl.replace('{q}', encodeURIComponent(q));
  }
  return src?.homeUrl || '';
}

/**
 * 集锦入口排序：本联赛的已知官方平台排前，其余保持注册表顺序。
 * leagues 只作排序提示，不作版权过滤——不确定时仍然展示全部入口。
 */
export function highlightSources(sources, league) {
  return (sources || [])
    .filter(s => s?.kind === 'deeplink' && (s.highlightTemplate || s.searchTemplate))
    .map((s, index) => ({ s, index, known: Array.isArray(s.leagues) && s.leagues.includes(league) }))
    .sort((a, b) => Number(b.known) - Number(a.known) || a.index - b.index)
    .map(x => x.s);
}
