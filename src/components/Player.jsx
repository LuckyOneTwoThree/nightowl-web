import { useEffect, useRef } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { inferMediaType } from '../core/media.js';

/** 主题色兜底值：与 index.css 的 --accent 保持一致，仅在读取变量失败时使用 */
const FALLBACK_THEME = '#F5B942';

/** 从 CSS token 取色，避免播放器与界面各写一份品牌色 */
function tokenColor(name) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v.startsWith('#') ? v : FALLBACK_THEME;
  } catch {
    return FALLBACK_THEME;
  }
}

/**
 * 播放器（ArtPlayer + hls.js）
 *
 * 约定：
 *   · 传入的 src 应为**本地代理地址**（/api/proxy?url=...），由代理剥防盗链并重写 M3U8
 *   · kind 为数据源给出的显式类型，**优先于 URL 嗅探**。
 *     原因：代理地址形如 /api/proxy?url=<encodeURIComponent(直链)>，encode 会把直链里的
 *     `?` 变成 `%3F`，单靠 URL 嗅探会把「带 query 的 m3u8」判成 mp4，结果是黑屏。
 *     线路对象本来就带正确的 kind（scraper 产出），没有理由丢掉它去猜。
 *   · 默认 50% 音量非静音起播
 *   · 切换线路时保留时间轴（FR-P-07）——销毁前记录 currentTime，新实例 ready 后 seek 回去
 *   · 只支持 m3u8 与 mp4；FLV 需 mpegts.js，本版不承诺（PRD：仅 Chromium 增强，非跨浏览器承诺）
 */
export default function Player({ src, kind = null, onError, onLoadStart, theme = null }) {
  const boxRef = useRef(null);
  const artRef = useRef(null);
  const hlsRef = useRef(null);
  const resumeAtRef = useRef(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !src) return undefined;

    const resume = resumeAtRef.current;
    const type = inferMediaType(src, kind);
    let art = null;

    try {
      art = new Artplayer({
        container: box,
        url: src,
        type,
        theme: theme || tokenColor('--accent'),
        volume: 0.5,
        muted: false,
        autoplay: true,
        pip: true,
        setting: true,
        hotkey: true,
        fullscreen: true,
        fullscreenWeb: true,
        playbackRate: true,
        lock: false,
        customType: {
          m3u8: (video, url) => {
            if (Hls.isSupported()) {
              const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
              hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (data?.fatal) {
                  onError?.(`HLS 致命错误：${data.type} / ${data.details}`);
                }
              });
              hls.loadSource(url);
              hls.attachMedia(video);
              hlsRef.current = hls;
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = url; // Safari 原生 HLS
            } else {
              onError?.('当前环境不支持 HLS 播放');
            }
          }
        }
      });

      artRef.current = art;
      onLoadStart?.();

      art.on('ready', () => {
        // 切线路保留时间轴
        if (resume > 0) {
          try {
            art.seek = resume;
          } catch {
            /* 某些直播流不支持 seek，忽略 */
          }
        }
      });
      art.on('error', err => onError?.(String(err?.message || err)));
    } catch (err) {
      onError?.(`播放器初始化失败：${err?.message || err}`);
    }

    return () => {
      if (art && !art.destroyed) {
        try {
          resumeAtRef.current = art.currentTime || 0;
        } catch {
          resumeAtRef.current = 0;
        }
      }
      try {
        hlsRef.current?.destroy?.();
      } catch {
        /* 忽略 */
      }
      hlsRef.current = null;
      try {
        if (art && !art.destroyed) art.destroy(false);
      } catch {
        /* 忽略 */
      }
      artRef.current = null;
    };
  }, [src, kind]);

  return <div ref={boxRef} className="h-full w-full [&_.art-video-player]:!bg-black" />;
}
