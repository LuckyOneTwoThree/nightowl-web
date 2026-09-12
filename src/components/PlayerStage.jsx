import { lazy, Suspense, useEffect, useState } from 'react';
import { hm, zhDate, weekdayOf, datePart, liveMinute, humanCountdown } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts } from '../core/engine.js';
import { Crest, Pill, LiveDot } from './atoms.jsx';

/**
 * 播放器懒加载：ArtPlayer + hls.js 约 700KB，不应计入首屏。
 * 只在用户真正点播放时才拉这个 chunk。
 */
const Player = lazy(() => import('./Player.jsx'));

/** 服务不可用时的最小回退清单（保证 dev 不开本地服务也能跳转） */
const FALLBACK_SOURCES = [
  {
    id: 'yangshipin',
    name: '央视频',
    kind: 'deeplink',
    homeUrl: 'https://yangshipin.cn/',
    searchTemplate: 'https://yangshipin.cn/search?keyword={q}'
  },
  { id: 'zhibo8', name: '直播吧', kind: 'portal', homeUrl: 'https://www.zhibo8.com/', searchTemplate: null }
];

/**
 * 观赛源来自本地服务的外置注册表（server/watch-sources.json），
 * 经 /api/watch-sources 提供 —— 改注册表不重新构建。
 */
function useWatchSources() {
  const [sources, setSources] = useState(FALLBACK_SOURCES);
  useEffect(() => {
    let alive = true;
    fetch('/api/watch-sources')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => {
        if (!alive) return;
        const all = [...(j.official || []), ...(j.watch || [])];
        if (all.length) setSources(all);
      })
      .catch(() => {
        /* 本地服务未启动 → 保持回退清单 */
      });
    return () => {
      alive = false;
    };
  }, []);
  return sources;
}

/** 有搜索模板的用主队名构造搜索，否则打开首页 */
export function sourceUrlFor(src, match) {
  if (src.searchTemplate && match) {
    return src.searchTemplate.replace('{q}', encodeURIComponent(teamName(match.h)));
  }
  return src.homeUrl;
}

export default function PlayerStage({ match, state, now, countdown }) {
  const sources = useWatchSources();
  const [input, setInput] = useState('');
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState(null);
  const [authorizing, setAuthorizing] = useState(false);

  // 换场次时清空当前直链，避免拿上一场的源播下一场
  useEffect(() => {
    setStreamUrl(null);
    setError(null);
  }, [match?.id]);

  const proxyUrl = streamUrl ? `/api/proxy?url=${encodeURIComponent(streamUrl)}` : null;

  /** 粘贴直链 → 会话内授权域名 → 交给本地代理播放 */
  const play = async () => {
    const raw = input.trim();
    if (!raw) return;
    let u;
    try {
      u = new URL(raw);
    } catch {
      setError('地址不合法，请粘贴完整的 http(s) 链接');
      return;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      setError('仅支持 http / https 地址');
      return;
    }

    setAuthorizing(true);
    setError(null);
    try {
      // 先在本机会话内显式授权该域名（仅内存、重启失效），再由代理剥防盗链播放
      const r = await fetch('/api/proxy/allow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: u.hostname })
      });
      const j = await r.json();
      if (!j.ok) {
        const why = (j.results || []).map(x => `${x.host}: ${x.reason || '被拒绝'}`).join('；');
        setError(`域名授权失败 —— ${why || '未知原因'}`);
        return;
      }
      setStreamUrl(raw);
    } catch (e) {
      setError(`无法连接本地服务（npm run server）：${e.message}`);
    } finally {
      setAuthorizing(false);
    }
  };

  if (!match) {
    return (
      <div className="flex aspect-video max-h-[46vh] w-full items-center justify-center rounded-xl border border-border-subtle bg-black/60">
        <p className="text-[11px] text-slate-500">从左侧选择一场比赛</p>
      </div>
    );
  }

  const kickTs = ts(match.t);
  const live = state === 'live';
  const minute = live ? liveMinute(kickTs, now) : 0;
  const finished = state === 'finished';

  return (
    <div className="flex flex-col gap-2.5">
      {/* 16:9 播放容器 */}
      <div className="relative aspect-video max-h-[46vh] w-full overflow-hidden rounded-xl border border-border-subtle bg-black">
        {streamUrl ? (
          <Suspense
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-black">
                <span className="font-mono text-[11px] text-slate-400">正在加载播放器…</span>
              </div>
            }
          >
            <Player src={proxyUrl} onError={setError} />
          </Suspense>
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgba(255,184,0,0.10),transparent_60%)]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="flex items-center gap-4">
                <Crest id={match.h} size={52} />
                <span className="font-mono text-[22px] font-bold tabular-nums text-slate-200">
                  {finished ? match.sc || '—' : '—'}
                </span>
                <Crest id={match.a} size={52} />
              </div>

              {state === 'sched' && (
                <div className="text-center">
                  <p className="font-mono text-[10px] tracking-wider text-slate-500">距开球</p>
                  <p className="font-mono text-[28px] font-bold tabular-nums text-primary-gold">{countdown}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    {zhDate(datePart(match.t))} {weekdayOf(datePart(match.t))} {hm(match.t)} 北京时间
                  </p>
                </div>
              )}
              {live && <p className="font-mono text-[11px] text-live-red">比赛进行中 · {minute} 分钟</p>}
              {state === 'ended_pending' && <p className="text-[11px] text-slate-400">比赛已结束，等待比分录入</p>}
              {finished && <p className="font-mono text-[10px] text-slate-500">终场</p>}
              {state === 'pp' && <p className="text-[11px] text-slate-400">本场延期，日历将原位提示</p>}
            </div>
          </>
        )}

        {/* 顶部信息条（播放中也在） */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/75 to-transparent px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-headline text-[13px] font-semibold text-slate-100">
              {teamName(match.h)} vs {teamName(match.a)}
            </span>
            <Pill>
              {leagueName(match.l)} 第 {match.r} 轮
            </Pill>
          </div>
          {live && (
            <Pill tone="red">
              <LiveDot />
              LIVE {minute}′
            </Pill>
          )}
        </div>
      </div>

      {/* 直链播放入口 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && play()}
            placeholder="粘贴直播源地址（m3u8 / mp4），经本地代理剥防盗链后播放"
            className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-app px-2.5 py-1.5 font-mono text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={play}
            disabled={authorizing || !input.trim()}
            className="shrink-0 rounded border border-primary-gold/50 bg-primary-gold/15 px-3 py-1.5 font-mono text-[10px] font-semibold text-primary-gold transition-colors hover:bg-primary-gold/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {authorizing ? '授权中…' : streamUrl ? '换源' : '播放'}
          </button>
          {streamUrl && (
            <button
              type="button"
              onClick={() => {
                setStreamUrl(null);
                setError(null);
              }}
              className="shrink-0 rounded border border-border-subtle bg-surface-card px-2.5 py-1.5 font-mono text-[10px] text-slate-400 hover:text-slate-200"
            >
              停止
            </button>
          )}
        </div>

        {error && (
          <p className="rounded border border-danger-orange/40 bg-danger-orange/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-danger-orange">
            {error}
            <span className="ml-1 text-slate-400">—— 可改用下方官方平台直达</span>
          </p>
        )}

        {/* 线路台（自动对齐线路属 P5，暂为占位） */}
        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
          <div className="flex items-center gap-1.5">
            {['线路1', '线路2', '线路3', '备用内嵌'].map((l, i) => (
              <button
                key={l}
                type="button"
                disabled
                title="自动对齐线路属 P5，尚未接入"
                className="cursor-not-allowed rounded border border-border-subtle bg-surface-card px-2.5 py-1 font-mono text-[10px] text-slate-600"
              >
                {i === 0 ? '● ' : ''}
                {l}
              </button>
            ))}
          </div>
          <span className="font-mono text-[9px] text-slate-600">
            自动对齐线路待接入 · 快捷键 [F] 全屏 [P] 画中画 [M] 静音
          </span>
        </div>

        {/* 官方平台直达 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] text-slate-500">↗ 官方平台直达</span>
          {sources.map(s => (
            <a
              key={s.id}
              href={sourceUrlFor(s, match)}
              target="_blank"
              rel="noreferrer noopener"
              title={s.note || s.homeUrl}
              className="rounded border border-border-strong bg-surface-elevated px-2.5 py-1 font-mono text-[10px] text-slate-200 transition-colors hover:bg-surface-hover"
            >
              {s.name}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
