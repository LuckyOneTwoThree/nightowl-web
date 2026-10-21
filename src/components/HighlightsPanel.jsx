import { useEffect, useState } from 'react';
import { teamName } from '../data/index.js';
import { Button, IconButton, Meta, SectionLabel } from './atoms.jsx';
import { IconExternal, IconPlay, IconReset, IconReveal, IconWarn } from './icons.jsx';

/**
 * 赛后官方集锦
 *
 * · 默认外链：YouTube 官方播放器可能有地区/嵌入限制，外链是最稳的降级
 * · 防剧透：未揭晓比分时不请求、不展示标题——集锦标题本身就含比分
 * · 只展示服务端校验过的 youtube.com/watch 地址
 */
function isYouTube(url) {
  return /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(String(url || ''));
}

function openExternal(url) {
  if (!isYouTube(url)) return;
  if (window.desktop?.openExternal) window.desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export default function HighlightsPanel({ match, spoilerFree = true, revealed = false, onReveal }) {
  const finished = match?.st === 'done';
  const hidden = finished && spoilerFree && !revealed;
  const [status, setStatus] = useState('idle');
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!finished || hidden) {
      setStatus(hidden ? 'hidden' : 'idle');
      setData(null);
      return undefined;
    }

    const ac = new AbortController();
    let alive = true;
    setStatus('loading');
    setData(null);

    // 连续点选完赛场次时合并请求；服务端也有 7 天缓存
    const timer = setTimeout(async () => {
      try {
        const refresh = nonce > 0 ? '&refresh=1' : '';
        const res = await fetch(
          `/api/highlights?matchId=${encodeURIComponent(match.id)}${refresh}`,
          { signal: ac.signal }
        );
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        if (!alive) return;
        if (j?.ok) {
          setData(j);
          setStatus(j.videos?.length ? 'ready' : 'empty');
        } else {
          setStatus('error');
        }
      } catch (err) {
        if (alive && err?.name !== 'AbortError') setStatus('error');
      }
    }, 350);

    return () => {
      alive = false;
      clearTimeout(timer);
      ac.abort();
    };
  }, [finished, hidden, match?.id, nonce]);

  if (!finished) return null;

  if (hidden) {
    return (
      <div className="mt-2.5 shrink-0 border-t border-line-hairline pt-2.5">
        <SectionLabel>官方集锦</SectionLabel>
        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-raised/40 px-2.5 py-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
            <IconReveal size={12} />
            揭晓比分后可查看
          </span>
          <Button variant="ghost" onClick={onReveal}>
            揭晓比分
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 shrink-0 border-t border-line-hairline pt-2.5">
      <SectionLabel
        right={
          <span className="inline-flex items-center gap-1.5">
            <Meta>YouTube · TheSportsDB</Meta>
            {status !== 'loading' && (
              <IconButton
                label="重新查找集锦"
                onClick={() => setNonce(v => v + 1)}
                className="h-5 w-5"
              >
                <IconReset size={11} />
              </IconButton>
            )}
          </span>
        }
      >
        官方集锦
      </SectionLabel>

      {status === 'loading' && (
        <div className="mt-1.5 rounded-md border border-dashed border-line-hairline bg-surface-raised/30 px-2.5 py-3 text-center text-2xs text-text-muted">
          正在查找官方集锦…
        </div>
      )}

      {status === 'ready' && data?.videos?.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {data.videos.map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => openExternal(v.url)}
              title={v.eventName || '官方集锦'}
              className="flex w-full items-center gap-2 rounded-md border border-line-hairline bg-surface-raised/50 px-2.5 py-2 text-left transition-colors hover:border-line-control hover:bg-surface-accent/60 focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:outline-none"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <IconPlay size={12} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-2xs font-medium text-text-primary">
                  {teamName(match.h)} vs {teamName(match.a)}
                </span>
                <span className="mt-0.5 block truncate text-2xs text-text-muted">
                  官方集锦 · 在浏览器打开
                </span>
              </span>
              <IconExternal size={12} className="shrink-0 text-text-faint" />
            </button>
          ))}
          <p className="text-2xs leading-relaxed text-text-faint">
            视频来自官方频道；本应用不代理、不下载视频。
          </p>
        </div>
      )}

      {status === 'empty' && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-dashed border-line-hairline bg-surface-raised/30 px-2.5 py-2 text-2xs leading-relaxed text-text-muted">
          <IconWarn size={12} className="mt-0.5 shrink-0 text-text-faint" />
          <span>暂未索引到官方集锦。可去下方官方平台搜索本场回放。</span>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-raised/30 px-2.5 py-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
            <IconWarn size={12} className="shrink-0 text-warn" />
            集锦索引暂不可用
          </span>
          <Button variant="ghost" onClick={() => setNonce(v => v + 1)}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
