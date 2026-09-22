import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFixtures, setFixtures, storylines } from './data/index.js';
import { countdown as engineCountdown, ts, MATCH_DURATION_MS, sleepTier } from './core/engine.js';
import { humanCountdown } from './core/format.js';
import { loadPrefs, savePrefs } from './core/prefs.js';
import {
  computeTonight,
  computeWeek,
  computeScheduleRows,
  defaultScheduleFilters,
  liveCountAt,
  stateOf,
  evalOne
} from './core/owl.js';
import { narrativeOf } from './core/narrative.js';

import TopBar from './components/TopBar.jsx';
import TonightView, { INDEX_HINT } from './components/TonightView.jsx';
import WeekView from './components/WeekView.jsx';
import ScheduleView from './components/ScheduleView.jsx';
import IntelPanel from './components/IntelPanel.jsx';
import PlayerStage from './components/PlayerStage.jsx';
import UpcomingFixtures from './components/UpcomingFixtures.jsx';
import SameNightPicks from './components/SameNightPicks.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import Onboarding, { shouldShowOnboarding } from './components/Onboarding.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import { IconClose } from './components/icons.jsx';
import { compareSemver } from './core/semver.js';

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
  const [revealed, setRevealed] = useState(() => new Set());
  const [filters, setFilters] = useState(() => defaultScheduleFilters());

  // 首次引导：未完成标记且未设主队时展示（跳过或完成都会写入标记，不再骚扰）
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding(prefs));
  const rerunOnboarding = () => {
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

  // 开屏动画：首次会话展示（避免每次刷新都强行阻断），并支持在设置中主动回放
  const [splashOpen, setSplashOpen] = useState(() => {
    try {
      return sessionStorage.getItem('nightowl:splash_shown') !== '1';
    } catch {
      return true;
    }
  });

  const handleCloseSplash = useCallback(() => {
    setSplashOpen(false);
    try {
      sessionStorage.setItem('nightowl:splash_shown', '1');
    } catch {}
  }, []);

  const replaySplash = useCallback(() => {
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
        // 若后端直接在同步响应中回传了新 fixtures，即刻替换并触发重绘
        if (j?.fixtures?.length && setFixtures(j.fixtures)) {
          setDataRev(v => v + 1);
        } else if (j?.summary?.written?.changed > 0) {
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

  const activeIntel = useMemo(() => {
    if (!activeMatch) return null;
    const { ev, index } = evalOne(activeMatch, prefs);
    const tier = sleepTier(activeMatch.t);
    const narrative = narrativeOf(activeMatch, ev, storylines);
    return { ev, index, tier, narrative };
  }, [activeMatch, prefs]);

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
    return humanCountdown(engineCountdown(ts(tonight.focal.m.t), clockTs));
  }, [tonight.focal, clockTs]);

  const select = useCallback(id => setActiveMatchId(id), []);

  // 视图与选中同步到 URL（可分享 / 可刷新定位）
  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set('view', view);
    if (activeMatchId) sp.set('match', activeMatchId);
    window.history.replaceState(null, '', `?${sp.toString()}`);
  }, [view, activeMatchId]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden stage-atmosphere text-text-primary">
      {/* TopBar 的时钟、PlayerStage 的倒计时各自内部按秒刷新，不走这里 */}
      <TopBar
        view={view}
        onViewChange={setView}
        liveCount={liveCount}
        prefs={prefs}
        onOpenSettings={() => setSettingsOpen(true)}
        updateAvailable={updateAvailable}
        updateVersion={updateState.info?.version}
        onOpenUpdate={() => {
          setUpdateModalOpen(true);
          if (updateState.status === 'idle') handleCheckUpdate();
        }}
      />

      {/* 主工作区：左栏黄金比例（320-340px） + 右栏核心主舞台（~75%） */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左栏：决策与列表 */}
        <section className="flex min-h-0 w-[330px] lg:w-[345px] xl:w-[355px] shrink-0 flex-col overflow-hidden border-r border-line-hairline bg-surface-panel p-3.5 shadow-card">
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
            />
          )}
        </section>

        {/* 右栏：观赛大屏 + 情报 + 下方模块区。
            上半（播放器 + 熬夜看点/双方数据）保持原有纵向排布；
            下半新增模块区：双方后续赛程 & 同夜推荐 —— 宽屏并排两列、窄屏堆叠，
            把全屏时下方的空白用真正有决策价值的信息填满。 */}
        <section className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto bg-app p-4">
          <div className="mx-auto flex w-full max-w-[1800px] 2xl:max-w-full flex-col gap-3">
            <PlayerStage
              match={activeMatch}
              state={activeMatch ? stateOf(activeMatch, clockTs) : 'sched'}
              intel={activeIntel}
              isOverlayOpen={settingsOpen || onboardingOpen}
              spoilerFree={prefs.spoilerFree}
              revealed={activeMatch ? revealed.has(activeMatch.id) : false}
              onReveal={reveal}
            />
            <IntelPanel match={activeMatch} prefs={prefs} intel={activeIntel} indexHint={INDEX_HINT} />
            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
              <UpcomingFixtures match={activeMatch} prefs={prefs} />
              <SameNightPicks match={activeMatch} prefs={prefs} onSelect={select} />
            </div>
          </div>
        </section>
      </main>

      <SettingsDrawer
        open={settingsOpen}
        prefs={prefs}
        onPrefsChange={setPrefs}
        onClose={() => setSettingsOpen(false)}
        onRerunOnboarding={rerunOnboarding}
        onReplaySplash={replaySplash}
        onDataRefresh={refreshData}
        updateState={updateState}
        onOpenUpdateModal={() => {
          setUpdateModalOpen(true);
          if (updateState.status === 'idle') {
            handleCheckUpdate();
          }
        }}
      />

      <Onboarding
        open={onboardingOpen}
        prefs={prefs}
        onPrefsChange={setPrefs}
        onClose={() => setOnboardingOpen(false)}
      />

      {splashOpen && <SplashScreen onClose={handleCloseSplash} />}

      <UpdateModal
        open={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        currentVersion={__APP_VERSION__}
        updateState={updateState}
        onCheck={handleCheckUpdate}
        onDownload={handleDownloadUpdate}
        onInstall={handleInstallUpdate}
      />

      {/* 发现新版本时的轻量主动浮动提醒（避免用户不知道有更新） */}
      {updateAvailable && !toastDismissed && !updateModalOpen && (
        <aside
          aria-label="版本更新提醒"
          className="fixed bottom-5 right-5 z-modal flex max-w-sm items-center gap-3 rounded-xl border border-accent/40 bg-surface-card/95 p-3.5 shadow-pop backdrop-blur-xl transition-all duration-300"
        >
          <div className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </div>
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
              onClick={() => setUpdateModalOpen(true)}
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
