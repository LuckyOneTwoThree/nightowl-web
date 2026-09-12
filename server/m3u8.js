/**
 * M3U8 全量 URI 重写
 *
 * 为什么必须做全：直播流 CDN 校验 Referer，代理要剥掉；而 M3U8 里**凡是 URI 载体都要改写**，
 * 漏一条就会出现「能起播但一拖进度条就崩」或「切清晰度失败」这类隐蔽问题。
 *
 * 覆盖的 8 类载体（依据《开工前技术检查清单》Step 2）：
 *   ① 普通分片行（.ts / .m4s 等）            → 非注释行
 *   ② #EXT-X-STREAM-INF 下一行的变体 URI      → 非注释行（最常见坑，入口通常是主清单）
 *   ③ #EXT-X-KEY:URI="…"                     → AES 密钥地址，漏则解密失败黑屏
 *   ④ #EXT-X-MAP:URI="…"                     → fMP4 初始化段，漏则起播黑屏
 *   ⑤ #EXT-X-MEDIA:URI="…"                   → 独立音轨/字幕轨，漏则「英文原声」线路作废
 *   ⑥ #EXT-X-I-FRAME-STREAM-INF:URI="…"      → 拖动预览缩略图
 *   ⑦ #EXT-X-PART:URI="…"                    → 低延迟 HLS 分片
 *   ⑧ 相对路径绝对化                          → 先按入口 URL 解析为绝对地址，再包代理
 *
 * 额外覆盖（同族标签，一并处理）：
 *   #EXT-X-SESSION-KEY / #EXT-X-PRELOAD-HINT / #EXT-X-RENDITION-REPORT /
 *   #EXT-X-SESSION-DATA / #EXT-X-DEFINE(URI=)
 *
 * ⚠️ 本文件是纯函数，不依赖网络——可用离线用例完整验证（见 tools/test-m3u8.mjs）。
 */

/** 默认代理前缀：目标地址以 encodeURIComponent 编码后跟在 url= 之后 */
export const DEFAULT_PROXY_BASE = '/api/proxy?url=';

/** 携带 URI 属性的标签前缀（大小写不敏感） */
const URI_ATTR_TAG = /^#EXT-X-(KEY|SESSION-KEY|MAP|MEDIA|I-FRAME-STREAM-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SESSION-DATA|DEFINE)/i;

/** 把可能是相对路径的地址按 baseUrl 解析为绝对地址（已是绝对地址则原样返回） */
export function resolveUrl(baseUrl, target) {
  return new URL(target, baseUrl).toString();
}

/** 包成代理路径（已是代理路径则原样返回，保证幂等） */
export function wrapUrl(absoluteUrl, proxyBase = DEFAULT_PROXY_BASE) {
  if (absoluteUrl.startsWith(proxyBase)) return absoluteUrl;
  return `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
}

/** 该行是否已经是被包裹过的代理地址（避免二次包裹） */
function isAlreadyProxied(raw, proxyBase) {
  return raw.startsWith(proxyBase);
}

/**
 * 重写一段 M3U8 文本
 * @param {string} text     原始 playlist 文本
 * @param {string} baseUrl  playlist 自身的绝对地址（用于解析相对路径）
 * @param {string} proxyBase 代理前缀
 * @returns {{ text: string, rewritten: number, kinds: Record<string, number> }}
 */
export function rewritePlaylist(text, baseUrl, proxyBase = DEFAULT_PROXY_BASE) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  const kinds = { segment: 0, variant: 0, attrUri: 0 };
  let expectVariantUri = false;

  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();

    // 空行：原样保留
    if (trimmed === '') {
      out.push(line);
      continue;
    }

    // 注释 / 标签行
    if (trimmed.startsWith('#')) {
      if (URI_ATTR_TAG.test(trimmed)) {
        // 该标签可能带 URI="…"；逐个替换（有些标签带多个 URI，如 SESSION-DATA）
        const next = line.replace(/URI="([^"]*)"/gi, (m, u) => {
          if (!u) return m;
          kinds.attrUri++;
          return `URI="${wrapUrl(resolveUrl(baseUrl, u), proxyBase)}"`;
        });
        out.push(next);
      } else {
        out.push(line);
      }

      // 标记：下一条非注释行是变体清单地址
      if (/^#EXT-X-STREAM-INF:/i.test(trimmed)) expectVariantUri = true;
      // 其它标签出现时清掉标记（避免误吞后续分片行）
      else if (trimmed !== '' && !trimmed.startsWith('#EXT-X-STREAM-INF')) {
        // 不立即清空：STREAM-INF 与 URI 之间只允许空行
      }
      continue;
    }

    // 非注释行 = URI（分片 或 变体清单）
    // 已是代理地址则跳过，避免二次包裹（例如上游引用了本地代理路径）
    if (isAlreadyProxied(trimmed, proxyBase)) {
      out.push(line);
      expectVariantUri = false;
      continue;
    }

    const abs = resolveUrl(baseUrl, trimmed);
    if (expectVariantUri) {
      kinds.variant++;
      expectVariantUri = false;
    } else {
      kinds.segment++;
    }
    // 保留原始行首尾空白（部分 CDN 对缩进敏感，宁可原样）
    out.push(line.replace(trimmed, wrapUrl(abs, proxyBase)));
  }

  return {
    text: out.join(eol),
    rewritten: kinds.segment + kinds.variant + kinds.attrUri,
    kinds
  };
}

/** 判断响应是否应按 M3U8 处理 */
export function isPlaylistResponse(contentType = '', url = '') {
  const ct = String(contentType).toLowerCase();
  if (ct.includes('mpegurl') || ct.includes('m3u')) return true;
  return /\.m3u8?(\?|$)/i.test(String(url));
}

/** M3U8 索引一律不缓存；分片可长缓存（技术检查清单 Step 2） */
export function cacheControlFor(url, contentType = '') {
  return isPlaylistResponse(contentType, url)
    ? 'no-store, no-cache, must-revalidate'
    : 'public, max-age=31536000, immutable';
}
