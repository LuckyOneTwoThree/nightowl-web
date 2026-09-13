import { useCallback, useEffect, useMemo, useState } from 'react';
import { fixtures, setFixtures } from './data/index.js';
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
import SettingsDrawer from './components/SettingsDrawer.jsx';
import Onboarding, { shouldShowOnboarding } from './components/Onboarding.jsx';

/** 比赛 id → 记录（O(1) 取用） */
const MATCH_MAP = fixtures.reduce((acc, m) => {
  acc[m.id] = m;
  return acc;
}, {});

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
  const [activeMatchId, setActiveMatchId] = useState(
    boot.matchId && MATCH_MAP[boot.matchId] ? boot.matchId : null
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revealed, setRevealed] = useState(() => new Set());
  const [filters, setFilters] = useState(() => defaultScheduleFilters());

  // 首次引导：未完成标记且未设主队时展示（跳过或完成都会写入标记，不再骚扰）
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding(prefs));
  const rerunOnboarding = () => {
    setSettingsOpen(false);
    setOnboardingOpen(true);
  };

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

  const activeMatch = activeMatchId ? MATCH_MAP[activeMatchId] : null;

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-app">
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
        <section className="flex min-h-0 w-[330px] lg:w-[345px] xl:w-[355px] shrink-0 flex-col overflow-hidden border-r border-line-hairline bg-surface-panel p-3.5">
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

        {/* 右栏：观赛大屏 + 情报与数据。
            宽屏时决策情报与「双方后续赛程」并排两列 —— 全屏不再下方大片空白；
            窄屏自动堆叠。 */}
        <section className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-stage-bg p-4">
          <PlayerStage
            match={activeMatch}
            state={activeMatch ? stateOf(activeMatch, clockTs) : 'sched'}
            isOverlayOpen={settingsOpen || onboardingOpen}
            spoilerFree={prefs.spoilerFree}
            revealed={activeMatch ? revealed.has(activeMatch.id) : false}
            onReveal={reveal}
          />
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <IntelPanel match={activeMatch} prefs={prefs} indexHint={INDEX_HINT} />
            <UpcomingFixtures match={activeMatch} prefs={prefs} />
          </div>
        </section>
      </main>

      <SettingsDrawer
        open={settingsOpen}
        prefs={prefs}
        onPrefsChange={setPrefs}
        onClose={() => setSettingsOpen(false)}
        onRerunOnboarding={rerunOnboarding}
        onDataRefresh={refreshData}
      />

      <Onboarding
        open={onboardingOpen}
        prefs={prefs}
        onPrefsChange={setPrefs}
        onClose={() => setOnboardingOpen(false)}
      />
    </div>
  );
}
