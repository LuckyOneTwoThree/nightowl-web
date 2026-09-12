import { useCallback, useEffect, useMemo, useState } from 'react';
import { fixtures } from './data/index.js';
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
import TonightView from './components/TonightView.jsx';
import WeekView from './components/WeekView.jsx';
import ScheduleView from './components/ScheduleView.jsx';
import IntelPanel from './components/IntelPanel.jsx';
import PlayerStage from './components/PlayerStage.jsx';
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
  // ---- 时间：秒级 tick 只驱动时钟与倒计时，算法按分钟粒度重算 ----
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const minuteKey = Math.floor(now / 60000);

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
  }, [filters.spoilerFree]);

  const reveal = useCallback(id => {
    setRevealed(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // ---- 派生数据（分钟粒度重算，故意不依赖秒级 now）----
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tonight = useMemo(() => computeTonight(Date.now(), prefs), [minuteKey, prefs]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(
    () => (view === 'week' ? computeWeek(Date.now(), prefs) : null),
    [view, minuteKey, prefs]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scheduleRows = useMemo(
    () => (view === 'schedule' ? computeScheduleRows(Date.now(), prefs, filters) : []),
    [view, prefs, filters]
  );

  // ---- 顶栏"进行中"计数（30 秒粒度即可）----
  const halfMinute = Math.floor(now / 30000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveCount = useMemo(() => liveCountAt(Date.now()), [halfMinute]);

  // ---- 首屏自动锁定今晚之选（用户零点击即有内容）----
  useEffect(() => {
    if (activeMatchId) return;
    if (tonight.hero) setActiveMatchId(tonight.hero.m.id);
    else if (tonight.focal) setActiveMatchId(tonight.focal.m.id);
  }, [tonight, activeMatchId]);

  const activeMatch = activeMatchId ? MATCH_MAP[activeMatchId] : null;

  // 倒计时（每秒刷新）
  const countdownText = useMemo(() => {
    if (!tonight.focal) return '--';
    const cd = engineCountdown(ts(tonight.focal.m.t), now);
    return humanCountdown(cd);
  }, [tonight.focal, now]);

  const stageCountdown = useMemo(() => {
    if (!activeMatch) return '--';
    return humanCountdown(engineCountdown(ts(activeMatch.t), now));
  }, [activeMatch, now]);

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
      <TopBar
        view={view}
        onViewChange={setView}
        now={now}
        liveCount={liveCount}
        prefs={prefs}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* 主工作区：左栏 38%（min 420 / max 520） + 右栏 62% */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左栏：决策与列表 */}
        <section
          className="flex min-h-0 flex-col overflow-hidden border-r border-border-subtle bg-surface-panel p-4"
          style={{ width: '38%', minWidth: 420, maxWidth: 520 }}
        >
          {view === 'tonight' && (
            <TonightView
              tonight={tonight}
              now={now}
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
              now={now}
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
              now={now}
              activeMatchId={activeMatchId}
              onSelect={select}
              revealed={revealed}
              onReveal={reveal}
            />
          )}
        </section>

        {/* 右栏：观赛大屏 + 情报 */}
        <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-[#080B10] p-4">
          <PlayerStage
            match={activeMatch}
            state={activeMatch ? stateOf(activeMatch, now) : 'sched'}
            now={now}
            countdown={stageCountdown}
          />
          <IntelPanel match={activeMatch} prefs={prefs} />
        </section>
      </main>

      <SettingsDrawer
        open={settingsOpen}
        prefs={prefs}
        onPrefsChange={setPrefs}
        onClose={() => setSettingsOpen(false)}
        onRerunOnboarding={rerunOnboarding}
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
