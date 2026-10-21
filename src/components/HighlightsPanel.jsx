import { useEffect, useState } from 'react';
import { teamName } from '../data/index.js';
import { highlightSources, sourceUrlFor } from '../core/watch-sources.js';
import { Button, IconButton, Meta, SectionLabel } from './atoms.jsx';
import { IconExternal, IconPlay, IconReset, IconReveal, IconWarn } from './icons.jsx';

/**
 * 赛后官方集锦
 *
 * · 国内优先：咪咕/爱奇艺体育/央视频/CCTV 只做官方站内搜索深链，不解析视频
 * · 国际源：YouTube 官方播放器可能有地区/嵌入限制，外链是最稳的降级
 * · 防剧透：未揭晓比分时不请求、不展示标题——搜索结果和集锦标题都可能含比分
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

export default function HighlightsPanel({
  match,
  sources = [],
  spoilerFree = true,
  revealed = false,
  onReveal
}) {
  const finished = match?.st === 'done';
  const hidden = finished && spoilerFree && !revealed;
  const [status, setStatus] = useState('idle');
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const domestic = finished ? highlightSources(sources, match?.l) : [];

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
        right={<Meta>{domestic.length ? '国内官方 · 需登录/会员' : 'YouTube · TheSportsDB'}</Meta>}
      >
        官方集锦
      </SectionLabel>

      {domestic.length > 0 && (
        <>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {domestic.map(s => {
              const url = sourceUrlFor(s, match, { highlight: true });
              return (
                <a
                  key={s.id}
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`在${s.name}搜索本场集锦（可能需要登录或会员）`}
                  onClick={e => {
                    if (window.desktop?.openExternal && url) {
                      e.preventDefault();
                      window.desktop.openExternal(url);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-line-control bg-surface-raised px-2.5 py-1 text-2xs text-text-secondary transition-colors hover:border-line-control hover:bg-surface-accent hover:text-text-primary focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:outline-none"
                >
                  <IconExternal size={10} />
                  {s.name}
                </a>
              );
            })}
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-text-faint">
            跳转官方站内搜索，需登录或会员；本应用不代理视频。
          </p>
        </>
      )}

      <div className={domestic.length > 0 ? 'mt-2 border-t border-line-hairline pt-2' : 'mt-1.5'}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-2xs text-text-faint">
            <IconPlay size={10} />
            国际源 · YouTube
          </span>
          {status !== 'loading' && (
            <IconButton
              label="重新查找国际集锦"
              onClick={() => setNonce(v => v + 1)}
              className="h-5 w-5"
            >
              <IconReset size={11} />
            </IconButton>
          )}
        </div>

        {status === 'loading' && (
          <div className="mt-1.5 space-y-1.5" aria-busy="true" aria-label="正在查找官方集锦">
            <span className="skeleton block h-9 w-full" />
            <span className="skeleton block h-2.5 w-2/3" />
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
                    YouTube · 在浏览器打开
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
            <span>
              {domestic.length > 0
                ? 'YouTube 未索引到本场集锦，可先用上方国内官方入口。'
                : '暂未索引到官方集锦。可去下方官方平台搜索本场回放。'}
            </span>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-raised/30 px-2.5 py-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
              <IconWarn size={12} className="shrink-0 text-warn" />
              国际集锦索引暂不可用
            </span>
            <Button variant="ghost" onClick={() => setNonce(v => v + 1)}>
              重试
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
