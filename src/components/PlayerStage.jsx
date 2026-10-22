import { lazy, Suspense, useCallback, useEffect, useMemo, memo, useRef, useState } from 'react';
import { datePart, liveMinute, humanCountdown } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts, countdown as engineCountdown } from '../core/engine.js';
import { Button, Hint, IconButton, LiveDot, Meta, SectionLabel } from './atoms.jsx';
import HighlightsPanel from './HighlightsPanel.jsx';
import LiveMatchPanel from './LiveMatchPanel.jsx';
import MatchCanvas from './MatchCanvas.jsx';
import RecapTimeline from './RecapTimeline.jsx';
import { sourceUrlFor } from '../core/watch-sources.js';
import { eventKey, shouldNotifyEvent } from '../core/live-events.js';
import { liveEventNotification, fullTimeNotification } from '../core/notifications.js';
import { autoSwitchDecision } from '../core/line-switch.js';
import {
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconExternal,
  IconKeyboard,
  IconLive,
  IconReset,
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
    searchTemplate: 'https://yangshipin.cn/search?keyword={q}',
    replayTemplate: 'https://yangshipin.cn/search?keyword={q}',
    highlightTemplate: 'https://yangshipin.cn/search?keyword={q}',
    leagues: ['PL', 'PD', 'SA', 'BL', 'FL', 'UCL']
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
      role="status"
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
      className={`inline-flex items-center justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-2xs transition-colors cursor-pointer ${
        compact ? 'shrink-0 whitespace-nowrap' : 'w-full'
      } ${
        active
          ? 'bg-accent/10 font-semibold text-accent ring-1 ring-accent/20'
          : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
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

function OfficialLinks({ sources, match, limit = 99, replay = false }) {
  // 回放只列真正有回放搜索模板的官方平台；聚合导航（直播吧）不冒充“官方回放”
  const list = replay ? sources.filter(s => s.replayTemplate) : sources;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.slice(0, limit).map(s => {
        const url = sourceUrlFor(s, match, { replay });
        return (
          <a
            key={s.id}
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            title={
              replay && match
                ? `搜索官方回放：${teamName(match.h)} vs ${teamName(match.a)}`
                : s.note || s.homeUrl
            }
            onClick={e => {
              if (window.desktop?.openExternal && url) {
                e.preventDefault();
                window.desktop.openExternal(url);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-transparent bg-white/[0.035] px-2.5 py-1 text-2xs text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
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
 * 线路空态面板（模块作用域定义，防止 now 每秒更新时组件树反复 unmount）
 *
 * 依据赛事生命周期精准表达：
 *   · 检索中：旋转动效与连接提示；
 *   · 延期：延期警示；
 *   · 终场：终场标志，引导官方平台录像/集锦；
 *   · 远期未开赛（距开球 > 30m）：消除误导，明确告知赛前 15~30 分钟才会接入；
 *   · 临近开赛（距开球 ≤ 30m）：雷达待命中，提供「立即检测」按钮；
 *   · 进行中无源：明确告知源站状态，提供「重新检索」按钮。
 */
function LineEmptyState({ loading, state, isNearKickoff, scrapeError, onRefresh }) {
  if (loading) {
    return (
      <div className="my-2 flex flex-1 min-h-[115px] flex-col items-center justify-center rounded-lg border border-dashed border-line-hairline/70 bg-surface-raised/20 p-3 text-center">
        <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.04] text-accent">
          <IconReset className="animate-spin" size={14} />
        </span>
        <p className="text-xs font-medium text-text-primary">正在检索直播线路…</p>
        <p className="mt-1 text-2xs text-text-muted">正在连接聚合源与广播信号</p>
      </div>
    );
  }

  if (state === 'pp') {
    return (
      <div className="my-2 flex flex-1 min-h-[115px] flex-col items-center justify-center rounded-lg border border-dashed border-line-hairline/70 bg-surface-raised/20 p-3 text-center">
        <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.04] text-text-muted">
          <IconWarn size={14} />
        </span>
        <p className="text-xs font-medium text-text-primary">本场比赛已延期</p>
        <p className="mt-1 text-2xs text-text-muted">暂无直播信号安排</p>
      </div>
    );
  }

  if (state === 'finished' || state === 'ended_pending') {
    return (
      <div className="my-2 flex flex-1 min-h-[115px] flex-col items-center justify-center rounded-lg border border-dashed border-line-hairline/70 bg-surface-raised/20 p-3 text-center">
        <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.04] text-text-muted">
          <IconCheck size={14} />
        </span>
        <p className="text-xs font-medium text-text-primary">比赛已终场</p>
        <p className="mt-1 text-2xs leading-relaxed text-text-muted max-w-[210px]">
          直播已关闭，可在右栏查看官方集锦，或去官方平台搜索本场回放
        </p>
      </div>
    );
  }

  if (state === 'sched') {
    if (isNearKickoff) {
      return (
        <div className="my-2 flex flex-1 min-h-[115px] flex-col items-center justify-center rounded-lg border border-dashed border-line-hairline/70 bg-surface-raised/20 p-3 text-center">
          <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent">
            <IconSignal className="animate-pulse" size={14} />
          </span>
          <p className="text-xs font-medium text-text-primary">信号接入中…</p>
          <p className="mt-1 text-2xs leading-relaxed text-text-muted max-w-[200px]">
            源站正在陆续推流，系统将自动同步
          </p>
          <div className="mt-2.5">
            <Button variant="ghost" size="sm" icon={<IconReset size={11} />} onClick={onRefresh}>
              立即检测
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="my-1.5 flex items-center gap-2 rounded-md border border-line-hairline/70 bg-surface-raised/20 px-2.5 py-2 text-2xs leading-relaxed text-text-muted">
        <IconCalendar size={12} className="shrink-0 text-text-faint" />
        <span>线路通常在赛前 15~30 分钟接入；临近开赛时自动同步</span>
      </div>
    );
  }

  // state === 'live'
  return (
    <div className="my-2 flex flex-1 min-h-[115px] flex-col items-center justify-center rounded-lg border border-dashed border-line-hairline/70 bg-surface-raised/20 p-3 text-center">
      <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.04] text-text-muted">
        {scrapeError ? <IconWarn className="text-warn" size={14} /> : <IconSignal size={14} />}
      </span>
      <p className="text-xs font-medium text-text-primary">
        {scrapeError ? '聚合信号暂未响应' : '暂未检索到可用线路'}
      </p>
      <p className="mt-1 text-2xs leading-relaxed text-text-muted max-w-[215px]">
        {scrapeError
          ? '第三方信号站网络异常，建议使用下方官方平台'
          : '源站推流可能受限，可重试检索或使用下方官方平台'}
      </p>
      <div className="mt-2.5">
        <Button variant="ghost" size="sm" icon={<IconReset size={11} />} onClick={onRefresh}>
          重新检索
        </Button>
      </div>
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
  intel,
  isOverlayOpen = false,
  spoilerFree = true,
  revealed = false,
  onReveal,
  notifyLiveEvents = true
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

  const [streamUrl, setStreamUrl] = useState(null);
  const [streamKind, setStreamKind] = useState(null);
  const [error, setError] = useState(null);

  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [activeLineId, setActiveLineId] = useState(null);
  const [liveInfo, setLiveInfo] = useState(null);

  const [liveData, setLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  const [lineNotice, setLineNotice] = useState(null);

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

  const matchRef = useRef(match);
  matchRef.current = match;

  const stateRef = useRef(state);
  stateRef.current = state;

  const activeLineIdRef = useRef(activeLineId);
  activeLineIdRef.current = activeLineId;

  const linesRef = useRef(lines);
  linesRef.current = lines;

  const autoSwitchRef = useRef({ matchId: null, count: 0 });

  const liveDataRef = useRef(liveData);
  liveDataRef.current = liveData;

  /** 用户主动换线：重置自动换线计数，避免手动操作后仍被“已尝试 2 次”卡住 */
  const manualSelectLine = useCallback(
    line => {
      autoSwitchRef.current.count = 0;
      selectLine(line);
    },
    [selectLine]
  );

  /**
   * 播放器错误：优先自动切下一条直链
   *
   * 只对直链生效；最多自动尝试 2 次，之后保留错误让用户手动处理。
   * 600ms 延迟 + 当前线路校验：用户在这段时间手动换线时不再抢切。
   */
  const handlePlayerError = useCallback(
    message => {
      const msg = String(message || '播放失败');
      const currentMatch = matchRef.current;
      const expectedLineId = activeLineIdRef.current;
      const decision = autoSwitchDecision({
        lines: linesRef.current,
        activeId: expectedLineId,
        attempts: autoSwitchRef.current.count,
        maxAttempts: 2
      });

      if (!decision.switch) {
        setError(
          decision.reason === 'exhausted' ? `${msg}（已自动尝试 2 条线路）` : msg
        );
        return;
      }

      autoSwitchRef.current.count += 1;
      setError(null);
      setLineNotice(`当前线路中断，已自动切换到备用线路（${autoSwitchRef.current.count}/2）`);

      setTimeout(() => {
        if (matchRef.current?.id !== currentMatch?.id) return;
        if (activeLineIdRef.current !== expectedLineId) return;
        selectLine(decision.line);
      }, 600);
    },
    [selectLine]
  );

  // 切场时重置自动换线计数与提示
  useEffect(() => {
    autoSwitchRef.current = { matchId: match?.id || null, count: 0 };
    setLineNotice(null);
  }, [match?.id]);

  // 自动切换提示 6 秒后消失，不长期占据线路区
  useEffect(() => {
    if (!lineNotice) return undefined;
    const timer = setTimeout(() => setLineNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [lineNotice]);

  const liveNotifyRef = useRef({
    matchId: null,
    initialized: false,
    keys: new Set(),
    state: null
  });

  /**
   * 拉取实时比分/事件
   *
   * 只在进行中调用；失败不弹错、不阻塞播放——本地分钟数仍是兜底。
   * 服务端 20 秒缓存，前端 30 秒轮询，不会把 ESPN 打爆。
   */
  const loadLive = useCallback(async ({ manual = false } = {}) => {
    const current = matchRef.current;
    if (!current || stateRef.current !== 'live') return;

    if (!liveDataRef.current) setLiveLoading(true);
    if (manual) setLiveRefreshing(true);

    try {
      const refresh = manual ? '&refresh=1' : '';
      const res = await fetch(
        `/api/live?matchId=${encodeURIComponent(current.id)}${refresh}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (matchRef.current?.id !== current.id || stateRef.current !== 'live') return;
      setLiveData(j?.ok ? j : null);
    } catch {
      if (matchRef.current?.id === current.id && stateRef.current === 'live') {
        setLiveData(null);
      }
    } finally {
      if (matchRef.current?.id === current.id) {
        setLiveLoading(false);
        setLiveRefreshing(false);
      }
    }
  }, []);

  /**
   * 拉取/刷新直播线路
   * @param {{ reset?: boolean, autoPlay?: boolean }} opts
   *   reset: 是否在请求前重置现有线路（切场时为 true；手动刷新/自动轮询为 false，避免列表和画面闪烁）
   *   autoPlay: 抓到直链后是否在比赛进行中自动起播
   */
  const fetchLines = useCallback(
    async ({ reset = false, autoPlay = true } = {}) => {
      const currentMatch = matchRef.current;
      if (!currentMatch) return;

      if (reset) {
        stopPlayback();
        setLines([]);
        setLiveInfo(null);
        setTheaterLinesExpanded(false);
      }
      setLoadingLines(true);

      try {
        const query = new URLSearchParams({
          matchId: currentMatch.id || '',
          h: currentMatch.h || '',
          a: currentMatch.a || '',
          date: datePart(currentMatch.t) || '',
          t: currentMatch.t || ''
        });

        const res = await fetch(`/api/live-sources?${query}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();

        // 避免网络异步返回时用户已切到其他场次
        if (matchRef.current?.id !== currentMatch.id) return;

        setLiveInfo(data);
        const available = data.lines || [];
        setLines(available);

        // 进行中的比赛若抓到可用直链且尚未起播，自动选中第一条起播
        if (autoPlay && stateRef.current === 'live' && available.length > 0 && !activeLineIdRef.current) {
          const direct = available.find(l => l.isDirect && l.url);
          if (direct) selectLine(direct);
        }
      } catch (err) {
        if (matchRef.current?.id !== currentMatch.id) return;
        console.warn('[PlayerStage] 获取直播线路失败:', err.message);
      } finally {
        if (matchRef.current?.id === currentMatch.id) {
          setLoadingLines(false);
        }
      }
    },
    [selectLine, stopPlayback]
  );

  // 切换场次时全量重置并拉取；已完赛场次不再抓直播源，避免把回放/下一场当成直播。
  // 只依赖 match.id：比赛进行中同步为 done 时不要重跑本 effect，否则会中断正在看的画面。
  useEffect(() => {
    if (!match?.id) return;
    if (match.st === 'done') {
      stopPlayback();
      setLines([]);
      setLiveInfo(null);
      setTheaterLinesExpanded(false);
      return;
    }
    fetchLines({ reset: true, autoPlay: true });
  }, [match?.id, fetchLines, stopPlayback]);

  // 开球瞬间（由 sched 转换为 live 时）自动探测最新推流并起播
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (prevStateRef.current !== 'live' && state === 'live') {
      fetchLines({ reset: false, autoPlay: true });
    }
    prevStateRef.current = state;
  }, [state, fetchLines]);

  // 进行中：每 30 秒拉一次比分/关键事件；切场或终场立即停
  useEffect(() => {
    if (!match?.id || state !== 'live') {
      setLiveData(null);
      setLiveLoading(false);
      setLiveRefreshing(false);
      return undefined;
    }
    loadLive();
    const timer = setInterval(() => loadLive(), 30000);
    return () => clearInterval(timer);
  }, [match?.id, state, loadLive]);

  /**
   * 进球/红牌/终场系统通知
   *
   * 第一次快照只做基线，不补发历史事件；之后只对新增事件提醒。
   * 防剧透未揭晓时全部静默；窗口在前台时由主进程再抑制一次。
   */
  useEffect(() => {
    if (!liveData?.ok || !match) return;
    const ref = liveNotifyRef.current;

    if (ref.matchId !== match.id) {
      ref.matchId = match.id;
      ref.initialized = false;
      ref.keys = new Set();
      ref.state = liveData.state;
    }

    const events = liveData.events || [];
    const keys = events.map(eventKey);

    if (!ref.initialized) {
      ref.initialized = true;
      ref.keys = new Set(keys);
      ref.state = liveData.state;
      return;
    }

    const canNotify =
      notifyLiveEvents &&
      !(spoilerFree && !revealed) &&
      Boolean(window.desktop?.notify);

    if (canNotify) {
      for (const ev of events) {
        const key = eventKey(ev);
        if (ref.keys.has(key)) continue;
        ref.keys.add(key);
        if (!shouldNotifyEvent(ev)) continue;
        const msg = liveEventNotification(match, liveData, ev);
        window.desktop.notify({
          ...msg,
          matchId: match.id,
          kind: 'live-event',
          silentWhenFocused: true
        });
      }

      if (ref.state !== 'finished' && liveData.state === 'finished') {
        const msg = fullTimeNotification(match, liveData);
        window.desktop.notify({
          ...msg,
          matchId: match.id,
          kind: 'fulltime',
          silentWhenFocused: true
        });
      }
    } else {
      // 静默时也要把新事件记入基线，避免用户揭晓后把旧事件一次性补发
      for (const key of keys) ref.keys.add(key);
    }

    ref.state = liveData.state;
  }, [liveData, match?.id, notifyLiveEvents, spoilerFree, revealed]);

  // 临界窗口自动静默探活机制（赛前 30 分钟 ~ 比赛进行中且缺源）
  useEffect(() => {
    if (!match?.t) return;
    if (lines.length > 0 || state === 'finished' || state === 'ended_pending' || state === 'pp') {
      return;
    }

    const kickTs = ts(match.t);
    const diffMs = kickTs - Date.now();
    let pollInterval = null;
    let enterTimer = null;

    const startPolling = () => {
      pollInterval = setInterval(() => {
        fetchLines({ reset: false, autoPlay: true });
      }, 45000);
    };

    if (state === 'live') {
      // 正在比赛中但暂无线路，立即启动 45 秒轮询
      startPolling();
    } else if (state === 'sched') {
      const nearThreshold = 30 * 60 * 1000;
      if (diffMs <= nearThreshold) {
        // 已经在 30 分钟临界接入窗口内
        startPolling();
      } else {
        // 距开赛较远，定时在进入 30 分钟窗口时静默拉取并启动轮询
        const delayUntilNear = diffMs - nearThreshold;
        if (delayUntilNear > 0 && delayUntilNear < 24 * 60 * 60 * 1000) {
          enterTimer = setTimeout(() => {
            fetchLines({ reset: false, autoPlay: true });
            startPolling();
          }, delayUntilNear);
        }
      }
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (enterTimer) clearTimeout(enterTimer);
    };
  }, [match?.id, match?.t, state, lines.length, fetchLines]);

  const proxyUrl = streamUrl ? `/api/proxy?url=${encodeURIComponent(streamUrl)}` : null;

  /** 快速切到下一个可用直链 */
  const nextLine = () => {
    const directLines = lines.filter(l => l.isDirect && l.url);
    if (!directLines.length) return;
    const currIdx = directLines.findIndex(l => l.id === activeLineId);
    manualSelectLine(directLines[(currIdx + 1) % directLines.length]);
  };

  /** Match Center 的“播放”动作：优先直链，没有直链但有内嵌线路就打开，否则重新检测 */
  const playFirstLine = () => {
    const line = lines.find(l => l.isDirect && l.url) || lines.find(l => l.url);
    if (line) {
      manualSelectLine(line);
      return;
    }
    fetchLines({ reset: false, autoPlay: true });
  };

  /** 平滑定位到页内区块；尊重系统减弱动效设置 */
  const scrollToId = id => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  };

  /** 协同模式滚到右栏线路，剧场模式滚到视频下方的紧凑线路条 */
  const showLines = () => {
    scrollToId(document.getElementById('match-lines') ? 'match-lines' : 'match-lines-theater');
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
  const finished = state === 'finished' || state === 'ended_pending';
  const postponed = state === 'pp';
  const diffMs = kickTs - now;
  const isNearKickoff = state === 'sched' && diffMs <= 30 * 60 * 1000 && diffMs >= 0;
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
  if (lineNotice) {
    notices.push({ tone: 'warn', text: lineNotice, action: null });
  }
  if (liveInfo?.scrapeError && (live || isNearKickoff)) {
    notices.push({ tone: 'warn', text: '聚合站未响应，已回退到官方平台直达', action: null });
  }
  if (liveInfo?.matchAmbiguous) {
    notices.push({ tone: 'warn', text: '同一对阵存在多个房间，已按开球时间选择，请确认画面', action: null });
  }
  if (liveInfo?.tvChannelsDown?.length && (live || isNearKickoff)) {
    notices.push({
      tone: 'warn',
      text: `官方直达暂不可用：${liveInfo.tvChannelsDown.join('、')}（签名已过期）。可改用下方官方平台。`,
      action: null
    });
  }

  /* ---------------- 视频核心屏 ---------------- */
  const VideoScreen = (
    <div
      style={{
        aspectRatio: `${aspectRatio}`
      }}
      className={`relative isolate z-0 w-full overflow-hidden rounded-xl bg-stage-bg border border-line-hairline shadow-2xl transition-all duration-200 ${
        !streamUrl ? 'max-h-[36vh] min-h-[280px]' : ''
      } ${isOverlayOpen ? 'pointer-events-none select-none' : ''}`}
    >
      {streamUrl ? (
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-black">
              <span className="text-xs text-text-muted">正在载入播放器…</span>
            </div>
          }
        >
          <Player src={proxyUrl} kind={streamKind} onError={handlePlayerError} onAspectRatio={setAspectRatio} />
        </Suspense>
      ) : (
        <MatchCanvas
          match={match}
          state={state}
          stageCountdown={stageCountdown}
          isNearKickoff={isNearKickoff}
          liveData={liveData}
          lines={lines}
          loadingLines={loadingLines}
          spoilerFree={spoilerFree}
          revealed={revealed}
          onReveal={() => onReveal?.(match.id)}
          onPlay={playFirstLine}
          onRefreshLines={() => fetchLines({ reset: false, autoPlay: true })}
          onScrollToIntel={() => scrollToId('intel-panel')}
          onShowLines={showLines}
          onScrollToRecap={() => scrollToId('match-recap')}
          onScrollToHighlights={() => scrollToId('match-highlights')}
        />
      )}

      {/* 顶部对阵常驻条 —— 全应用唯一的对阵命名处 */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 z-overlay flex items-center justify-between gap-2 px-3.5 py-2.5 ${streamUrl ? 'bg-gradient-to-b from-black/80 via-black/35 to-transparent' : ''}`}>
        <div className="flex min-w-0 items-baseline gap-2">
          {streamUrl && (
            <>
              <span className="truncate text-sm font-semibold text-text-primary">
                {teamName(match.h)} vs {teamName(match.a)}
              </span>
              <span className="shrink-0 text-2xs text-text-muted">
                {leagueName(match.l)} 第 {match.r} 轮
              </span>
            </>
          )}
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {live && streamUrl && (
            <span className="inline-flex items-center gap-1.5">
              <LiveDot />
              <span className="font-num text-2xs font-medium tabular-nums text-live">
                {liveData?.minuteLabel || `${minute}′`}
              </span>
              {liveData?.ok &&
                liveData.state !== 'postponed' &&
                !(spoilerFree && !revealed) && (
                  <span className="font-num text-2xs font-semibold tabular-nums text-text-primary">
                    {liveData.score?.h ?? '—'}-{liveData.score?.a ?? '—'}
                  </span>
                )}
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
    <div className="broadcast-sheen flex w-full shrink-0 flex-col rounded-2xl border border-white/[0.055] bg-surface-panel/55 p-3 shadow-card backdrop-blur-xl transition-all xl:w-[315px] xl:self-stretch xl:p-4 min-h-0">
      {live && (
        <LiveMatchPanel
          match={match}
          data={liveData}
          loading={liveLoading}
          refreshing={liveRefreshing}
          onRefresh={() => loadLive({ manual: true })}
          spoilerFree={spoilerFree}
          revealed={revealed}
          onReveal={() => onReveal?.(match.id)}
        />
      )}

      {!finished && (
        <>
          <div id="match-lines" className="flex scroll-mt-4 items-center justify-between gap-2 shrink-0">
            <span className="inline-flex items-center gap-2">
              <IconLive className={live ? 'text-live' : 'text-text-faint'} />
              <span className="text-xs font-medium text-text-primary">直播线路</span>
              <Meta num>
                {lines.length > 0
                  ? `${lines.length} 条`
                  : live
                    ? '无可用'
                    : postponed
                      ? '已延期'
                      : isNearKickoff
                        ? '接入中'
                        : '待开播'}
              </Meta>
            </span>
            <div className="flex items-center gap-1">
              {directLines.length > 1 && (
                <Button variant="ghost" icon={<IconSwitchLine />} onClick={nextLine}>
                  换线
                </Button>
              )}
              <IconButton
                label={loadingLines ? '正在检测线路…' : '刷新线路'}
                onClick={() => fetchLines({ reset: false, autoPlay: true })}
                disabled={loadingLines}
              >
                <IconReset className={loadingLines ? 'animate-spin text-accent' : ''} size={12} />
              </IconButton>
            </div>
          </div>

          {lines.length > 0 ? (
            // 1120 宽度下用两列压缩高度；xl 协同模式再回到单列
            <div className="scrollbar-thin -mr-1 mt-2.5 grid min-h-[48px] max-h-[220px] grid-cols-1 content-start gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 xl:min-h-[56px] xl:grid-cols-1">
              {lines.map(l => (
                <LineButton key={l.id} l={l} active={activeLineId === l.id} onSelect={manualSelectLine} />
              ))}
            </div>
          ) : (
            <LineEmptyState
              loading={loadingLines}
              state={state}
              isNearKickoff={isNearKickoff}
              scrapeError={liveInfo?.scrapeError}
              onRefresh={() => fetchLines({ reset: false, autoPlay: true })}
            />
          )}
        </>
      )}

      {notices.length > 0 && (
        <div className="mt-2.5 shrink-0 space-y-1.5">
          {notices.map((n, i) => (
            <Notice key={i} n={n} />
          ))}
        </div>
      )}

      <div id="match-recap" className="shrink-0 scroll-mt-4">
        <RecapTimeline match={match} spoilerFree={spoilerFree} revealed={revealed} />
      </div>

      <div id="match-highlights" className="shrink-0 scroll-mt-4">
        <HighlightsPanel
          match={match}
          sources={sources}
          spoilerFree={spoilerFree}
          revealed={revealed}
          onReveal={() => onReveal?.(match.id)}
        />
      </div>

      <div className="mt-2.5 shrink-0 border-t border-white/[0.06] pt-3">
        <SectionLabel>{finished ? '官方全场回放' : '官方平台'}</SectionLabel>
        <div className="mt-1.5">
          <OfficialLinks sources={sources} match={match} replay={finished} />
        </div>
      </div>

      {!streamUrl && (
        <div className="mt-auto flex shrink-0 items-center border-t border-white/[0.06] pt-3">
          <Meta>官方平台直达 · 本机代理仅转发公开线路</Meta>
        </div>
      )}

      {streamUrl && (
        <div className="mt-auto flex shrink-0 items-center justify-between border-t border-white/[0.06] pt-3">
          <span className="inline-flex items-center gap-1.5">
            <Hint content={SHORTCUT_HINT} align="start">
              <IconKeyboard size={12} />
            </Hint>
            <Meta>快捷键</Meta>
          </span>
          <Button variant="danger" icon={<IconStop />} onClick={stopPlayback}>
            停止
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-2.5">
      {/* 宽屏协同模式：父级 items-stretch，右侧侧栏严格与视频区等高，下端齐平 */}
      {!theaterMode ? (
        <div className="flex w-full flex-col items-stretch gap-3 xl:flex-row xl:items-stretch">
          <div className="player-adaptive-video flex min-w-0 flex-1">
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
              id="match-lines-theater"
              className="flex w-full scroll-mt-4 items-center justify-between gap-2.5 rounded-xl border border-line-hairline bg-surface-card px-3 py-2 shadow-card"
            >
              <div className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5">
                <span className="mr-1 inline-flex shrink-0 items-center gap-1.5">
                  <IconLive className={live ? 'text-live' : 'text-text-faint'} />
                  <span className="text-xs font-medium text-text-primary">线路</span>
                </span>
                {lines.length > 0 ? (
                  <>
                    {visibleTheaterLines.map(l => (
                      <LineButton key={l.id} l={l} compact active={activeLineId === l.id} onSelect={manualSelectLine} />
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
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-2xs text-text-muted">
                    <span className="text-text-muted">
                      {loadingLines
                        ? '正在检索线路…'
                        : finished
                        ? '比赛已终场'
                        : postponed
                        ? '比赛已延期'
                        : live
                        ? '暂无可播线路'
                        : isNearKickoff
                        ? '信号接入中（正等待推流）'
                        : '未开赛（线路通常在赛前 15~30 分钟接入）'}
                    </span>
                    <button
                      type="button"
                      onClick={() => fetchLines({ reset: false, autoPlay: true })}
                      disabled={loadingLines}
                      title="检测线路"
                      aria-label="检测线路"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-text-secondary hover:bg-surface-raised hover:text-text-primary transition-colors disabled:opacity-40"
                    >
                      <IconReset size={11} className={loadingLines ? 'animate-spin text-accent' : ''} />
                      <span>{loadingLines ? '检测中' : '检测'}</span>
                    </button>
                  </div>
                )}
              </div>
              <div className="shrink-0">
                <OfficialLinks sources={sources} match={match} limit={5} replay={finished} />
              </div>
            </div>
          ) : (
            <div
              id="match-lines-theater"
              className="w-full scroll-mt-4 rounded-xl border border-line-hairline bg-surface-card p-3 shadow-card"
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
                  <OfficialLinks sources={sources} match={match} replay={finished} />
                  <Button variant="ghost" icon={<IconChevronUp />} onClick={() => setTheaterLinesExpanded(false)}>
                    收起
                  </Button>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {lines.map(l => (
                  <LineButton key={l.id} l={l} active={activeLineId === l.id} onSelect={manualSelectLine} />
                ))}
              </div>
            </div>
          )}

          {finished && (
            <div className="w-full rounded-xl border border-line-hairline bg-surface-card px-3 pb-3 shadow-card">
              <div id="match-recap" className="scroll-mt-4">
                <RecapTimeline match={match} spoilerFree={spoilerFree} revealed={revealed} />
              </div>
              <div id="match-highlights" className="scroll-mt-4">
                <HighlightsPanel
                  match={match}
                  sources={sources}
                  spoilerFree={spoilerFree}
                  revealed={revealed}
                  onReveal={() => onReveal?.(match.id)}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
