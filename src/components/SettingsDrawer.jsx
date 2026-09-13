import { useEffect, useMemo, useState } from 'react';
import { fixtures, teams, FOLLOWABLE_LEAGUES, LEAGUE_NAMES, TEAM_MAP } from '../data/index.js';
import { Crest, Pill, SectionLabel } from './atoms.jsx';
import { defaultPrefs, toggleIn } from '../core/prefs.js';

/**
 * 设置抽屉（右侧滑出，480px）
 *
 * D6 关键点：**关注联赛是算法偏好**（影响 +8 加成），与赛程列表的**筛选药丸语义不同**。
 * 前者必须放在这里，不得与筛选器混排 —— 否则开发极易当成同一件事。
 */
const LEAGUE_TABS = [
  { id: 'ALL', label: '全部' },
  { id: 'PL', label: '英超' },
  { id: 'PD', label: '西甲' },
  { id: 'SA', label: '意甲' },
  { id: 'BL', label: '德甲' },
  { id: 'FL', label: '法甲' },
  { id: 'UCL', label: '欧战' }
];

export default function SettingsDrawer({ open, prefs, onPrefsChange, onClose, onRerunOnboarding }) {
  const [selectedLeague, setSelectedLeague] = useState('ALL');
  const [query, setQuery] = useState('');

  const teamCounts = useMemo(() => {
    const counts = { ALL: teams.length };
    teams.forEach(t => {
      counts[t.league] = (counts[t.league] || 0) + 1;
    });
    return counts;
  }, []);

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = teams;
    if (selectedLeague !== 'ALL') {
      list = list.filter(t => t.league === selectedLeague);
    }
    if (q) {
      list = list.filter(
        t =>
          t.zh.toLowerCase().includes(q) ||
          t.en.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [query, selectedLeague]);

  const leagueCount = prefs.followedLeagues.length;
  const bonusActive = leagueCount > 0 && leagueCount < 6;

  const health = useServiceHealth();
  const range = useMemo(() => {
    const days = fixtures.map(m => m.t.slice(0, 10)).sort();
    return days.length ? `${days[0]} ~ ${days[days.length - 1]}` : '—';
  }, []);

  const patch = p => onPrefsChange({ ...prefs, ...p });

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden="true"
      />

      {/* 抽屉 */}
      <aside
        className={`fixed right-0 top-0 z-[110] flex h-full w-[480px] flex-col border-l border-white/[0.04] bg-surface-card shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/[0.04] px-5 py-3.5">
          <div>
            <h2 className="font-headline text-[15px] font-semibold text-text-primary">偏好与数据</h2>
            <p className="mt-0.5 text-[10px] text-text-muted">定制你的熬夜决策大脑</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/[0.05]"
          >
            ✕
          </button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 关注球队 */}
          <section>
            <div className="flex items-center justify-between">
              <SectionLabel right={<span className="font-mono text-[10px] text-text-muted">已选 {prefs.followedTeams.length}</span>}>
                关注球队
              </SectionLabel>
              {prefs.followedTeams.length > 0 && (
                <button
                  type="button"
                  onClick={() => patch({ followedTeams: [] })}
                  className="font-mono text-[10px] text-text-dim hover:text-text-primary transition-colors"
                >
                  清空已选
                </button>
              )}
            </div>

            {prefs.followedTeams.length > 0 && (
              <div className="scrollbar-thin mt-2 flex max-h-[76px] flex-wrap gap-1.5 overflow-y-auto rounded-md bg-bg-app/60 p-1.5">
                {prefs.followedTeams.map(id => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => patch({ followedTeams: toggleIn(prefs.followedTeams, id) })}
                    className="flex items-center gap-1.5 rounded-full bg-primary-gold/15 px-2.5 py-0.5 text-[11px] text-primary-gold hover:bg-primary-gold/25 transition-colors"
                  >
                    <Crest id={id} size={14} />
                    <span>{TEAM_MAP[id]?.zh || id}</span>
                    <span className="text-[9px] opacity-70">✕</span>
                  </button>
                ))}
              </div>
            )}

            {/* 搜索框 */}
            <div className="relative mt-2.5">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索全部 111 支球队（中文 / 英文 / 缩写）…"
                className="w-full rounded-md bg-bg-app px-3 py-1.5 pr-8 text-[12px] text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary-gold/40"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-primary text-[11px]"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 联赛分类 Tabs */}
            <div className="mt-2 flex flex-wrap gap-1">
              {LEAGUE_TABS.map(tab => {
                const active = selectedLeague === tab.id;
                const count = teamCounts[tab.id] || 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSelectedLeague(tab.id)}
                    className={`rounded px-2.5 py-1 font-mono text-[10px] transition-colors ${
                      active
                        ? 'bg-primary-gold/20 text-primary-gold font-semibold shadow-xs'
                        : 'bg-bg-app text-text-muted hover:bg-surface-hover hover:text-text-primary'
                    }`}
                  >
                    {tab.label} {count}
                  </button>
                );
              })}
            </div>

            {/* 球队网格 (全量 111 支，带独立滚动条) */}
            <div className="scrollbar-thin mt-2 max-h-[250px] overflow-y-auto rounded-lg bg-bg-app/60 p-1.5">
              {filteredTeams.length === 0 ? (
                <div className="py-8 text-center text-[11px] text-text-muted">
                  未找到匹配球队
                  {selectedLeague !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setSelectedLeague('ALL')}
                      className="ml-1 text-primary-gold underline"
                    >
                      切换至全部联赛
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-1.5">
                  {filteredTeams.map(t => {
                    const on = prefs.followedTeams.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        title={`${t.zh} (${t.en}) · ${LEAGUE_NAMES[t.league] || t.league}${t.tag ? ` · ${t.tag}` : ''}`}
                        onClick={() => patch({ followedTeams: toggleIn(prefs.followedTeams, t.id) })}
                        className={`group relative flex flex-col items-center gap-1 rounded-md px-1 py-1.5 transition-all active:scale-95 ${
                          on
                            ? 'bg-primary-gold/15 text-primary-gold shadow-xs font-semibold'
                            : 'bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                        }`}
                      >
                        {on && (
                          <span className="absolute right-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary-gold text-[8px] font-bold text-black">
                            ✓
                          </span>
                        )}
                        <Crest id={t.id} size={22} />
                        <span className="w-full truncate text-center text-[9px] leading-tight">{t.zh}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-1 flex items-center justify-between px-1 font-mono text-[9px] text-text-dim">
              <span>全量 111 支欧洲顶级球队</span>
              <span>当前展示 {filteredTeams.length} 支</span>
            </div>
          </section>

          {/* 关注联赛（算法偏好，不是筛选） */}
          <section>
            <SectionLabel
              right={
                <Pill tone={bonusActive ? 'teal' : 'slate'}>
                  {bonusActive ? '+8 加成生效中' : leagueCount === 0 ? '未选择' : '加成为 0'}
                </Pill>
              }
            >
              关注联赛（算法偏好）
            </SectionLabel>

            <p className="mt-1.5 rounded bg-bg-app/80 px-2.5 py-1.5 text-[10px] leading-relaxed text-text-secondary">
              这里影响<strong className="font-semibold text-text-primary">算法排序</strong>
              （关注联赛场次 +8 分），与「赛程日历」里的联赛筛选
              <strong className="font-semibold text-text-primary">不是同一件事</strong>。
              核心规则：仅当已选 <strong className="font-semibold text-text-primary">少于 6 个</strong>{' '}
              联赛时加成生效；全选 6 个时加成为 0。
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {FOLLOWABLE_LEAGUES.map(code => {
                const on = prefs.followedLeagues.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => patch({ followedLeagues: toggleIn(prefs.followedLeagues, code) })}
                    className={`rounded px-2.5 py-1 font-mono text-[10px] transition-colors ${
                      on
                        ? 'bg-accent-teal/15 text-accent-teal font-medium shadow-xs'
                        : 'bg-bg-app text-text-muted hover:bg-surface-hover hover:text-text-primary'
                    }`}
                  >
                    {on ? '✓ ' : ''}
                    {LEAGUE_NAMES[code]}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => patch({ followedLeagues: [...FOLLOWABLE_LEAGUES] })}
              className="mt-1.5 font-mono text-[10px] text-text-muted underline-offset-2 hover:text-text-primary hover:underline"
            >
              全选（注意：全选将使加成失效）
            </button>
          </section>

          {/* 睡眠成本与防剧透 */}
          <section>
            <SectionLabel>睡眠成本与规则</SectionLabel>

            <div className="mt-2 rounded-lg bg-bg-app/80 px-3 py-2.5 shadow-card">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-secondary">默认每周熬夜额度</span>
                <span className="font-mono text-[13px] font-bold tabular-nums text-accent-teal">
                  {prefs.weeklyBudget.toFixed(1)} 小时
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="8"
                step="0.5"
                value={prefs.weeklyBudget}
                onChange={e => patch({ weeklyBudget: Number(e.target.value) })}
                className="mt-2 w-full accent-[#44E2CD]"
                aria-label="默认每周熬夜额度"
              />
            </div>

            <div className="mt-2 space-y-1.5">
              <SwitchRow
                label="已赛场次默认隐藏比分（防剧透）"
                on={prefs.spoilerFree}
                onChange={v => patch({ spoilerFree: v })}
              />
              <SwitchRow
                label="赛前 15 分钟系统通知"
                on={prefs.notifyBefore15}
                onChange={v => patch({ notifyBefore15: v })}
                note="依赖桌面外壳（P5），当前仅保存偏好"
              />
            </div>
          </section>

          {/* 数据状态：一律显示真实状态，不得写「未接入」这类与实现脱节的固定文案 */}
          <section>
            <SectionLabel>数据与服务状态</SectionLabel>
            <div className="mt-2 space-y-1.5 rounded-lg bg-bg-app/60 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-text-secondary">
              <p>赛程数据：本地快照 {fixtures.length.toLocaleString()} 场（{range}）</p>

              {health ? (
                <>
                  <p className="text-emerald-600 dark:text-emerald-400">
                    本地服务：已启动 · {health.listening}
                  </p>
                  <p>
                    流代理：静态白名单 {health.proxy.allowedHosts + health.proxy.allowedHostSuffixes} 条 ·
                    会话授权 {health.proxy.sessionAllowedHosts} 个 · 并发 {health.proxy.activeRequests}/{health.proxy.maxConcurrent}
                  </p>
                  <p>
                    保鲜同步：{health.scores.enabled ? '已启用' : '已禁用'}
                    {health.scores.lastSync
                      ? ` · 上次预览 ${health.scores.lastSync.patches} 条补丁 / ${health.scores.lastSync.errors} 错`
                      : ' · 本次启动后未跑过（POST /api/scores/sync）'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-warning-amber">本地服务：未启动（npm run server）</p>
                  <p>未启动时赛程与算法照常可用，播放与保鲜不可用</p>
                </>
              )}
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-white/[0.04] px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onPrefsChange(defaultPrefs())}
              className="font-mono text-[11px] text-text-muted hover:text-text-primary"
            >
              恢复默认
            </button>
            {onRerunOnboarding && (
              <button
                type="button"
                onClick={onRerunOnboarding}
                className="font-mono text-[11px] text-text-muted hover:text-text-primary"
              >
                ↻ 重新引导
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary-gold px-4 py-1.5 font-mono text-[11px] font-semibold text-black hover:opacity-90 shadow-sm"
          >
            完成
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * 拉取本地服务真实状态
 *
 * 为什么不写死文案：本产品的一条核心纪律是「界面不说谎」。
 * 设置面板曾显示「保鲜同步：未接入（P4）· 本地流代理：未接入（P3）」，
 * 而两者其实早已实现 —— 这类与实现脱节的固定文案，会让用户对系统能力产生错误判断，
 * 也会让开发者误以为功能缺失。因此改为直接问服务要状态，取不到就如实说未启动。
 */
function useServiceHealth() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => {
        if (alive) setHealth(j);
      })
      .catch(() => {
        if (alive) setHealth(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return health;
}

function SwitchRow({ label, on, onChange, note }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-bg-app/80 px-3.5 py-2.5 transition-colors">
      <div className="pr-3">
        <p className="text-[12px] font-medium text-text-secondary">{label}</p>
        {note && <p className="mt-0.5 font-mono text-[9px] text-text-dim">{note}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal ${
          on ? 'bg-accent-teal' : 'bg-slate-700'
        }`}
      >
        <span
          className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
            on ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
