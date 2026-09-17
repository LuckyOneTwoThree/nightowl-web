import { lazy, Suspense, useCallback, useEffect, useMemo, memo, useState } from 'react';
import { hm, zhDate, weekdayOf, datePart, liveMinute, humanCountdown } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts, countdown as engineCountdown } from '../core/engine.js';
import { Button, Hint, LiveDot, Meta, SectionLabel } from './atoms.jsx';
import {
  IconChevronDown,
  IconChevronUp,
  IconExternal,
  IconKeyboard,
  IconLive,
  IconReveal,
  IconSignal,
  IconStop,
  IconSwitchLine,
  IconTheaterOff,
  IconTheaterOn,
  IconWarn
} from './icons.jsx';

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

const SHORTCUT_HINT =
  '播放中可用：F 全屏 · P 画中画 · 空格 暂停 · ← → 快退快进 · 1–9 切换线路。快捷键在视频画面获得焦点时生效。';

/**
 * ⚠️ 下面三个组件必须定义在模块作用域，不能写在 PlayerStage 的渲染函数体内。
 *
 * 本组件的 now 每秒 tick 一次（倒计时与进行中分钟数需要），若这三个组件定义在
 * 渲染体内，每次渲染都会产生**新的函数引用**。React 按元素 type 的引用比较，
 * 引用变了就判定为不同组件 → 整棵子树 unmount 再重建。于是直播线路列表、官方平台
 * 链接、通知条每秒 DOM 反复销毁重建，键盘焦点每秒丢失（无法停留在线路按钮上）。
 * 定义在模块作用域后 type 引用恒定，React 正常复用 DOM；LineButton 再套一层
 * memo，列表项在 active 状态与选中回调未变时彻底跳过重渲染。
 */
function Notice({ n }) {
  return (
    <div
      className={`flex items-start justify-between gap-2 rounded-md px-2.5 py-1.5 text-2xs leading-relaxed ${
        n.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn'
      }`}
    >
      <span className="inline-flex min-w-0 items-start gap-1.5">
        <IconWarn size={12} className="mt-0.5" />
        <span className="min-w-0">{n.text}</span>
      </span>
      {n.action && (
        <button
          type="button"
          onClick={n.action.onClick}
          className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
        >
          {n.action.label}
        </button>
      )}
    </div>
  );
}

const LineButton = memo(function LineButton({ l, compact = false, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(l)}
      aria-pressed={active}
      className={`inline-flex items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 text-2xs transition-colors cursor-pointer ${
        compact ? 'shrink-0 whitespace-nowrap' : 'w-full'
      } ${
        active
          ? 'bg-surface-accent font-semibold text-accent shadow-[0_0_8px_rgba(245,185,66,0.25)]'
          : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
      }`}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
        {active && <IconSignal size={11} className="shrink-0" />}
        <span className="truncate">{l.name}</span>
      </span>
      {!compact && <Meta className="shrink-0">{l.isDirect ? '直链' : '内嵌'}</Meta>}
    </button>
  );
});

function OfficialLinks({ sources, match, limit = 99 }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sources.slice(0, limit).map(s => {
        const url = sourceUrlFor(s, match);
        return (
          <a
            key={s.id}
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            title={s.note || s.homeUrl}
            onClick={e => {
              if (window.desktop?.openExternal && url) {
                e.preventDefault();
                window.desktop.openExternal(url);
              }
            }}
            className="inline-flex items-center gap-1 rounded-md border border-line-control bg-surface-raised px-2.5 py-1 text-2xs text-text-secondary transition-colors hover:border-line-control-hover hover:bg-surface-accent hover:text-text-primary"
          >
            <IconExternal size={11} />
            {s.name}
          </a>
        );
      })}
    </div>
  );
}

/**
 * 主舞台播放大屏
 *
 * 版式：B 站 / YouTube 式「左视窗 + 右协同栏」，宽屏模式一键扩展为满屏剧场。
 *
 * 降噪要点：
 *   · 视窗中央此前又摆了一对大队徽 + 队名，与顶部常驻条、左栏 Hero 卡三处重复
 *     同一场对阵。现在对阵命名只保留顶部常驻条一处，中央只留状态与倒计时。
 *   · 移除金色径向光晕、LIVE 的 animate-ping 与线路激活点的 ping。
 *   · 「直播链路待接入 · 本地流代理与抓取对齐属 P3，尚未实现」是开发排期注释，
 *     且与实际实现脱节（代理早已可用，见设置抽屉的服务状态）。改为按真实状态说话。
 */
export default function PlayerStage({
  match,
  state,
  isOverlayOpen = false,
  spoilerFree = true,
  revealed = false,
  onReveal
}) {
  // 秒级刷新只存在于本组件（倒计时文本与进行中的分钟数）。
  // 若由 App 供秒级 now，每秒重渲染会波及整个视图树 —— 赛程视图会每秒
  // 重建 2000+ 列表元素（见 App.jsx 的时间基准注释）。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stageCountdown = useMemo(() => {
    if (!match) return '--';
    return humanCountdown(engineCountdown(ts(match.t), now));
  }, [match, now]);

  const sources = useWatchSources();
  const [theaterMode, setTheaterMode] = useState(false);
  const [theaterLinesExpanded, setTheaterLinesExpanded] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  useEffect(() => {
    setAspectRatio(16 / 9);
  }, [match?.id]);

  // 协同模式基准最大高度（放宽至 700px/68vh，确保大屏下中间比赛画面最大化伸展）；宽屏剧场模式扩展至 860px/80vh，占满主舞台
  const maxH = theaterMode ? 'min(860px, 80vh)' : 'min(700px, 68vh)';

  const [streamUrl, setStreamUrl] = useState(null);
  const [streamKind, setStreamKind] = useState(null);
  const [error, setError] = useState(null);

  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [activeLineId, setActiveLineId] = useState(null);
  const [liveInfo, setLiveInfo] = useState(null);

  // 宽屏模式下紧凑单行精选线路（激活线路必在视野内，最多 3 条以确保严格单行不换行）
  const visibleTheaterLines = useMemo(() => {
    if (theaterLinesExpanded || lines.length <= 3) return lines;
    const activeIdx = lines.findIndex(l => l.id === activeLineId);
    if (activeIdx < 0 || activeIdx < 3) return lines.slice(0, 3);
    return [...lines.slice(0, 2), lines[activeIdx]];
  }, [lines, theaterLinesExpanded, activeLineId]);

  const stopPlayback = useCallback(() => {
    setStreamUrl(null);
    setStreamKind(null);
    setActiveLineId(null);
    setError(null);
  }, []);

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
      try {
        const u = new URL(line.url);
        await fetch('/api/proxy/allow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: u.hostname })
        });
        setStreamUrl(line.url);
        setStreamKind(line.kind || null);
      } catch (e) {
        setError(`起播失败：${e.message}`);
      }
    } else if (line.url) {
      if (window.desktop?.openExternal) {
        window.desktop.openExternal(line.url);
      } else {
        window.open(line.url, '_blank', 'noopener,noreferrer');
      }
    }
  }, []);

  // 切换场次时重置并拉取最新聚合与广播信号
  useEffect(() => {
    stopPlayback();
    setLines([]);
    setLiveInfo(null);
    setTheaterLinesExpanded(false);

    if (!match) return;

    let alive = true;
    setLoadingLines(true);

    const query = new URLSearchParams({
      matchId: match.id || '',
      h: match.h || '',
      a: match.a || '',
      date: datePart(match.t) || '',
      // 开球时刻：聚合站同一对阵可能有多个房间，需要用时刻做邻近度排序
      t: match.t || ''
    });

    fetch(`/api/live-sources?${query}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => {
        if (!alive) return;
        setLiveInfo(data);
        const available = data.lines || [];
        setLines(available);

        // 进行中的比赛若有可用直链，自动选中第一条起播
        if (state === 'live' && available.length > 0) {
          const direct = available.find(l => l.isDirect && l.url);
          if (direct) selectLine(direct);
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
  }, [match?.id, match?.h, match?.a, match?.t, state, selectLine, stopPlayback]);

  const proxyUrl = streamUrl ? `/api/proxy?url=${encodeURIComponent(streamUrl)}` : null;

  /** 快速切到下一个可用直链 */
  const nextLine = () => {
    const directLines = lines.filter(l => l.isDirect && l.url);
    if (!directLines.length) return;
    const currIdx = directLines.findIndex(l => l.id === activeLineId);
    selectLine(directLines[(currIdx + 1) % directLines.length]);
  };

  if (!match) {
    return (
      <div className="flex aspect-video max-h-[46vh] w-full items-center justify-center rounded-xl bg-stage-bg">
        <p className="text-xs text-text-muted">从左侧选择一场比赛</p>
      </div>
    );
  }

  const kickTs = ts(match.t);
  const live = state === 'live';
  const minute = live ? liveMinute(kickTs, now) : 0;
  const finished = state === 'finished';
  const directLines = lines.filter(l => l.isDirect && l.url);

  /* ---------------- 状态提示：按真实状态说话，不写死排期文案 ---------------- */
  const notices = [];
  if (error) {
    notices.push({
      tone: 'danger',
      text: error,
      action: directLines.length > 1 ? { label: '换一条线路', onClick: nextLine } : null
    });
  }
  if (liveInfo?.scrapeError) {
    notices.push({ tone: 'warn', text: '聚合站未响应，已回退到官方平台直达', action: null });
  }
  if (liveInfo?.matchAmbiguous) {
    notices.push({ tone: 'warn', text: '同一对阵存在多个房间，已按开球时间选择，请确认画面', action: null });
  }
  if (liveInfo?.tvChannelsDown?.length) {
    notices.push({
      tone: 'warn',
      text: `官方直达失效：${liveInfo.tvChannelsDown.join('、')}（签名过期，刷新线路配置可恢复）`,
      action: null
    });
  }

  /* ---------------- 视频核心屏 ---------------- */
  const VideoScreen = (
    <div
      style={{
        maxHeight: maxH,
        maxWidth: theaterMode ? undefined : `calc(${maxH} * ${aspectRatio})`,
        aspectRatio: `${aspectRatio}`
      }}
      className={`relative isolate z-0 w-full overflow-hidden rounded-xl bg-black shadow-2xl transition-all duration-200 ${
        isOverlayOpen ? 'pointer-events-none select-none' : ''
      }`}
    >
      {streamUrl ? (
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-black">
              <span className="text-xs text-text-muted">正在载入播放器…</span>
            </div>
          }
        >
          <Player src={proxyUrl} kind={streamKind} onError={setError} onAspectRatio={setAspectRatio} />
        </Suspense>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#182133] via-[#0d121c] to-black">
          {state === 'sched' && (
            <>
              <span className="text-2xs text-text-faint">距开球</span>
              <span className="font-num text-3xl font-semibold tabular-nums bg-gradient-to-r from-amber-200 via-amber-400 to-amber-300 bg-clip-text text-transparent sm:text-4xl">
                {stageCountdown}
              </span>
              <Meta num>
                {zhDate(datePart(match.t))} {weekdayOf(datePart(match.t))} {hm(match.t)}
              </Meta>
            </>
          )}
          {live && (
            <span className="inline-flex items-center gap-2 rounded-full border border-live/30 bg-gradient-to-r from-live/20 to-live/5 px-3.5 py-1">
              <LiveDot />
              <span className="font-num text-xs font-semibold tabular-nums text-live">
                进行中 {minute}′
              </span>
            </span>
          )}
          {state === 'ended_pending' && <span className="text-xs text-text-muted">已终场，等待比分录入</span>}
          {finished &&
            (spoilerFree && !revealed ? (
              <Button variant="default" icon={<IconReveal />} onClick={() => onReveal?.(match.id)}>
                揭晓比分
              </Button>
            ) : (
              <span className="font-num text-3xl font-semibold tabular-nums text-text-primary">
                {match.sc || '—'}
              </span>
            ))}
          {state === 'pp' && <span className="text-xs text-text-muted">本场延期</span>}
          {!live && !finished && state !== 'ended_pending' && state !== 'pp' && state !== 'sched' && (
            <span className="text-xs text-text-muted">未开播</span>
          )}
        </div>
      )}

      {/* 顶部对阵常驻条 —— 全应用唯一的对阵命名处 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-overlay flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 via-black/35 to-transparent px-3.5 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-text-primary">
            {teamName(match.h)} vs {teamName(match.a)}
          </span>
          <span className="shrink-0 text-2xs text-text-muted">
            {leagueName(match.l)} 第 {match.r} 轮
          </span>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {live && (
            <span className="inline-flex items-center gap-1.5">
              <LiveDot />
              <span className="font-num text-2xs font-medium tabular-nums text-live">{minute}′</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setTheaterMode(v => !v)}
            title={theaterMode ? '切换为协同模式' : '切换为宽屏剧场'}
            aria-label={theaterMode ? '切换为协同模式' : '切换为宽屏剧场'}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.08] text-text-secondary transition-colors hover:bg-white/[0.14] hover:text-text-primary"
          >
            {theaterMode ? <IconTheaterOff /> : <IconTheaterOn />}
          </button>
        </div>
      </div>
    </div>
  );

  /* ---------------- 线路按钮（两种模式共用，组件定义见模块作用域） ---------------- */

  /* ---------------- 右侧协同栏 ---------------- */
  const ControlSidebar = (
    <div className="flex w-full shrink-0 flex-col rounded-xl border border-line-hairline bg-surface-card p-3.5 shadow-card transition-all lg:w-[285px] xl:w-[315px] lg:self-stretch min-h-0">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="inline-flex items-center gap-2">
          <IconLive className={live ? 'text-live' : 'text-text-faint'} />
          <span className="text-xs font-medium text-text-primary">直播线路</span>
          <Meta num>{lines.length} 条</Meta>
        </span>
        {directLines.length > 1 && (
          <Button variant="ghost" icon={<IconSwitchLine />} onClick={nextLine}>
            换线
          </Button>
        )}
      </div>

      {lines.length > 0 ? (
        // 列数按容器实际宽度自适应；在桌面端作为 flex-1 弹性填充高度并支持顺畅滚动
        <div className="scrollbar-thin -mr-1 mt-2.5 grid min-h-[80px] max-h-[220px] lg:max-h-none lg:flex-1 content-start gap-1.5 overflow-y-auto pr-1 [grid-template-columns:repeat(auto-fill,minmax(135px,1fr))]">
          {lines.map(l => (
            <LineButton key={l.id} l={l} active={activeLineId === l.id} onSelect={selectLine} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 min-h-[80px] items-center justify-center py-3">
          <p className="text-center text-2xs text-text-muted">
            {loadingLines ? '正在检索线路…' : liveInfo?.scrapeError ? '未检索到线路' : '本场暂无直播线路，可用下方官方平台'}
          </p>
        </div>
      )}

      {notices.length > 0 && (
        <div className="mt-2.5 shrink-0 space-y-1.5">
          {notices.map((n, i) => (
            <Notice key={i} n={n} />
          ))}
        </div>
      )}

      <div className="mt-2.5 shrink-0 border-t border-line-hairline pt-2.5">
        <SectionLabel>官方平台</SectionLabel>
        <div className="mt-1.5">
          <OfficialLinks sources={sources} match={match} />
        </div>
      </div>

      {/* 本场赛事轻量信息条：充实侧栏，给观赛提供上下文，消除与大屏画面等高时的腹部留白 */}
      {match && (
        <div className="mt-2.5 shrink-0 rounded-lg border border-line-hairline/60 bg-surface-raised/40 p-2.5 text-2xs">
          <div className="flex items-center justify-between text-text-muted">
            <span>{leagueName(match.l)} · 第 {match.r} 轮</span>
            {live ? (
              <span className="font-num font-medium text-live">进行中 {minute}′</span>
            ) : finished ? (
              <span className="font-num font-semibold text-text-primary">{match.sc || '已终场'}</span>
            ) : (
              <span className="font-num text-text-secondary">{zhDate(datePart(match.t))} {hm(match.t)}</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between font-medium text-text-primary">
            <span className="truncate max-w-[45%]">{teamName(match.h)}</span>
            <span className="text-text-faint font-normal">vs</span>
            <span className="truncate max-w-[45%] text-right">{teamName(match.a)}</span>
          </div>
        </div>
      )}

      <div className="mt-auto flex shrink-0 items-center justify-between border-t border-line-hairline pt-2.5">
        <span className="inline-flex items-center gap-1.5">
          <Hint content={SHORTCUT_HINT} align="start">
            <IconKeyboard size={12} />
          </Hint>
          <Meta>快捷键</Meta>
        </span>
        {streamUrl && (
          <Button variant="danger" icon={<IconStop />} onClick={stopPlayback}>
            停止
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-2.5">
      {/* 宽屏协同模式：父级 items-stretch，右侧侧栏严格与视频区等高，下端齐平 */}
      {!theaterMode ? (
        <div className="flex w-full flex-col items-stretch gap-3 lg:flex-row lg:items-stretch">
          <div className="player-adaptive-video flex min-w-0 flex-1 items-start justify-center">
            {VideoScreen}
          </div>
          {ControlSidebar}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2.5">
          <div className="w-full">
            {VideoScreen}
          </div>

          {!theaterLinesExpanded ? (
            <div
              className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-line-hairline bg-surface-card px-3 py-2 shadow-card"
            >
              <div className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5">
                <span className="mr-1 inline-flex shrink-0 items-center gap-1.5">
                  <IconLive className={live ? 'text-live' : 'text-text-faint'} />
                  <span className="text-xs font-medium text-text-primary">线路</span>
                </span>
                {visibleTheaterLines.map(l => (
                  <LineButton key={l.id} l={l} compact active={activeLineId === l.id} onSelect={selectLine} />
                ))}
                {lines.length > 3 && (
                  <Button variant="ghost" icon={<IconChevronDown />} onClick={() => setTheaterLinesExpanded(true)}>
                    全部 {lines.length}
                  </Button>
                )}
                {directLines.length > 1 && (
                  <Button variant="ghost" icon={<IconSwitchLine />} onClick={nextLine}>
                    换线
                  </Button>
                )}
              </div>
              <div className="shrink-0">
                <OfficialLinks sources={sources} match={match} limit={4} />
              </div>
            </div>
          ) : (
            <div
              className="w-full rounded-xl border border-line-hairline bg-surface-card p-3 shadow-card"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">全部线路</span>
                  <Meta num>{lines.length} 条</Meta>
                  {directLines.length > 1 && (
                    <Button variant="ghost" icon={<IconSwitchLine />} onClick={nextLine}>
                      换线
                    </Button>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <OfficialLinks sources={sources} match={match} />
                  <Button variant="ghost" icon={<IconChevronUp />} onClick={() => setTheaterLinesExpanded(false)}>
                    收起
                  </Button>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {lines.map(l => (
                  <LineButton key={l.id} l={l} active={activeLineId === l.id} onSelect={selectLine} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
