import { useMemo, useState } from 'react';
import { teams, FOLLOWABLE_LEAGUES, LEAGUE_NAMES, TEAM_MAP } from '../data/index.js';
import { Crest, Pill } from './atoms.jsx';
import { toggleIn } from '../core/prefs.js';

const ONBOARDING_KEY = 'onboardingDone';

/** 是否需要展示首次引导：未标记完成 且 尚未设置关注球队 */
export function shouldShowOnboarding(prefs) {
  try {
    if (localStorage.getItem(ONBOARDING_KEY)) return false;
  } catch {
    /* localStorage 不可用时照常展示 */
  }
  return (prefs.followedTeams || []).length === 0;
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* 忽略 */
  }
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(ONBOARDING_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 首次体验引导（两步向导）
 *
 * 为什么要有：不设主队时，Hero 排序第一优先级（isFollowed 布尔比较）永远不生效，
 * 首屏只能看到"矮子里拔将军"的标准档卡片。引导把这件事在第一次运行就解决。
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

export default function Onboarding({ open, prefs, onPrefsChange, onClose }) {
  const [step, setStep] = useState(1);
  const [selectedLeague, setSelectedLeague] = useState('ALL');
  const [query, setQuery] = useState('');

  const teamCounts = useMemo(() => {
    const counts = { ALL: teams.length };
    teams.forEach(t => {
      counts[t.league] = (counts[t.league] || 0) + 1;
    });
    return counts;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = teams;
    if (selectedLeague !== 'ALL') {
      list = list.filter(t => t.league === selectedLeague);
    }
    if (q) {
      list = list.filter(
        t =>
          t.zh.includes(query.trim()) ||
          t.en.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [query, selectedLeague]);

  if (!open) return null;

  const finish = nextPrefs => {
    onPrefsChange(nextPrefs);
    markOnboardingDone();
    onClose();
  };

  const skip = () => {
    markOnboardingDone();
    onClose();
  };

  const patch = p => onPrefsChange({ ...prefs, ...p });

  const leagueCount = prefs.followedLeagues.length;
  const bonusActive = leagueCount > 0 && leagueCount < 6;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-[580px] flex-col overflow-hidden rounded-2xl border border-white/[0.04] bg-surface-panel shadow-2xl">
        {/* 头部 */}
        <div className="border-b border-white/[0.04] px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-headline text-[17px] font-bold text-text-primary">
                欢迎来到夜猫看台
              </h2>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {step === 1 ? '第 1 步 · 选你的主队（可多选，也可跳过）' : '第 2 步 · 选关注的联赛'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-6 rounded-full transition-colors ${step >= 1 ? 'bg-primary-gold' : 'bg-surface-elevated'}`} />
              <span className={`h-1.5 w-6 rounded-full transition-colors ${step >= 2 ? 'bg-primary-gold' : 'bg-surface-elevated'}`} />
            </div>
          </div>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === 1 && (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
                关注的球队会<b className="text-text-primary font-semibold">优先排入「今晚之选」</b>，
                并在背包规划中预算内必保。不设主队也能用，但推荐会少了这层优先级。
              </p>

              <div className="relative">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="搜索全部 111 支球队（中文 / 英文 / 缩写）…"
                  className="w-full rounded-md bg-bg-app px-3 py-2 pr-8 text-[12px] text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary-gold/40"
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
              <div className="mt-2.5 flex flex-wrap gap-1">
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

              {prefs.followedTeams.length > 0 && (
                <div className="mt-2.5 flex max-h-[72px] flex-wrap gap-1.5 overflow-y-auto rounded-md bg-bg-app/60 p-1.5 scrollbar-thin">
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

              {/* 全量球队展示网格 */}
              <div className="scrollbar-thin mt-3 max-h-[280px] overflow-y-auto rounded-lg bg-bg-app/60 p-1.5">
                {filtered.length === 0 ? (
                  <div className="py-10 text-center text-[11px] text-text-muted">
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
                  <div className="grid grid-cols-6 gap-1.5">
                    {filtered.map(t => {
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

              <div className="mt-2 flex items-center justify-between px-1 font-mono text-[10px] text-text-dim">
                <span>全量 111 支欧洲顶级球队</span>
                <span>当前展示 {filtered.length} 支</span>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
                选出你经常关注的联赛（建议 2–4 个）。已选少于 6 个时触发{' '}
                <b className="text-text-primary font-semibold">算法优先加成（+8 分）</b>；全选 6 个时无区分度，加成为 0。
              </p>

              <div className="grid grid-cols-2 gap-2">
                {FOLLOWABLE_LEAGUES.map(code => {
                  const on = prefs.followedLeagues.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => patch({ followedLeagues: toggleIn(prefs.followedLeagues, code) })}
                      className={`rounded-lg px-3 py-3 text-left transition-colors ${
                        on
                          ? 'bg-accent-teal/15 text-accent-teal font-medium shadow-xs'
                          : 'bg-bg-app text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      <p className={`font-headline text-[13px] font-semibold ${on ? 'text-accent-teal' : 'text-text-primary'}`}>
                        {on ? '✓ ' : ''}{LEAGUE_NAMES[code]}
                      </p>
                      <p className="mt-0.5 font-mono text-[9px] text-text-dim">{code}</p>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-lg bg-bg-app/80 px-3 py-2.5 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text-secondary">当前每周熬夜额度</span>
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
                  aria-label="每周熬夜额度"
                />
                <p className="mt-1 text-[10px] text-text-muted">
                  额度约束的是熬夜场次；零成本（傍晚）场次不占额度。
                </p>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Pill tone={bonusActive ? 'teal' : 'slate'}>
                  {bonusActive ? '+8 加成生效中' : leagueCount === 0 ? '未选择' : '全选 6 个 · 加成为 0'}
                </Pill>
                <span className="text-[10px] text-text-muted">
                  建议选 2–4 个真正会熬夜看的联赛
                </span>
              </div>
            </>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-white/[0.04] px-6 py-3.5">
          <button
            type="button"
            onClick={skip}
            className="font-mono text-[11px] text-text-muted hover:text-text-primary"
          >
            跳过，以后再设置
          </button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-md px-3 py-1.5 font-mono text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              >
                上一步
              </button>
            )}
            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-md bg-primary-gold px-4 py-1.5 font-mono text-[11px] font-semibold text-black hover:opacity-90 shadow-sm"
              >
                {prefs.followedTeams.length ? `下一步（已选 ${prefs.followedTeams.length}）` : '下一步'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => finish(prefs)}
                className="rounded-md bg-primary-gold px-4 py-1.5 font-mono text-[11px] font-semibold text-black hover:opacity-90 shadow-sm"
              >
                完成
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
