import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFixtures, setFixtures, storylines, teamName } from './data/index.js';
import { countdown as engineCountdown, ts, MATCH_DURATION_MS, sleepTier } from './core/engine.js';
import { bjClock, humanCountdownShort } from './core/format.js';
import { STANDINGS_LEAGUES } from './core/standings.js';
import { loadPrefs, savePrefs } from './core/prefs.js';
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
import { IconClose } from './components/icons.jsx';
import { compareSemver } from './core/semver.js';
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
  const [dataHealth, setDataHealth] = useState(null);
  const lastSyncTriggerRef = useRef(0);
  const lastHealthAtRef = useRef(null);

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

  /** 低频数据状态：发现后台写入新赛果时只重载 fixtures；失败/陈旧则显示提示 */
  const refreshHealth = useCallback(async () => {
    try {
      const r = await fetch('/api/scores/status');
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const at = j?.lastSync?.at || null;
      if (at && at !== lastHealthAtRef.current) {
        lastHealthAtRef.current = at;
        // 无补丁的自检只更新时间，不重载整份 fixtures。
        if (Number(j?.lastSync?.patches || 0) > 0) refreshData();
      }
      const errors = Number(j?.lastSync?.errors || 0);
      const writtenOk = j?.lastSync?.written?.ok !== false;
      const pending = Number(j?.freshness?.pendingCount || 0);
      const stale = Number(j?.freshness?.staleHours || 0);
      let state = 'ok';
      let label = '数据未检查';
      if (j?.lastSync && (errors > 0 || !writtenOk)) {
        state = 'error';
        label = errors > 0 ? `同步失败 · ${errors} 个来源` : '同步写盘失败';
      } else if (pending > 0) {
        state = 'warn';
        label = `待录 ${pending} 场`;
      } else if (stale >= 24) {
        state = 'warn';
        label = `数据落后 ${Math.floor(stale / 24)} 天`;
      } else if (at) {
        const t = Date.parse(at);
        label = `数据 ${Number.isFinite(t) ? bjClock(t, false) : '已更新'}`;
      } else {
        state = 'unknown';
      }
      setDataHealth({ state, label });
    } catch {
      setDataHealth({ state: 'error', label: '本地服务未连接' });
    }
  }, [refreshData]);

  useEffect(() => {
    let interval = null;
    const timer = setTimeout(() => {
      refreshHealth();
      interval = setInterval(refreshHealth, 120000);
    }, 4000);
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [refreshHealth]);

  const triggerSync = useCallback(async () => {
    const now = Date.now();
    // 防抖：10 秒内不重复发起同步，避免短时间频繁触发
    if (now - lastSyncTriggerRef.current < 10000) return;
    lastSyncTriggerRef.current = now;
    try {
      const r = await fetch('/api/scores/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true })
      });
      if (r.ok) {
        const j = await r.json();
        // 写盘失败时服务端不再回传 fixtures；这里再守一道，避免旧响应让内存假装成功
        const writtenOk = j?.summary?.written?.ok !== false;
        // 若后端直接在同步响应中回传了新 fixtures，即刻替换并触发重绘
        if (writtenOk && j?.fixtures?.length && setFixtures(j.fixtures)) {
          setDataRev(v => v + 1);
        } else if (writtenOk && j?.summary?.written?.changed > 0) {
          refreshData();
        }
      } else if (r.status === 409) {
        // 后台任务正在进行，延迟 2 秒获取最新写入结果
        setTimeout(refreshData, 2000);
      }
    } catch {
      /* 静默降级 */
    }
  }, [refreshData]);

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
  const overlayOpen =
    settingsOpen || onboardingVisible || updateModalOpen || splashOpen || paletteOpen || !!standingsState;

  /**
   * Escape 浮层栈：一次 Esc 只关最上层浮层。
   *
   * 此前各浮层在 window 上无条件监听 Escape，设置抽屉 + 更新弹窗叠加时
   * （设置里点「检查更新」不关抽屉）一次 Esc 会连关两层，丢失上下文。
   * 各组件的监听已移除，由这里按「后开者在上」派发；SplashScreen 不入栈——
   * 它永远在最顶层且自带 Space/Enter/Escape 跳过键。
   */
  const overlayCloseStack = useMemo(() => {
    const stack = [];
    if (settingsOpen) stack.push(closeSettings);
    if (onboardingVisible) stack.push(closeOnboarding);
    if (updateModalOpen) stack.push(closeUpdateModal);
    if (standingsState) stack.push(closeStandings);
    if (paletteOpen) stack.push(closePalette);
    // 开屏永远在最顶层（z 最高），也入栈：它自带 Esc 跳过键，与栈派发对同一动作
    // 重复触发是无害幂等；不入栈则首次启动「开屏 + 引导」同屏时一次 Esc 会连关两层
    if (splashOpen) stack.push(handleCloseSplash);
    return stack;
  }, [settingsOpen, onboardingVisible, updateModalOpen, standingsState, paletteOpen, splashOpen, closeStandings, closeSettings, closeUpdateModal, closePalette, closeOnboarding, handleCloseSplash]);

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
                intel={activeIntel}
                isOverlayOpen={overlayOpen}
                spoilerFree={prefs.spoilerFree}
                revealed={activeMatch ? revealed.has(activeMatch.id) : false}
                onReveal={reveal}
                notifyLiveEvents={prefs.notifyLiveEvents}
                excludedIds={spoilerExcludedIds}
                underVideo={
                  <IntelPanel
                    match={activeMatch}
                    prefs={prefs}
                    intel={activeIntel}
                    excludedIds={spoilerExcludedIds}
                    indexHint={INDEX_HINT}
                    isHeroMatch={!!tonight.hero && activeMatch?.id === tonight.hero.m.id}
                    onSelect={select}
                    onOpenStandings={openStandings}
                    now={clockTs}
                  />
                }
              />
            </div>
          </section>
        </main>
      </div>

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
