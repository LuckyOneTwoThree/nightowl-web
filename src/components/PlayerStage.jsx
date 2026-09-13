import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { hm, zhDate, weekdayOf, datePart, liveMinute } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts } from '../core/engine.js';
import { Crest, Pill, LiveDot } from './atoms.jsx';

/**
 * 播放器懒加载：ArtPlayer + hls.js 约 700KB，只在用户真正点播放时拉取 chunk
 */
const Player = lazy(() => import('./Player.jsx'));

/** 服务不可用时的最小回退清单 */
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

export function sourceUrlFor(src, match) {
  if (src.searchTemplate && match) {
    return src.searchTemplate.replace('{q}', encodeURIComponent(teamName(match.h)));
  }
  return src.homeUrl;
}

/**
 * 主舞台播放大屏
 *
 * 优化特性：
 *   1. 适中模式下采用主流平台（B站/YouTube）双列协同布局：
 *      - 左侧：16:9 视频视窗
 *      - 右侧：多线路切换 + 官方直达 + 关键速递
 *   2. 宽屏模式下一键扩展为 100% 满屏剧场视口
 *   3. 移除冗余的手动换源输入框，纯净专业
 *   4. isolate 层叠上下文隔离，彻底防止穿模
 */
export default function PlayerStage({ match, state, now, countdown, isOverlayOpen = false }) {
  const sources = useWatchSources();
  const [theaterMode, setTheaterMode] = useState(false);
  const [theaterLinesExpanded, setTheaterLinesExpanded] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState(null);
  const [authorizing, setAuthorizing] = useState(false);

  // 自动获取的线路列表
  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [activeLineId, setActiveLineId] = useState(null);
  const [liveInfo, setLiveInfo] = useState(null);

  // 宽屏模式下紧凑单行精选线路（保证激活线路必在视野内，且最多展示 3 条以确保严格单行不换行）
  const visibleTheaterLines = useMemo(() => {
    if (theaterLinesExpanded || lines.length <= 3) return lines;
    const activeIdx = lines.findIndex(l => l.id === activeLineId);
    if (activeIdx < 0 || activeIdx < 3) {
      return lines.slice(0, 3);
    }
    return [...lines.slice(0, 2), lines[activeIdx]];
  }, [lines, theaterLinesExpanded, activeLineId]);

  /**
   * 选中线路切换播放
   *
   * 必须定义在下面的 useEffect 之前并进入其依赖数组：原实现定义在 effect 之后，
   * 靠「effect 回调异步执行时 const 已初始化」侥幸可用，属于隐式闭包依赖。
   */
  const selectLine = useCallback(async line => {
    setActiveLineId(line.id);
    setError(null);

    if (line.isDirect && line.url) {
      setAuthorizing(true);
      try {
        const u = new URL(line.url);
        await fetch('/api/proxy/allow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: u.hostname })
        });
        setStreamUrl(line.url);
      } catch (e) {
        setError(`线路起播失败：${e.message}`);
      } finally {
        setAuthorizing(false);
      }
    } else if (line.url) {
      window.open(line.url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  // 切换场次时重置并拉取最新聚合与广播信号
  useEffect(() => {
    setStreamUrl(null);
    setError(null);
    setActiveLineId(null);
    setLines([]);
    setLiveInfo(null);
    setTheaterLinesExpanded(false);

    if (!match) return;

    let alive = true;
    setLoadingLines(true);

    const d = datePart(match.t);
    const query = new URLSearchParams({
      matchId: match.id || '',
      h: match.h || '',
      a: match.a || '',
      date: d || ''
    });

    fetch(`/api/live-sources?${query}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => {
        if (!alive) return;
        setLiveInfo(data);
        const available = data.lines || [];
        setLines(available);

        // 如果比赛处于进行中（live）且有可用直链，自动选中第一条线路起播
        if (state === 'live' && available.length > 0) {
          const direct = available.find(l => l.isDirect && l.url);
          if (direct) {
            selectLine(direct);
          }
        }
      })
      .catch(err => {
        if (!alive) return;
        console.warn('[PlayerStage] 获取直播线路失败:', err.message);
      })
      .finally(() => {
        if (alive) setLoadingLines(false);
      });

    return () => {
      alive = false;
    };
  }, [match?.id, match?.h, match?.a, match?.t, state, selectLine]);

  const proxyUrl = streamUrl ? `/api/proxy?url=${encodeURIComponent(streamUrl)}` : null;

  /** 快速切到下一个可用直链 */
  const nextLine = () => {
    const directLines = lines.filter(l => l.isDirect && l.url);
    if (!directLines.length) return;
    const currIdx = directLines.findIndex(l => l.id === activeLineId);
    const nextIdx = (currIdx + 1) % directLines.length;
    selectLine(directLines[nextIdx]);
  };

  if (!match) {
    return (
      <div className="flex aspect-video max-h-[46vh] w-full items-center justify-center rounded-2xl bg-black/80 shadow-card">
        <p className="font-mono text-[11px] text-text-muted">从左侧选择一场比赛</p>
      </div>
    );
  }

  const kickTs = ts(match.t);
  const live = state === 'live';
  const minute = live ? liveMinute(kickTs, now) : 0;
  const finished = state === 'finished';

  /* 视频播放核心屏（纯净剧场大屏，无突兀外框） */
  const VideoScreen = (
    <div
      className={`relative isolate z-0 aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl transition-all duration-200 ${
        theaterMode ? 'max-h-[580px]' : 'max-h-[440px] xl:max-h-[480px]'
      } ${isOverlayOpen ? 'pointer-events-none select-none' : ''}`}
    >
      {streamUrl ? (
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-black">
              <span className="font-mono text-[11px] text-slate-400 animate-pulse">正在载入播放器引擎…</span>
            </div>
          }
        >
          <Player src={proxyUrl} onError={setError} />
        </Suspense>
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgba(255,184,0,0.12),transparent_65%)]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="flex items-center gap-4">
              <Crest id={match.h} size={52} />
              <span className="font-mono text-[24px] font-extrabold tabular-nums text-slate-200">
                {finished ? match.sc || '—' : '—'}
              </span>
              <Crest id={match.a} size={52} />
            </div>

            {state === 'sched' && (
              <div className="text-center">
                <p className="font-mono text-[10px] tracking-wider uppercase text-slate-400">距开球</p>
                <p className="font-mono text-[28px] font-extrabold tabular-nums text-primary-gold drop-shadow-sm">
                  {countdown}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                  {zhDate(datePart(match.t))} {weekdayOf(datePart(match.t))} {hm(match.t)} 北京时间
                </p>
              </div>
            )}
            {live && (
              <div className="flex items-center gap-2 rounded-full bg-live-red/15 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-live-red animate-ping" />
                <p className="font-mono text-[12px] font-extrabold text-live-red">
                  比赛进行中 · 第 {minute} 分钟
                </p>
              </div>
            )}
            {state === 'ended_pending' && <p className="text-[11px] text-slate-300">比赛已结束，等待比分录入</p>}
            {finished && <p className="font-mono text-[10px] text-slate-400">终场结束</p>}
            {state === 'pp' && <p className="text-[11px] text-slate-300">本场延期，日历将原位提示</p>}
          </div>
        </>
      )}

      {/* 顶部对阵常驻条 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-headline text-[13px] font-bold text-white drop-shadow-xs">
            {teamName(match.h)} vs {teamName(match.a)}
          </span>
          <Pill>
            {leagueName(match.l)} 第 {match.r} 轮
          </Pill>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {live && (
            <Pill tone="red">
              <LiveDot />
              LIVE {minute}′
            </Pill>
          )}
          <button
            type="button"
            onClick={() => setTheaterMode(v => !v)}
            title={theaterMode ? '切换为适中协同模式' : '切换为宽屏剧场模式'}
            className="rounded-md bg-black/60 hover:bg-black/80 px-2.5 py-1 font-mono text-[10px] font-semibold text-white/90 hover:text-white transition-all active:scale-95 shadow-xs backdrop-blur-xs"
          >
            {theaterMode ? '适中 ⇱' : '宽屏 ⇲'}
          </button>
        </div>
      </div>
    </div>
  );

  /* 右侧多线路与官方导航协同面板（适中模式使用） */
  const ControlSidebar = (
    <div className="flex w-full lg:w-[290px] xl:w-[320px] shrink-0 flex-col justify-between rounded-xl bg-surface-card p-3 shadow-card">
      <div className="space-y-3">
        {/* 顶栏：多线路状态与切线 */}
        <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`inline-block h-2 w-2 rounded-full shrink-0 ${live ? 'bg-live-red animate-pulse' : 'bg-primary-gold'}`}
            />
            <span className="font-headline text-[12px] font-bold text-text-primary truncate">多线路直连</span>
            {liveInfo?.matched && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400 shrink-0">
                🔴 信号对齐
              </span>
            )}
          </div>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={nextLine}
              className="rounded bg-surface-panel px-2 py-0.5 font-mono text-[10px] font-medium text-text-muted hover:text-primary-gold transition-all active:scale-95 shrink-0"
              title="切换下一条可用线路"
            >
              切线 ⇋
            </button>
          )}
        </div>

        {/* 线路列表 */}
        {lines.length > 0 ? (
          <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1 scrollbar-thin">
            {lines.map(l => {
              const isActive = activeLineId === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => selectLine(l)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-semibold transition-all active:scale-98 ${
                    isActive
                      ? 'bg-primary-gold/20 text-primary-gold shadow-xs font-bold'
                      : 'bg-surface-panel/70 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-gold animate-ping shrink-0" />}
                    <span className="truncate text-left">{l.name}</span>
                  </div>
                  <span
                    className={`rounded px-1.5 py-0.2 text-[9px] shrink-0 font-bold ${
                      l.isDirect
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-white/10 text-text-dim'
                    }`}
                  >
                    {l.isDirect ? '直链' : '内嵌'}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="py-4 text-center font-mono text-[11px] text-text-muted">
            {loadingLines ? '正在连接体育信号节点…' : '暂未匹配到直链，可直达官方平台'}
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center justify-between gap-1.5 rounded-lg bg-danger-orange/10 p-2 text-[10px] text-danger-orange leading-tight">
            <span className="truncate">{error}</span>
            {lines.filter(l => l.isDirect).length > 1 && (
              <button
                type="button"
                onClick={nextLine}
                className="shrink-0 font-bold underline hover:opacity-80"
              >
                切下一路
              </button>
            )}
          </div>
        )}

        {/* 保底频道失效提示：签名过期是必然事件，必须让用户看见，而不是点了没反应 */}
        {liveInfo?.tvChannelsDown?.length > 0 && (
          <div className="rounded-lg bg-warning-amber/10 p-2 text-[10px] leading-tight text-warning-amber">
            保底频道已失效：{liveInfo.tvChannelsDown.join('、')}
            <span className="mt-0.5 block opacity-80">签名过期，需刷新线路配置</span>
          </div>
        )}

        {/* 官方正版平台直达 */}
        <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
          <span className="font-mono text-[10px] font-semibold text-text-muted">↗ 官方平台直达:</span>
          <div className="flex flex-wrap gap-1.5">
            {sources.map(s => (
              <a
                key={s.id}
                href={sourceUrlFor(s, match)}
                target="_blank"
                rel="noreferrer noopener"
                title={s.note || s.homeUrl}
                className="rounded-md bg-surface-panel/80 px-2.5 py-1 font-mono text-[10px] font-semibold text-text-primary transition-all hover:bg-surface-hover shadow-2xs active:scale-95"
              >
                {s.name}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* 底部快捷键与停止控制 */}
      <div className="border-t border-white/[0.04] pt-2 mt-2 flex items-center justify-between text-[10px] text-text-dim font-mono">
        <span>[F] 全屏 · [P] 画中画</span>
        {streamUrl && (
          <button
            type="button"
            onClick={() => {
              setStreamUrl(null);
              setActiveLineId(null);
              setError(null);
            }}
            className="text-text-muted hover:text-danger-orange font-semibold transition-colors"
          >
            停止播放
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 transition-all duration-300 w-full">
      {/* 适中协同布局：左视窗 + 右控制栏 */}
      {!theaterMode ? (
        <div className="flex flex-col lg:flex-row items-stretch gap-3 w-full">
          <div className="flex-1 min-w-0">{VideoScreen}</div>
          {ControlSidebar}
        </div>
      ) : (
        /* 宽屏剧场模式：满屏视窗 + 紧凑单行下栏（可展开） */
        <div className="flex flex-col gap-2.5 w-full">
          {VideoScreen}
          {!theaterLinesExpanded ? (
            /* 紧凑单行模式：严格只占一行，右侧附带展开按钮 */
            <div className="flex items-center justify-between gap-2.5 rounded-xl bg-surface-card px-3.5 py-2.5 shadow-card overflow-hidden">
              {/* 左侧：信号点 + 状态 + 精选单行线路 + 展开胶囊 */}
              <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar py-0.5">
                <span className="font-headline text-[12px] font-bold text-text-primary flex items-center gap-1.5 shrink-0 mr-1">
                  <span className={`inline-block h-2 w-2 rounded-full ${live ? 'bg-live-red animate-pulse' : 'bg-primary-gold'}`} />
                  多线路直连
                </span>
                {visibleTheaterLines.map(l => {
                  const isActive = activeLineId === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => selectLine(l)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px] font-semibold transition-all active:scale-95 shrink-0 whitespace-nowrap ${
                        isActive
                          ? 'bg-primary-gold/20 text-primary-gold shadow-xs font-bold'
                          : 'bg-surface-panel/70 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-gold animate-ping" />}
                      <span>{l.name}</span>
                      <span className="rounded bg-surface-base/80 px-1 py-0.2 text-[8px] text-text-muted">
                        {l.type === 'embed' ? '内嵌' : '直链'}
                      </span>
                    </button>
                  );
                })}
                {/* 线路过多时的展开按钮 */}
                {lines.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setTheaterLinesExpanded(true)}
                    className="flex items-center gap-1 rounded-lg bg-surface-panel/90 px-2.5 py-1 font-mono text-[10px] font-bold text-primary-gold hover:bg-surface-hover transition-all shrink-0 active:scale-95 shadow-xs whitespace-nowrap"
                    title="展开查看全部线路"
                  >
                    <span>全部 {lines.length} 线</span>
                    <span className="text-[9px]">▾</span>
                  </button>
                )}
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={nextLine}
                    className="rounded-lg bg-surface-panel/80 px-2 py-1 font-mono text-[10px] text-text-muted hover:text-primary-gold transition-all shrink-0 active:scale-95 whitespace-nowrap"
                    title="切换至下一线路"
                  >
                    切线 ⇋
                  </button>
                )}
              </div>

              {/* 右侧：官方直达快捷平台 */}
              <div className="flex items-center gap-1.5 shrink-0 pl-2">
                <span className="font-mono text-[10px] font-semibold text-text-muted hidden md:inline">↗ 官方平台:</span>
                {sources.slice(0, 4).map(s => (
                  <a
                    key={s.id}
                    href={sourceUrlFor(s, match)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-md bg-surface-panel/80 px-2.5 py-1 font-mono text-[10px] font-semibold text-text-primary hover:bg-surface-hover hover:text-primary-gold transition-colors shrink-0 whitespace-nowrap"
                  >
                    {s.name}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            /* 展开模式：完整列出全部线路并提供收起按钮 */
            <div className="flex flex-col gap-2 rounded-xl bg-surface-card p-3 shadow-card transition-all">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-headline text-[12px] font-bold text-text-primary flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${live ? 'bg-live-red animate-pulse' : 'bg-primary-gold'}`} />
                    全部可用线路 ({lines.length})
                  </span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={nextLine}
                      className="rounded-lg bg-surface-panel/80 px-2 py-0.5 font-mono text-[10px] text-text-muted hover:text-primary-gold transition-all active:scale-95"
                    >
                      切线 ⇋
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setTheaterLinesExpanded(false)}
                    className="flex items-center gap-1 rounded-lg bg-surface-panel px-2.5 py-0.5 font-mono text-[10px] font-bold text-primary-gold hover:bg-surface-hover transition-all active:scale-95 shadow-xs"
                    title="收起为单行显示"
                  >
                    <span>收起</span>
                    <span className="text-[9px]">▴</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-semibold text-text-muted hidden md:inline">↗ 官方平台:</span>
                  {sources.map(s => (
                    <a
                      key={s.id}
                      href={sourceUrlFor(s, match)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="rounded-md bg-surface-panel/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-primary hover:bg-surface-hover hover:text-primary-gold transition-colors"
                    >
                      {s.name}
                    </a>
                  ))}
                </div>
              </div>

              {/* 全部线路网格 */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {lines.map(l => {
                  const isActive = activeLineId === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => selectLine(l)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[10px] font-semibold transition-all active:scale-95 ${
                        isActive
                          ? 'bg-primary-gold/20 text-primary-gold shadow-xs font-bold'
                          : 'bg-surface-panel/70 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-gold animate-ping" />}
                      <span>{l.name}</span>
                      <span className="rounded bg-surface-base/80 px-1 py-0.2 text-[8px] text-text-muted">
                        {l.type === 'embed' ? '内嵌' : '直链'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
