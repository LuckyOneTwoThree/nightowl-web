import { useEffect, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { inferMediaType } from '../core/media.js';
import { IconVolume } from './icons.jsx';

/** 主题色兜底值：与 index.css 的 --accent 保持一致，仅在读取变量失败时使用 */
const FALLBACK_THEME = '#F5B942';

/** 音量偏好的落点：首次起播默认静音（凌晨自动换线不再 50% 音量外放），
 *  用户动过音量/静音后记住最后状态，之后起播沿用。 */
const LS_VOLUME = 'nightowl:player_volume';
const LS_MUTED = 'nightowl:player_muted';

function readVolumePrefs() {
  let volume = 0.5;
  let muted = null; // null = 从未设置（首次使用）
  try {
    const v = Number(localStorage.getItem(LS_VOLUME));
    if (Number.isFinite(v) && v > 0 && v <= 1) volume = v;
    const m = localStorage.getItem(LS_MUTED);
    if (m !== null) muted = m === '1';
  } catch {
    /* localStorage 不可用时按首次使用处理 */
  }
  return { volume, muted, firstRun: muted === null };
}

function saveVolumePrefs(volume, muted) {
  try {
    if (Number.isFinite(volume) && volume > 0) localStorage.setItem(LS_VOLUME, String(volume));
    localStorage.setItem(LS_MUTED, muted ? '1' : '0');
  } catch {
    /* 忽略：偏好保存失败不影响播放 */
  }
}

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
 *   · 首次使用默认静音起播，画面中央给「开启声音」入口；音量/静音偏好持久化
 *   · 切换线路时保留时间轴（FR-P-07）——销毁前记录 currentTime，新实例 ready 后 seek 回去
 *   · 只支持 m3u8 与 mp4；FLV 需 mpegts.js，本版不承诺（PRD：仅 Chromium 增强，非跨浏览器承诺）
 */
export default function Player({
  src,
  kind = null,
  onError,
  onLoadStart,
  theme = null,
  onAspectRatio = null,
  onReady = null
}) {
  const boxRef = useRef(null);
  const artRef = useRef(null);
  const hlsRef = useRef(null);
  const resumeAtRef = useRef(0);
  // 「首次使用自动静音」的中央提示；用户开过声音或 8 秒未操作后不再打扰
  const [mutedHint, setMutedHint] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !src) return undefined;

    const resume = resumeAtRef.current;
    const type = inferMediaType(src, kind);
    const prefs = readVolumePrefs();
    const startMuted = prefs.firstRun ? true : !!prefs.muted;
    // 只在「从未设置过偏好」（首次使用）时显示中央提示；沿用用户偏好的静音不打扰
    setMutedHint(prefs.firstRun);
    let art = null;

    try {
      art = new Artplayer({
        container: box,
        url: src,
        type,
        theme: theme || tokenColor('--accent'),
        volume: prefs.volume,
        muted: startMuted,
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
      onReady?.(art);

      art.on('video:volumechange', () => {
        saveVolumePrefs(art.volume, art.muted);
        if (!art.muted) setMutedHint(false);
      });

      art.on('video:loadedmetadata', () => {
        if (art.video?.videoWidth && art.video?.videoHeight) {
          const r = art.video.videoWidth / art.video.videoHeight;
          if (r > 0.5 && r < 3) {
            onAspectRatio?.(r);
          }
        }
      });

      art.on('ready', () => {
        // 视频就绪时如果已有元数据也尝试上报
        if (art.video?.videoWidth && art.video?.videoHeight) {
          const r = art.video.videoWidth / art.video.videoHeight;
          if (r > 0.5 && r < 3) {
            onAspectRatio?.(r);
          }
        }
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

    // 中央提示最多停留 8 秒：纯看画面不要声音的用户不该被一直挡着
    const hintTimer = setTimeout(() => setMutedHint(false), 8000);

    return () => {
      clearTimeout(hintTimer);
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
    // ⚠️ 回调必须进依赖数组：effect 内部读了 onError / onLoadStart / onAspectRatio。
    //    当前 PlayerStage 传入的是稳定的 setState 引用，故不会引发重建；
    //    但一旦传入内联函数，缺依赖会让回调读到首次渲染的过期闭包。
  }, [src, kind, onError, onLoadStart, onAspectRatio, onReady]);

  /** 中央「开启声音」：解除静音并持久化，让下次起播沿用 */
  const enableSound = () => {
    const art = artRef.current;
    if (!art || art.destroyed) return;
    try {
      if (art.volume <= 0) art.volume = 0.5;
      art.muted = false;
    } catch {
      /* 忽略：实例异常时提示自动消失即可 */
    }
    setMutedHint(false);
  };

  return (
    <div className="relative h-full w-full">
      <div ref={boxRef} className="h-full w-full [&_.art-video-player]:!bg-black" />
      {mutedHint && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <button
            type="button"
            onClick={enableSound}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-3.5 py-1.5 text-2xs font-medium text-text-primary shadow-card backdrop-blur-md transition-colors hover:bg-black/85 cursor-pointer"
          >
            <IconVolume size={12} />
            点击开启声音
          </button>
        </div>
      )}
    </div>
  );
}
