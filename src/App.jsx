import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFixtures, setFixtures } from './data/index.js';
import { countdown as engineCountdown, ts } from './core/engine.js';
import { humanCountdown } from './core/format.js';
import { loadPrefs, savePrefs } from './core/prefs.js';
import {
  computeTonight,
  computeWeek,
  computeScheduleRows,
  defaultScheduleFilters,
  liveCountAt,
  stateOf
} from './core/owl.js';

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
  const refreshData = useCallback(async () => {
    try {
      const r = await fetch('/api/fixtures');
      if (!r.ok) return false;
      const j = await r.json();
      if (j?.fixtures?.length && setFixtures(j.fixtures)) {
        setDataRev(v => v + 1);
        return true;
      }
    } catch {
      /* 服务不可用（纯静态预览）时静默沿用内置快照，不打扰用户 */
    }
    return false;
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  /**
   * 自动保鲜：启动跑一次，之后每 30 分钟检查
   *
   * 自动保鲜改由**服务端**负责（server/index.js 的 runBackgroundSync：
   * 启动 3 秒后首次自检，之后每 30 分钟一次，且用 activeSyncMonths 只扫 1~2 个月，
   * 几秒完成）。渲染层不再自行定时同步 —— 否则与服务端各跑一套定时器，
   * 互相触发 409「已有同步任务进行中」，纯属重复。
   *
   * 渲染层只保留两件事：
   *   ① 读取（refreshData 拉 /api/fixtures，把服务端数据热替换进内存）
   *   ② 手动兜底（设置面板的「立即同步比分」按钮）
   */
  useEffect(() => {
    // 服务端后台同步完成后数据会变；页面聚焦时轻量校准一次（不做定时轮询）
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

  // ---- 首屏自动锁定今晚之选（用户零点击即有内容）----
  useEffect(() => {
    if (activeMatchId) return;
    if (tonight.hero) setActiveMatchId(tonight.hero.m.id);
    else if (tonight.focal) setActiveMatchId(tonight.focal.m.id);
  }, [tonight, activeMatchId]);

  // 按 dataRev 重建：保鲜同步后右栏也要拿到新记录（含比分），不能停在构建期快照
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matchMap = useMemo(buildMatchMap, [dataRev]);
  const activeMatch = activeMatchId ? matchMap[activeMatchId] || null : null;

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#08090e] bg-[radial-gradient(ellipse_75%_55%_at_85%_5%,_rgba(124,58,237,0.16),_transparent_65%),radial-gradient(ellipse_60%_50%_at_12%_15%,_rgba(37,99,235,0.14),_transparent_65%),radial-gradient(ellipse_110%_70%_at_50%_-10%,_rgba(30,42,75,0.35),_rgba(8,10,16,0.95)_70%,_#05060a_100%)] text-text-primary">
      {/* TopBar 的时钟、PlayerStage 的倒计时各自内部按秒刷新，不走这里 */}
      <TopBar
        view={view}
        onViewChange={setView}
        liveCount={liveCount}
        prefs={prefs}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* 主工作区：左栏黄金比例（320-340px） + 右栏核心主舞台（~75%） */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左栏：决策与列表 */}
        <section className="flex min-h-0 w-[330px] lg:w-[345px] xl:w-[355px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-gradient-to-b from-[#111322]/90 via-[#0c0e17]/95 to-[#07080f] p-3.5 shadow-[4px_0_24px_rgba(0,0,0,0.35)]">
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
        <section className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-b from-[#0e101f]/60 via-[#080912]/80 to-[#040508]/95 p-4">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3">
            <PlayerStage
              match={activeMatch}
              state={activeMatch ? stateOf(activeMatch, clockTs) : 'sched'}
              isOverlayOpen={settingsOpen || onboardingOpen}
              spoilerFree={prefs.spoilerFree}
              revealed={activeMatch ? revealed.has(activeMatch.id) : false}
              onReveal={reveal}
            />
            <IntelPanel match={activeMatch} prefs={prefs} indexHint={INDEX_HINT} />
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
    </div>
  );
}
