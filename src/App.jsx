import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFixtures, setFixtures, storylines, teamName } from './data/index.js';
import { countdown as engineCountdown, ts, MATCH_DURATION_MS, sleepTier } from './core/engine.js';
import { hm, humanCountdownShort } from './core/format.js';
import { STANDINGS_LEAGUES } from './core/standings.js';
import { loadPrefs, savePrefs } from './core/prefs.js';
import {
  addToQueue,
  markQueueWatched,
  normalizeQueue,
  queueStatusOf,
  removeFromQueue,
  toggleQueue
} from './core/queue.js';
import { loadWatchLater, saveWatchLater } from './components/watch-later-storage.js';
import { loadStopLossStates, saveStopLossStates } from './components/stop-loss-storage.js';
import {
  ignoreStopLoss,
  markStopLossPrompted,
  shouldStopLossPrompt,
  sleepStopLoss,
  snoozeStopLoss,
  stopLossNightKey
} from './core/stop-loss.js';
import { isPrematchDue, prematchNotification } from './core/notifications.js';
import {
  computeTonight,
  computeWeek,
  computeScheduleRows,
  defaultScheduleFilters,
  liveCountAt,
  stateOf,
  evalOne,
  computeReplayPicks
} from './core/owl.js';
import { narrativeOf } from './core/narrative.js';
import { unrevealedTonightIds } from './core/reveal.js';

import TopBar from './components/TopBar.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import TonightView, { INDEX_HINT } from './components/TonightView.jsx';
import WeekView from './components/WeekView.jsx';
import ScheduleView from './components/ScheduleView.jsx';
import IntelPanel from './components/IntelPanel.jsx';
import StandingsModal from './components/StandingsModal.jsx';
import PlayerStage from './components/PlayerStage.jsx';
import NextUpRail from './components/NextUpRail.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import Onboarding, { shouldShowOnboarding, markOnboardingDone } from './components/Onboarding.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import StopLossBanner from './components/StopLossBanner.jsx';
import MorningDigest from './components/MorningDigest.jsx';
import ScheduleChanges from './components/ScheduleChanges.jsx';
import {
  getMorningDigest,
  morningDigestNight
} from './core/morning.js';
import {
  loadMorningDigestDismissed,
  saveMorningDigestDismissed
} from './components/morning-digest-storage.js';
import { IconClose } from './components/icons.jsx';
import { compareSemver } from './core/semver.js';
import { requestScoreSync, SYNC_STATUS_BUSY } from './api/score-sync.js';
import { useDataHealth } from './hooks/useDataHealth.js';
import { VIEW_COMMANDS, ACTION_COMMANDS, buildMatchCommands } from './core/command-palette.js';

/**
 * 比赛 id → 记录（O(1) 取用）
 *
 * ⚠️ 必须在组件内按 dataRev 重建，不能做成模块级常量：
 * 模块级会被锁定在「构建期内联的快照」上，于是出现「左栏列表已显示比分，
 * 右栏却在说『等待比分录入』」的自相矛盾 —— 因为右栏的 activeMatch 取自这里。
 * （这是热更新改造时漏掉的一处，实测截图暴露。）
 */
function buildMatchMap() {
  const map = {};
  for (const m of getFixtures()) map[m.id] = m;
  return map;
}

const VALID_VIEWS = ['tonight', 'week', 'schedule'];

/** 浮层打开前的焦点落点：关闭后若原元素仍可聚焦就归还，避免键盘用户被丢到 body。 */
function rememberFocus(ref) {
  ref.current = typeof document !== 'undefined' ? document.activeElement : null;
}
function restoreFocus(ref) {
  const el = ref.current;
  ref.current = null;
  if (!el?.isConnected || typeof window === 'undefined') return;
  if (el.closest?.('[inert]')) return;
  el.focus?.();
}

/** 读取 URL 深链（?view=week&match=PL-12-ARS-MCI），使三个视图可直接分享/刷新定位 */
function initialFromUrl() {
  try {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get('view');
    return {
      view: VALID_VIEWS.includes(v) ? v : 'tonight',
      matchId: sp.get('match') || null
    };
  } catch {
    return { view: 'tonight', matchId: null };
  }
}

export default function App() {
  /**
   * 时间基准：这里**只保留 30 秒粒度**。
   *
   * 秒级刷新被下沉到真正需要它的两个组件（TopBar 的时钟、PlayerStage 的倒计时）。
   * 原因：App 每秒重渲染会连带重渲染当前视图 —— 赛程视图的 rows.map 会因此
   * 每秒重建 2000+ 个 React 元素（含 1897 次 evalOne 调用）。
   * 实测静置 10 秒主线程占用 89ms（约 9% CPU，今晚视图 3.5%），
   * 对一个常驻的桌面应用就是持续发热与耗电。
   */
  const [clockTs, setClockTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClockTs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const minuteKey = Math.floor(clockTs / 60000);

  // ---- 偏好（本地存储）----
  const [prefs, setPrefsState] = useState(() => loadPrefs());

  const setPrefs = useCallback(next => {
    setPrefsState(next);
    savePrefs(next);
  }, []);

  // ---- 明早补看（本地单机，只存比赛 ID / 夜晚 / 状态，不存比分）----
  const [watchLater, setWatchLater] = useState(() => loadWatchLater());
  const watchLaterRef = useRef(watchLater);
  watchLaterRef.current = watchLater;
  const commitWatchLater = useCallback(next => {
    const normalized = normalizeQueue(next);
    watchLaterRef.current = normalized;
    setWatchLater(normalized);
    saveWatchLater(normalized);
    return normalized;
  }, []);
  const addWatchLater = useCallback(match => {
    const result = addToQueue(watchLaterRef.current, match);
    if (result.ok && result.added) commitWatchLater(result.queue);
    return result;
  }, [commitWatchLater]);
  /**
   * 补看按钮的唯一入口：未加入 -> 加入；待看 -> 移出；已看 -> 恢复待看。
   * 组件不再各自保存 queued，避免同一场比赛在不同入口出现不同状态。
   */
  const toggleWatchLater = useCallback(match => {
    const result = toggleQueue(watchLaterRef.current, match);
    if (result.ok) commitWatchLater(result.queue);
    return result;
  }, [commitWatchLater]);
  const removeWatchLater = useCallback(id => {
    commitWatchLater(removeFromQueue(watchLaterRef.current, id));
  }, [commitWatchLater]);
  const markWatchLaterWatched = useCallback(id => {
    commitWatchLater(markQueueWatched(watchLaterRef.current, id));
  }, [commitWatchLater]);

  // ---- 止损提醒：只在前台、到达个人止损点且比赛尚未结束时出现 ----
  const [stopLossStates, setStopLossStates] = useState(() => loadStopLossStates());
  const stopLossStatesRef = useRef(stopLossStates);
  stopLossStatesRef.current = stopLossStates;
  const [stopLossContext, setStopLossContext] = useState(null);
  const [stopLossNotice, setStopLossNotice] = useState(null);
  const [stopPlaybackRequest, setStopPlaybackRequest] = useState(0);
  const [morningDigestOpen, setMorningDigestOpen] = useState(false);
  const [morningDismissed, setMorningDismissed] = useState(() => loadMorningDigestDismissed());
  const commitStopLoss = useCallback((night, state) => {
    const next = { ...stopLossStatesRef.current, [night]: state };
    stopLossStatesRef.current = next;
    setStopLossStates(next);
    saveStopLossStates(next);
  }, []);

  // ---- 桌面外壳设置（关闭到托盘 / 开机自启）----
  // 存在主进程：这两项要在窗口创建前生效，不能只放 localStorage
  const [desktopSettings, setDesktopSettings] = useState(null);
  useEffect(() => {
    let alive = true;
    window.desktop
      ?.getDesktopSettings?.()
      .then(s => {
        if (alive && s) setDesktopSettings(s);
      })
      .catch(() => {
        /* 主进程不可用：按非桌面环境处理（设置区不显示这两项） */
      });
    return () => {
      alive = false;
    };
  }, []);

  const updateDesktopSettings = useCallback(async patch => {
    const api = window.desktop;
    if (!api?.setDesktopSettings) return;
    try {
      const next = await api.setDesktopSettings(patch);
      if (next) setDesktopSettings(next);
    } catch {
      /* 写入失败时保持旧值，界面不会假装成功 */
    }
  }, []);

  // 托盘菜单的导航动作（今晚之选 / 本周规划）
  useEffect(() => {
    const unsub = window.desktop?.onNavigate?.(payload => {
      if (payload?.view && VALID_VIEWS.includes(payload.view)) setView(payload.view);
    });
    return unsub;
  }, []);

  // ---- 视图与选中 ----
  const boot = useMemo(initialFromUrl, []);
  const [view, setView] = useState(boot.view);
  const [activeMatchId, setActiveMatchId] = useState(() => {
    if (boot.matchId) return boot.matchId;
    try {
      const initTonight = computeTonight(Date.now(), prefs);
      return initTonight.hero?.m?.id || initTonight.focal?.m?.id || null;
    } catch {
      return null;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const settingsReturnRef = useRef(null);
  const paletteReturnRef = useRef(null);
  const standingsReturnRef = useRef(null);
  const updateReturnRef = useRef(null);
  const [revealed, setRevealed] = useState(() => new Set());
  const [filters, setFilters] = useState(() => defaultScheduleFilters());
  // 完整积分榜是参考视图：{ league, matchId }；matchId 为空表示从赛程入口全局查看
  const [standingsState, setStandingsState] = useState(null);

  // 首次引导：未完成标记且未设主队时展示（跳过或完成都会写入标记，不再骚扰）
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding(prefs));
  const closeOnboarding = useCallback(() => {
    // Esc 与点击关闭也必须落标记，否则下次启动会再次弹出；
    // 跳过/完成按钮自己也会写一次，重复写入是幂等的。
    markOnboardingDone();
    setOnboardingOpen(false);
  }, []);
  const rerunOnboarding = () => {
    // 焦点交给引导，不归还到即将被遮住的设置入口
    settingsReturnRef.current = null;
    setSettingsOpen(false);
    setOnboardingOpen(true);
  };

  // 桌面端自动更新状态
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateState, setUpdateState] = useState({
    status: 'idle', // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    info: null,
    progress: null,
    message: null
  });

  // 用户本次会话是否已关闭过自动提醒 Toast
  const [toastDismissed, setToastDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('nightowl:update_toast_dismissed') === '1';
    } catch {
      return false;
    }
  });

  const handleDismissToast = useCallback(() => {
    setToastDismissed(true);
    try {
      sessionStorage.setItem('nightowl:update_toast_dismissed', '1');
    } catch {}
  }, []);

  /* 浮层开关统一收口：记录打开前的焦点，关闭时归还。
     此前 Esc 关闭设置/积分榜/命令面板后焦点直接落到 body，键盘用户会失去上下文。 */
  const openSettings = useCallback(() => {
    rememberFocus(settingsReturnRef);
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);
  const openPalette = useCallback(() => {
    rememberFocus(paletteReturnRef);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);
  const openUpdateModal = useCallback(() => {
    rememberFocus(updateReturnRef);
    setUpdateModalOpen(true);
  }, []);
  const closeUpdateModal = useCallback(() => {
    setUpdateModalOpen(false);
  }, []);

  // 关闭动画/状态提交后再归还焦点，避免目标仍处于 inert 祖先里。
  // 不用 rAF：Windows 隐藏窗口会节流，CI 与真实窗口行为会分叉。
  useEffect(() => {
    if (!settingsOpen) restoreFocus(settingsReturnRef);
    if (!standingsState) restoreFocus(standingsReturnRef);
    if (!paletteOpen) restoreFocus(paletteReturnRef);
    if (!updateModalOpen) restoreFocus(updateReturnRef);
  }, [settingsOpen, standingsState, paletteOpen, updateModalOpen]);

  useEffect(() => {
    if (!window.desktop?.onUpdaterEvent) return;
    const unsub = window.desktop.onUpdaterEvent(payload => {
      setUpdateState(prev => ({
        ...prev,
        ...payload,
        info: payload.info || (payload.version ? { ...prev.info, version: payload.version } : prev.info)
      }));
    });
    return unsub;
  }, []);

  // 挂载后 1.5 秒自动发起静默更新检测（桌面端调 IPC，Web 端探 GitHub API）
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (window.desktop?.checkForUpdates) {
        window.desktop.checkForUpdates();
      } else {
        // Web 浏览器环境静默探测
        try {
          const res = await fetch('https://api.github.com/repos/LuckyOneTwoThree/nightowl-web/releases/latest');
          if (!res.ok) return;
          const data = await res.json();
          const latestTag = (data.tag_name || '').replace(/^v/, '');
          if (latestTag && compareSemver(latestTag, __APP_VERSION__) > 0) {
            setUpdateState({
              status: 'available',
              info: {
                version: latestTag,
                releaseDate: data.published_at ? data.published_at.slice(0, 10) : null,
                releaseNotes: data.body || '',
                downloadUrl: data.html_url
              },
              progress: null,
              message: null
            });
          }
        } catch {
          // 静默探测网络异常不阻塞
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  /**
   * 更新就绪 / 通知被点击 → 自动把更新面板弹出来
   *
   * 主流产品的做法：下载完成不是静默记一笔，而是**主动告诉用户并给出下一步**。
   * main.cjs 在系统通知被点击时会带 focusModal:true —— 那是最明确的安装意图。
   */
  useEffect(() => {
    if (updateState.status === 'downloaded' || updateState.focusModal) {
      setUpdateModalOpen(true);
    }
  }, [updateState.status, updateState.focusModal]);

  /** 顶栏气泡的显示条件：有新版本或有已下载待安装的版本 */
  const updateAvailable =
    updateState.status === 'available' || updateState.status === 'downloaded';

  const handleCheckUpdate = useCallback(() => {
    if (window.desktop?.checkForUpdates) {
      setUpdateState(prev => ({ ...prev, status: 'checking', message: null }));
      window.desktop.checkForUpdates();
    }
  }, []);

  const handleDownloadUpdate = useCallback(() => {
    if (window.desktop?.downloadUpdate) {
      setUpdateState(prev => ({ ...prev, status: 'downloading', message: null }));
      window.desktop.downloadUpdate();
    }
  }, []);

  const handleInstallUpdate = useCallback(() => {
    if (window.desktop?.quitAndInstall) {
      window.desktop.quitAndInstall();
    }
  }, []);

  // 开屏动画：只在首次安装启动时展示；之后可在设置中主动回放。
  // 用 localStorage 而不是 sessionStorage —— 常驻桌面工具每次启动都阻断 2 秒
  // 与「3 秒决策」的产品目标相冲突。
  const [splashOpen, setSplashOpen] = useState(() => {
    try {
      return localStorage.getItem('nightowl:splash_shown') !== '1';
    } catch {
      return true;
    }
  });

  const handleCloseSplash = useCallback(() => {
    setSplashOpen(false);
    try {
      localStorage.setItem('nightowl:splash_shown', '1');
    } catch {}
  }, []);

  // 首次启动时开屏在最上层；引导必须先等开屏退场再挂载。
  // 否则 TeamPicker 的 autoFocus 发生在被开屏遮住的 DOM 里，开屏一关焦点落到 body。
  const onboardingVisible = onboardingOpen && !splashOpen;

  const replaySplash = useCallback(() => {
    settingsReturnRef.current = null;
    setSettingsOpen(false);
    setSplashOpen(true);
  }, []);

  // 防剧透开关变化时清空已揭晓状态，避免"关掉又打开还留着旧揭晓"
  useEffect(() => {
    setRevealed(new Set());
  }, [prefs.spoilerFree]);

  const reveal = useCallback(id => {
    setRevealed(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // ---- 数据热更新 ----
  // 打包后 fixtures 是构建期内联的快照，保鲜同步把新比分写到了 userData。
  // 启动时（以及点「立即同步」后）从 /api/fixtures 拉最新数据替换掉它，
  // dataRev 变化会让下面所有派生数据重算 —— 否则「刚结束的比赛」会一直显示待录比分。
  const [dataRev, setDataRev] = useState(0);
  const lastSyncTriggerRef = useRef(0);

  // 竞态保护：refreshData 有 4 个并发来源（挂载 effect / focus 监听 /
  // triggerSync 的 409 延迟分支 / 设置抽屉按钮）。旧实现无任何保护，
  // 后返回的旧响应会覆盖新数据（last-response-wins）。
  // 两层：in-flight 复用避免重复请求；序号保证只有最新一次的响应才会被应用。
  const refreshInFlightRef = useRef(null);
  const refreshSeqRef = useRef(0);

  const refreshData = useCallback(async () => {
    // 已有相同拉取在进行：复用同一个 promise，不重复发请求
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    refreshSeqRef.current += 1;
    const seq = refreshSeqRef.current;
    const p = (async () => {
      try {
        const r = await fetch('/api/fixtures');
        if (!r.ok) return null;
        const j = await r.json();
        // 只接受最后一次发起的响应，避免旧响应覆盖新数据
        if (seq !== refreshSeqRef.current) return null;
        if (j?.fixtures?.length && setFixtures(j.fixtures)) {
          setDataRev(v => v + 1);
        }
        return j;
      } catch {
        /* 服务不可用（纯静态预览）时静默沿用内置快照，不打扰用户 */
      }
      return null;
    })();
    refreshInFlightRef.current = p;
    try {
      return await p;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, []);

  // 数据健康 / 计划有变 / 单场重查：一套状态与轮询收在 hook 里
  const {
    dataHealth,
    scheduleChanges,
    dismissedChangesAt,
    dismissScheduleChanges,
    refreshHealth,
    recheckMatch,
    recheckingMatchId,
    recheckMsg
  } = useDataHealth({ refreshData });

  const triggerSync = useCallback(async () => {
    const now = Date.now();
    // 防抖：10 秒内不重复发起同步，避免短时间频繁触发
    if (now - lastSyncTriggerRef.current < 10000) return;
    lastSyncTriggerRef.current = now;

    const outcome = await requestScoreSync({ apply: true });

    // 409 = 后台已有一轮在跑。等它结束后再刷新，而不是立刻再打一次。
    // 旧实现只等 2 秒就放弃，用户要等下一次 120 秒健康轮询才看到比分。
    if (outcome.status === SYNC_STATUS_BUSY) {
      const startedAt = Date.now();
      const pollCompletion = async () => {
        if (Date.now() - startedAt > 120000) return;
        try {
          const sr = await fetch('/api/scores/status');
          if (sr.ok) {
            const sj = await sr.json();
            if (sj?.syncing) {
              setTimeout(pollCompletion, 3000);
              return;
            }
            await refreshData();
            await refreshHealth();
            return;
          }
        } catch {}
        setTimeout(pollCompletion, 3000);
      };
      setTimeout(pollCompletion, 1500);
      return;
    }

    // 网络失败不占住 10s 防抖：否则本次启动/切视图的自动同步失败后，
    // 用户在 10 秒内的手动「立即同步」会被静默忽略。
    if (!outcome.ok) {
      if (outcome.httpStatus === 0) lastSyncTriggerRef.current = 0;
      return;
    }

    // 写盘失败已被判据函数归为 failed（HTTP 200 不等于写盘成功）；
    // 走到这里说明响应可采信，服务端回传了新 fixtures 就立刻热替换。
    if (outcome.payload?.fixtures?.length && setFixtures(outcome.payload.fixtures)) {
      setDataRev(v => v + 1);
    } else if (outcome.status === 'updated' || outcome.status === 'partial_failure') {
      refreshData();
    }
  }, [refreshData, refreshHealth]);

  // 每次刚启动/进入就检查是否有未同步完赛比分，有则立即更新
  useEffect(() => {
    refreshData().then(data => {
      const currentList = data?.fixtures || getFixtures();
      const hasUnsynced = (data?.freshness?.pendingCount > 0) ||
        currentList.some(m => m.st === 'sched' && !m.tbd && Date.now() > ts(m.t) + MATCH_DURATION_MS);
      if (hasUnsynced) {
        triggerSync();
      }
    });
  }, [refreshData, triggerSync]);

  // 切换到「比赛日程」视图时，自检是否有已完赛但待录的场次（如昨日比分），若有则立即同步呈现
  useEffect(() => {
    if (view === 'schedule') {
      const currentList = getFixtures();
      const hasUnsynced = currentList.some(m => m.st === 'sched' && !m.tbd && Date.now() > ts(m.t) + MATCH_DURATION_MS);
      if (hasUnsynced) {
        triggerSync();
      }
    }
  }, [view, triggerSync]);

  useEffect(() => {
    // 比赛窗口内（开球后 3 小时）每 5 分钟主动补一次：
    // 服务端后台每 30 分钟一轮太慢，用户停留在「今晚」时刚终场的比分可能迟迟不落。
    // 只覆盖刚开球/刚终场的窗口，避免全天高频扫描。
    const timer = setInterval(() => {
      const now = Date.now();
      const hasActive = getFixtures().some(
        m => m.st === 'sched' && !m.tbd && now >= ts(m.t) && now - ts(m.t) <= 3 * 3600000
      );
      if (hasActive) triggerSync();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [triggerSync]);

  useEffect(() => {
    // 页面重新聚焦时轻量校准一次
    const onFocus = () => refreshData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshData]);

  // ---- 派生数据（分钟粒度重算，故意不依赖秒级 now）----
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tonight = useMemo(() => computeTonight(Date.now(), prefs), [minuteKey, prefs, dataRev]);

  // 最近值得补看：只扫描最近 96h（REPLAY_WINDOW_MS），排除今晚已在赛程里的场次；不新增数据源
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const replayPicks = useMemo(() => computeReplayPicks(Date.now(), prefs, 3), [minuteKey, prefs, dataRev]);

  /**
   * 托盘倒计时（分钟粒度）
   *
   * 只在桌面端生效；文本由渲染层算好推给主进程 —— 算法与数据都在这一侧，
   * 主进程不重复一份赛程逻辑（否则两条口径迟早打架）。
   * 跟随 30 秒时钟刷新，与顶栏时钟同一时间基准。
   */
  useEffect(() => {
    const api = window.desktop;
    if (!api?.setTrayTitle) return;
    const m = tonight?.hero?.m || tonight?.focal?.m || null;
    if (!m) {
      api.setTrayTitle('今晚无推荐');
      return;
    }
    const cd = engineCountdown(ts(m.t), clockTs);
    api.setTrayTitle(
      cd.over ? `${teamName(m.h)} vs ${teamName(m.a)} · 已开球` : `${hm(m.t)} · 还有 ${humanCountdownShort(cd)}`
    );
  }, [tonight, clockTs]);

  // 赛前 15 分钟提醒：关注球队 + 今晚之选；同一场只提醒一次
  const notifiedPrematchRef = useRef(new Set());
  useEffect(() => {
    if (!prefs.notifyBefore15 || !window.desktop?.notify) return;
    const now = Date.now();
    const followed = new Set(prefs.followedTeams);
    const heroId = tonight.hero?.m.id || null;

    for (const m of getFixtures()) {
      if (m.st !== 'sched' || m.tbd) continue;
      const isHero = m.id === heroId;
      const isFollowed = followed.has(m.h) || followed.has(m.a);
      if (!isHero && !isFollowed) continue;
      if (!isPrematchDue(m, now)) continue;
      if (notifiedPrematchRef.current.has(m.id)) continue;

      notifiedPrematchRef.current.add(m.id);
      const msg = prematchNotification(m, { isHero });
      window.desktop.notify({
        ...msg,
        matchId: m.id,
        kind: 'prematch',
        silentWhenFocused: false
      });
    }
  }, [clockTs, dataRev, prefs.notifyBefore15, prefs.followedTeams, tonight.hero]);

  // 点击系统通知 → 回到对应比赛
  useEffect(() => {
    if (!window.desktop?.onNotificationFocus) return undefined;
    return window.desktop.onNotificationFocus(payload => {
      if (!payload?.matchId) return;
      setView('tonight');
      setActiveMatchId(payload.matchId);
    });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(
    () => (view === 'week' ? computeWeek(Date.now(), prefs) : null),
    [view, minuteKey, prefs, dataRev]
  );

  /**
   * 「本周精选」的场次 ID（供设置里的日历导出使用）。
   * 只在设置抽屉打开时才算：用户不导出就不该为它多跑一次背包规划。
   * 已经在「本周规划」视图时直接复用，避免同一份数据算两遍。
   */
  const weekBestIds = useMemo(() => {
    if (!settingsOpen) return null;
    const w = view === 'week' && week ? week : computeWeek(Date.now(), prefs);
    return new Set(w.plan.best.map(e => e.m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, view, week, prefs, dataRev, minuteKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scheduleRows = useMemo(
    () => (view === 'schedule' ? computeScheduleRows(Date.now(), prefs, filters) : []),
    [view, prefs, filters, dataRev]
  );

  // ---- 顶栏「进行中」计数（随 30 秒时钟刷新）----
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveCount = useMemo(() => liveCountAt(Date.now()), [clockTs]);

  // 按 dataRev 重建：保鲜同步后右栏也要拿到新记录（含比分），不能停在构建期快照
  // ⚠️ 必须在下面的「首屏锁定」effect 之前声明 —— 该 effect 的依赖数组里含 matchMap，
  //    const 的 TDZ 会让「先使用、后声明」在渲染期直接抛 ReferenceError。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matchMap = useMemo(buildMatchMap, [dataRev]);
  const activeMatch = activeMatchId ? matchMap[activeMatchId] || null : null;

  // 切换比赛时收起上一场的提示，避免旧止损卡停留在新场次上。
  useEffect(() => {
    setStopLossContext(null);
    setStopLossNotice(null);
  }, [activeMatchId]);

  useEffect(() => {
    if (
      !activeMatch || !prefs.sleepEnabled || stopLossContext ||
      settingsOpen || onboardingOpen || splashOpen || updateModalOpen || standingsState
    ) {
      return;
    }
    const night = stopLossNightKey(activeMatch);
    if (!night) return;
    const profile = {
      enabled: true,
      wakeTime: prefs.sleepWakeTime,
      minSleep: prefs.sleepMinHours
    };
    const prompt = shouldStopLossPrompt(activeMatch, profile, clockTs, stopLossStates[night]);
    if (!prompt) return;
    setStopLossContext({ ...prompt, match: activeMatch });
    setStopLossNotice(null);
    commitStopLoss(night, markStopLossPrompted(stopLossStates[night]));
  }, [
    activeMatch, clockTs, prefs.sleepEnabled, prefs.sleepWakeTime, prefs.sleepMinHours,
    stopLossStates, stopLossContext, settingsOpen, onboardingOpen, splashOpen,
    updateModalOpen, standingsState, commitStopLoss
  ]);

  useEffect(() => {
    if (!stopLossContext) return;
    if (clockTs > stopLossContext.ledger.endTs) {
      setStopLossContext(null);
      setStopLossNotice(null);
    }
  }, [clockTs, stopLossContext]);

  /**
   * 当前选中是否属于左栏当前列表。
   *
   * 右栏的后续赛程/历史交锋/近况会指向当前视图之外的比赛；
   * 这时只切右栏、不重置左栏筛选，用一条轻提示说明“正在预览”。
   */
  const activeInView = useMemo(() => {
    if (!activeMatchId) return false;
    if (view === 'tonight') {
      return (
        tonight.slice.some(m => m.id === activeMatchId) ||
        replayPicks.some(p => p.m.id === activeMatchId) ||
        tonight.focal?.m.id === activeMatchId
      );
    }
    if (view === 'week') {
      return !!week && week.matches.some(m => m.id === activeMatchId);
    }
    if (view === 'schedule') {
      return scheduleRows.some(row => row.type === 'match' && row.m.id === activeMatchId);
    }
    return false;
  }, [view, activeMatchId, tonight, replayPicks, week, scheduleRows]);

  /** 预览态的“回到当前视图”落点：当前视图里最该看的那场 */
  const firstInViewId = useMemo(() => {
    if (view === 'tonight') {
      return tonight.hero?.m.id || tonight.focal?.m.id || tonight.slice[0]?.id || null;
    }
    if (view === 'week' && week) {
      return (
        week.plan.best[0]?.m.id ||
        week.plan.zeroList[0]?.m.id ||
        week.matches[0]?.id ||
        null
      );
    }
    if (view === 'schedule') {
      const first = scheduleRows.find(row => row.type === 'match');
      return first?.m.id || null;
    }
    return null;
  }, [view, tonight, week, scheduleRows]);

  const activeIntel = useMemo(() => {
    if (!activeMatch) return null;
    const { ev, index } = evalOne(activeMatch, prefs);
    const tier = sleepTier(activeMatch.t);
    const narrative = narrativeOf(activeMatch, ev, storylines);
    return { ev, index, tier, narrative };
  }, [activeMatch, prefs]);

  // 今晚已完赛但未揭晓的场次：积分榜、近况、赛季统计和比赛详情共用同一集合。
  // 必须由 App 统一计算，不能每个面板各自判断（旧实现正是这样漏掉积分榜和球队页的）。
  const morningDigestAuto = useMemo(
    () => getMorningDigest(watchLater, getFixtures(), clockTs, prefs.sleepWakeTime),
    [watchLater, dataRev, clockTs, prefs.sleepWakeTime]
  );
  const morningDigestAll = useMemo(
    () => getMorningDigest(watchLater, getFixtures(), clockTs, prefs.sleepWakeTime, { force: true }),
    [watchLater, dataRev, clockTs, prefs.sleepWakeTime]
  );
  useEffect(() => {
    if (
      !prefs.sleepEnabled || !morningDigestAuto.canShow || morningDigestOpen ||
      morningDismissed.night === morningDigestAuto.night ||
      settingsOpen || onboardingOpen || splashOpen || updateModalOpen || standingsState
    ) {
      return;
    }
    setMorningDigestOpen(true);
  }, [
    prefs.sleepEnabled, morningDigestAuto, morningDigestOpen, morningDismissed,
    settingsOpen, onboardingOpen, splashOpen, updateModalOpen, standingsState
  ]);
  const closeMorningDigest = useCallback(() => {
    const night = morningDigestAll.night || morningDigestNight(clockTs);
    setMorningDigestOpen(false);
    setMorningDismissed({ night });
    saveMorningDigestDismissed(night);
  }, [morningDigestAll.night, clockTs]);

  // 「N 场已看」：已看条目会被 pendingQueue 过滤掉，摘要列表里看不到，
  // 因此要按「同一夜晚 + watched」单独统计后传进去（否则那个文案恒为 0）。
  const morningWatchedCount = useMemo(() => {
    const night = morningDigestAll.night;
    if (!night) return 0;
    return normalizeQueue(watchLater).filter(
      item => item.night === night && item.status === 'watched'
    ).length;
  }, [watchLater, morningDigestAll.night]);

  const handleStopLossSleep = () => {
    if (!stopLossContext) return;
    const result = addWatchLater(stopLossContext.match);
    if (!result?.ok) {
      setStopLossNotice('补看队列已满，请先在「偏好与数据 → 明早补看」移除旧条目');
      return;
    }
    commitStopLoss(stopLossContext.night, sleepStopLoss(stopLossStatesRef.current[stopLossContext.night]));
    // 先落队列与止损状态，再通知 PlayerStage 停止；即便播放器已卸载，也只是多一次无效请求。
    setStopPlaybackRequest(value => value + 1);
    setStopLossContext(null);
    setStopLossNotice(null);
  };
  const handleStopLossSnooze = () => {
    if (!stopLossContext) return;
    commitStopLoss(
      stopLossContext.night,
      snoozeStopLoss(stopLossStatesRef.current[stopLossContext.night])
    );
    setStopLossContext(null);
    setStopLossNotice(null);
  };
  const handleStopLossIgnore = () => {
    if (!stopLossContext) return;
    markWatchLaterWatched(stopLossContext.match.id);
    commitStopLoss(
      stopLossContext.night,
      ignoreStopLoss(stopLossStatesRef.current[stopLossContext.night])
    );
    setStopLossContext(null);
    setStopLossNotice(null);
  };
  const spoilerExcludedIds = useMemo(
    () => unrevealedTonightIds(getFixtures(), clockTs, prefs.spoilerFree, revealed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clockTs, prefs.spoilerFree, revealed, dataRev]
  );

  // ---- 首屏自动锁定今晚之选（用户零点击即有内容）----
  // ⚠️ 深链 ?match=XXX 可能已失效：分享链接过期、热更新后该场被移除、手填错误。
  // 此时 activeMatchId 非空但 matchMap 里查不到 → 右栏永久空态，刷新也不自愈
  // （旧逻辑只判 activeMatchId 非空就 return）。查不到就降级到今晚之选，
  // URL 同步 effect 会把失效 id 顺手改掉，下次刷新即自愈。
  useEffect(() => {
    if (activeMatchId && matchMap[activeMatchId]) return;
    if (tonight.hero) setActiveMatchId(tonight.hero.m.id);
    else if (tonight.focal) setActiveMatchId(tonight.focal.m.id);
  }, [tonight, activeMatchId, matchMap]);

  // 无球日的「下一场焦点战」倒计时：只在降级状态下出现，30 秒时钟足够。
  // 主舞台的倒计时不在这里 —— 它由 PlayerStage 自己按秒刷新（见该组件），
  // 免得一个次要文本把整个 App 拖进秒级重渲染。
  const countdownText = useMemo(() => {
    if (!tonight.focal) return '--';
    return humanCountdownShort(engineCountdown(ts(tonight.focal.m.t), clockTs));
  }, [tonight.focal, clockTs]);

  const select = useCallback(id => setActiveMatchId(id), []);

  const openStandings = useCallback((league, matchId = null) => {
    rememberFocus(standingsReturnRef);
    setStandingsState({ league, matchId });
  }, []);
  const closeStandings = useCallback(() => {
    setStandingsState(null);
  }, []);
  const openStandingsForActive = useCallback(() => {
    const league = activeMatch && STANDINGS_LEAGUES.includes(activeMatch.l) ? activeMatch.l : 'PL';
    openStandings(league, league === activeMatch?.l ? activeMatch.id : null);
  }, [activeMatch, openStandings]);

  // 视图与选中同步到 URL（可分享 / 可刷新定位）
  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set('view', view);
    if (activeMatchId) sp.set('match', activeMatchId);
    window.history.replaceState(null, '', `?${sp.toString()}`);
  }, [view, activeMatchId]);

  // 命令面板：视图/操作 + 全量比赛；列表数据只随 dataRev 重建
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paletteItems = useMemo(
    () => [...VIEW_COMMANDS, ...ACTION_COMMANDS, ...buildMatchCommands(getFixtures())],
    [dataRev, paletteOpen]
  );

  useEffect(() => {
    const onKey = e => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      if (paletteOpen) {
        closePalette();
        return;
      }
      if (settingsOpen || onboardingOpen || updateModalOpen || splashOpen || standingsState) return;
      openPalette();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, settingsOpen, onboardingOpen, updateModalOpen, splashOpen, standingsState, openPalette, closePalette]);

  const runPaletteItem = useCallback(item => {
    const action = item?.action;
    if (!action) return;
    // 执行动作会切换视图或打开新的浮层，不把焦点抢回搜索入口
    paletteReturnRef.current = null;
    setPaletteOpen(false);
    if (action.type === 'view') {
      setView(action.view);
      return;
    }
    if (action.type === 'settings') {
      setSettingsOpen(true);
      return;
    }
    if (action.type === 'sync') {
      triggerSync();
      return;
    }
    if (action.type === 'match') {
      const id = action.matchId;
      setActiveMatchId(id);
      const m = getFixtures().find(x => x.id === id);
      if (m && tonight.slice.some(x => x.id === id)) {
        setView('tonight');
      } else if (m) {
        setView('schedule');
        setFilters({ ...defaultScheduleFilters(), date: 'all', query: teamName(m.h) });
      }
    }
  }, [tonight, triggerSync]);

  // 任一全屏浮层打开时，背景内容必须同时退出键盘焦点与点击（inert）。
  // 只靠遮罩挡鼠标，Tab 仍会跑进后面的列表，这是真实的无障碍缺陷。
  // 早晨补看摘要声明了 aria-modal，同样属于此列 —— 此前漏收，弹窗开着还能 Tab 到背景。
  const overlayOpen =
    settingsOpen ||
    onboardingVisible ||
    updateModalOpen ||
    splashOpen ||
    paletteOpen ||
    morningDigestOpen ||
    !!standingsState;

  /**
   * Escape 浮层栈：一次 Esc 只关最上层浮层。
   *
   * 此前各浮层在 window 上无条件监听 Escape，设置抽屉 + 更新弹窗叠加时
   * （设置里点「检查更新」不关抽屉）一次 Esc 会连关两层，丢失上下文。
   * 由这里按「后开者在上」派发。
   *
   * SplashScreen **不入栈**：它自己监听 Space/Enter/Escape 并播 450ms 退出动画，
   * 若同时入栈，一次 Esc 会「栈立即关闭（无动画）+ 组件启动退出动画」双路派发 ——
   * 表现为开屏一闪而过。首启时引导也不会与开屏同屏（`onboardingVisible` 已排除）。
   */
  const overlayCloseStack = useMemo(() => {
    const stack = [];
    if (settingsOpen) stack.push(closeSettings);
    if (onboardingVisible) stack.push(closeOnboarding);
    if (updateModalOpen) stack.push(closeUpdateModal);
    if (standingsState) stack.push(closeStandings);
    if (paletteOpen) stack.push(closePalette);
    if (morningDigestOpen) stack.push(closeMorningDigest);
    return stack;
  }, [settingsOpen, onboardingVisible, updateModalOpen, standingsState, paletteOpen, morningDigestOpen, closeStandings, closeSettings, closeUpdateModal, closePalette, closeOnboarding, closeMorningDigest]);

  useEffect(() => {
    if (overlayCloseStack.length === 0) return undefined;
    const onEsc = e => {
      if (e.key !== 'Escape') return;
      overlayCloseStack[overlayCloseStack.length - 1]();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [overlayCloseStack]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden stage-atmosphere text-text-primary">
      <div className="flex min-h-0 flex-1 flex-col" inert={overlayOpen || undefined}>
        {/* TopBar 的时钟、PlayerStage 的倒计时各自内部按秒刷新，不走这里 */}
        <TopBar
          view={view}
          onViewChange={setView}
          liveCount={liveCount}
          prefs={prefs}
          dataHealth={dataHealth}
          onOpenSettings={openSettings}
          onOpenPalette={openPalette}
          updateAvailable={updateAvailable}
          updateVersion={updateState.info?.version}
          onOpenUpdate={() => {
            openUpdateModal();
            if (updateState.status === 'idle') handleCheckUpdate();
          }}
          onOpenStandings={openStandingsForActive}
        />

        {/* 主工作区：左栏黄金比例（330-390px） + 右栏核心主舞台（~75%） */}
        <main className="flex min-h-0 flex-1 overflow-hidden">
          {/* 左栏：决策与列表 */}
          <section className="flex min-h-0 w-[330px] lg:w-[345px] xl:w-[355px] 2xl:w-[390px] shrink-0 flex-col overflow-hidden border-r border-line-hairline bg-surface-panel p-4">
          {/* 计划有变（FR-05）：一次同步检测到的改期/延期，关闭后本轮不再出现 */}
          {scheduleChanges && dismissedChangesAt !== scheduleChanges.at && (
            <div className="mb-2 shrink-0">
              <ScheduleChanges
                changes={scheduleChanges}
                onDismiss={dismissScheduleChanges}
                onSelect={select}
              />
            </div>
          )}
          <div key={view} className="animate-view-enter flex min-h-0 flex-1 flex-col">
            {view === 'tonight' && (
              <TonightView
                tonight={tonight}
                now={clockTs}
                activeMatchId={activeMatchId}
                onSelect={select}
                prefs={prefs}
                revealed={revealed}
                onReveal={reveal}
                countdownText={countdownText}
                replayPicks={replayPicks}
                onWatchLater={toggleWatchLater}
                watchLater={watchLater}
                onOpenSettings={openSettings}
              />
            )}

            {view === 'week' && week && (
              <WeekView
                week={week}
                prefs={prefs}
                now={clockTs}
                activeMatchId={activeMatchId}
                onSelect={select}
                onBudgetChange={v => setPrefs({ ...prefs, weeklyBudget: v })}
                revealed={revealed}
                onReveal={reveal}
              />
            )}

            {view === 'schedule' && (
              <ScheduleView
                rows={scheduleRows}
                filters={filters}
                onFiltersChange={setFilters}
                prefs={prefs}
                onPrefsChange={setPrefs}
                now={clockTs}
                activeMatchId={activeMatchId}
                onSelect={select}
                revealed={revealed}
                onReveal={reveal}
                onOpenStandings={openStandings}
              />
            )}
          </div>
          {view === 'tonight' && tonight.slice.length < 3 && (
            <div className="shrink-0 pt-3">
              <NextUpRail
                match={activeMatch || tonight.focal?.m || tonight.hero?.m || null}
                now={clockTs}
                onSelect={select}
                onOpenWeek={() => setView('week')}
                onOpenSchedule={() => setView('schedule')}
              />
            </div>
          )}
          </section>

          {/* 右栏：转播舞台 + 情报中枢 */}
          <section className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <div className="mx-auto flex w-full max-w-[1800px] 2xl:max-w-full flex-col gap-3">
              {activeMatch && !activeInView && (
                <div
                  role="status"
                  className="sticky top-0 z-20 flex animate-view-enter items-center justify-between gap-3 rounded-lg border border-line-hairline bg-surface-panel/95 px-3 py-1.5 shadow-card backdrop-blur-xl motion-reduce:animate-none"
                >
                  <span className="min-w-0 truncate text-xs text-text-secondary">
                    正在查看：{teamName(activeMatch.h)} vs {teamName(activeMatch.a)}
                    <span className="text-text-faint">
                      {' '}· {activeMatch.t.slice(5, 10).replace('-', '/')} {activeMatch.t.split('T')[1]}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => firstInViewId && setActiveMatchId(firstInViewId)}
                    disabled={!firstInViewId}
                    className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    回到当前视图
                  </button>
                </div>
              )}
              <PlayerStage
                match={activeMatch}
                state={activeMatch ? stateOf(activeMatch, clockTs) : 'sched'}
                isOverlayOpen={overlayOpen}
                spoilerFree={prefs.spoilerFree}
                revealed={activeMatch ? revealed.has(activeMatch.id) : false}
                onReveal={reveal}
                notifyLiveEvents={prefs.notifyLiveEvents}
                excludedIds={spoilerExcludedIds}
                stopRequest={stopPlaybackRequest}
                underVideo={
                  <IntelPanel
                    match={activeMatch}
                    prefs={prefs}
                    intel={activeIntel}
                    matchChecks={dataHealth?.checks || {}}
                    onRecheckMatch={recheckMatch}
                    recheckingId={recheckingMatchId}
                    recheckMsg={recheckMsg}
                    excludedIds={spoilerExcludedIds}
                    indexHint={INDEX_HINT}
                    isHeroMatch={!!tonight.hero && activeMatch?.id === tonight.hero.m.id}
                    onSelect={select}
                    onOpenStandings={openStandings}
                    now={clockTs}
                    watchLaterState={activeMatch ? queueStatusOf(watchLater, activeMatch.id) : 'none'}
                    onWatchLater={() => toggleWatchLater(activeMatch)}
                  />
                }
              />
            </div>
          </section>
        </main>
      </div>

      {/* 止损条是非阻断提示，但摘要模态打开时它不能仍可 Tab 到（模态语义优先） */}
      {!settingsOpen && !onboardingOpen && !splashOpen && !updateModalOpen && !standingsState && !morningDigestOpen && (
        <StopLossBanner
          context={stopLossContext}
          notice={stopLossNotice}
          onSleep={handleStopLossSleep}
          onSnooze={handleStopLossSnooze}
          onIgnore={handleStopLossIgnore}
        />
      )}

      <MorningDigest
        open={morningDigestOpen}
        items={morningDigestAll.items}
        watchedCount={morningWatchedCount}
        revealed={revealed}
        onReveal={reveal}
        onMarkRead={markWatchLaterWatched}
        onOpenMatch={id => {
          closeMorningDigest();
          select(id);
        }}
        onClose={closeMorningDigest}
      />

      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onClose={closePalette}
          onRun={runPaletteItem}
        />
      )}

      {/* 更新的 z 层高于设置抽屉；抽屉开着时再打开更新弹窗，必须把下层移出焦点 */}
      <div inert={updateModalOpen || undefined}>
        <SettingsDrawer
          open={settingsOpen}
          prefs={prefs}
          onPrefsChange={setPrefs}
          onClose={closeSettings}
          onRerunOnboarding={rerunOnboarding}
          onReplaySplash={replaySplash}
          onDataRefresh={refreshData}
          updateState={updateState}
          watchLater={watchLater}
          onRemoveWatchLater={removeWatchLater}
          onMarkWatchLaterWatched={markWatchLaterWatched}
          onOpenMorningDigest={() => setMorningDigestOpen(true)}
          weekIds={weekBestIds}
          desktopSettings={desktopSettings}
          onDesktopSettingsChange={updateDesktopSettings}
          onOpenUpdateModal={() => {
            openUpdateModal();
            if (updateState.status === 'idle') {
              handleCheckUpdate();
            }
          }}
        />
      </div>

      <div inert={updateModalOpen || undefined}>
        <Onboarding
          open={onboardingVisible}
          prefs={prefs}
          onPrefsChange={setPrefs}
          onClose={closeOnboarding}
        />
      </div>

      {splashOpen && <SplashScreen onClose={handleCloseSplash} />}

      <StandingsModal
        open={!!standingsState}
        initialLeague={standingsState?.league}
        match={standingsState?.matchId ? matchMap[standingsState.matchId] || null : null}
        now={clockTs}
        dataRev={dataRev}
        spoilerFree={prefs.spoilerFree}
        revealed={revealed}
        onClose={closeStandings}
      />

      <UpdateModal
        open={updateModalOpen}
        onClose={closeUpdateModal}
        currentVersion={__APP_VERSION__}
        updateState={updateState}
        onCheck={handleCheckUpdate}
        onDownload={handleDownloadUpdate}
        onInstall={handleInstallUpdate}
      />

      {/* 发现新版本时的轻量主动浮动提醒（避免用户不知道有更新） */}
      {updateAvailable && !toastDismissed && !updateModalOpen && !settingsOpen && !onboardingOpen && !splashOpen && !standingsState && (
        <aside
          aria-label="版本更新提醒"
          className="fixed bottom-5 right-5 z-modal flex max-w-sm items-center gap-3 rounded-xl border border-accent/40 bg-surface-card/95 p-3.5 shadow-pop backdrop-blur-xl transition-all duration-300"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-text-primary">
              发现新版本 {updateState.info?.version ? `v${updateState.info.version}` : ''}
            </p>
            <p className="mt-0.5 text-2xs text-text-secondary">
              有最新功能与体验优化可用，建议更新
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={openUpdateModal}
              className="rounded-lg bg-accent px-2.5 py-1 text-2xs font-semibold text-accent-ink transition-transform hover:brightness-110 active:scale-95 cursor-pointer"
            >
              查看
            </button>
            <button
              type="button"
              onClick={handleDismissToast}
              className="rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary cursor-pointer"
              aria-label="关闭提醒"
              title="稍后提醒"
            >
              <IconClose size={14} />
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
