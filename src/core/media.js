/**
 * 媒体类型判定
 *
 * 为什么要抽成独立模块：
 *   这段逻辑原先埋在 React 组件内部（Player.jsx 的局部函数），
 *   Node 侧完全测不到，于是「带 query 的 m3u8 经本地代理后被判成 mp4」这个缺陷
 *   一路溜到了可运行状态 —— 表现为点开任何一条真实直播源都是黑屏。
 *
 * 两个必须同时成立的设计：
 *   1. **显式 kind 优先**。线路对象自己带着正确答案（scraper 产出的 kind 字段），
 *      没有理由丢掉它再去嗅探 URL。
 *   2. **URL 嗅探要解得开代理地址**。播放器拿到的是
 *      `/api/proxy?url=<encodeURIComponent(直链)>`：encode 会把直链里的 `?` 变成 `%3F`，
 *      若直接对整串做 `/\.m3u8(\?|$)/`，两头都会落空（既没有 `?` 也不是结尾）。
 */

/** 从代理地址中取出被包裹的真实地址；不是代理地址则原样返回 */
export function unwrapProxyUrl(url) {
  const s = String(url || '');
  const m = /[?&]url=([^&]+)/.exec(s);
  if (!m) return s;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1]; // 编码损坏时不抛错，交给下游判断
  }
}

/**
 * 是否为 HLS（m3u8）地址
 * 扩展名后允许是 `?`（查询串）、`#`（片段）或字符串结束。
 */
export function isHlsUrl(url) {
  const inner = unwrapProxyUrl(url);
  return /\.m3u8(\?|#|$)/i.test(inner);
}

/**
 * 推断媒体类型，供播放器决定用 hls.js 还是原生 src
 * @param {string} url 播放地址（可能是本地代理地址）
 * @param {string|null} kind 数据源给出的显式类型（'m3u8' | 'mp4' | 'embed' | 'other'）
 * @returns {'m3u8'|'mp4'}
 */
export function inferMediaType(url, kind) {
  if (kind === 'm3u8' || kind === 'mp4') return kind;
  return isHlsUrl(url) ? 'm3u8' : 'mp4';
}
