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
export default function Onboarding({ open, prefs, onPrefsChange, onClose }) {
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      t => t.zh.includes(query.trim()) || t.en.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
    );
  }, [query]);

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-[560px] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel shadow-2xl">
        {/* 头部 */}
        <div className="border-b border-border-subtle px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-headline text-[17px] font-bold text-slate-100">
                欢迎来到夜猫看台
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {step === 1 ? '第 1 步 · 选你的主队（可多选，也可跳过）' : '第 2 步 · 选关注的联赛'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-6 rounded-full ${step >= 1 ? 'bg-primary-gold' : 'bg-surface-elevated'}`} />
              <span className={`h-1.5 w-6 rounded-full ${step >= 2 ? 'bg-primary-gold' : 'bg-surface-elevated'}`} />
            </div>
          </div>
        </div>

        <div className="scrollbar-thin-dark min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === 1 && (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                关注的球队会<b className="text-slate-200">优先排入「今晚之选」</b>，
                并在背包规划中预算内必保。不设主队也能用，但推荐会少了这层优先级。
              </p>

              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索 111 支球队…"
                className="w-full rounded-md border border-border-subtle bg-bg-app px-3 py-2 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-border-strong focus:outline-none"
              />

              {prefs.followedTeams.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {prefs.followedTeams.map(id => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => patch({ followedTeams: toggleIn(prefs.followedTeams, id) })}
                      className="flex items-center gap-1.5 rounded-full border border-primary-gold/40 bg-primary-gold/10 px-2 py-0.5 text-[11px] text-primary-gold"
                    >
                      <Crest id={id} size={14} />
                      {TEAM_MAP[id]?.zh || id}
                      <span className="text-[9px] opacity-70">✕</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 grid grid-cols-6 gap-1.5">
                {filtered.slice(0, 60).map(t => {
                  const on = prefs.followedTeams.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => patch({ followedTeams: toggleIn(prefs.followedTeams, t.id) })}
                      className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-colors ${
                        on
                          ? 'border-primary-gold/50 bg-primary-gold/10'
                          : 'border-border-subtle bg-bg-app hover:border-border-strong'
                      }`}
                    >
                      <Crest id={t.id} size={22} />
                      <span className="w-full truncate text-center text-[9px] text-slate-400">{t.zh}</span>
                    </button>
                  );
                })}
              </div>
              {filtered.length > 60 && (
                <p className="mt-2 text-center text-[10px] text-slate-600">
                  共 {filtered.length} 支，输入关键词缩小范围
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                关注的联赛场次会获得 <b className="text-slate-200">+8 排序加成</b>，
                但只在<b className="text-slate-200">已选少于 6 个</b>时生效——全选等于没选。
                这与「赛程日历」里的筛选药丸是两回事（那个只过滤显示，不影响算法）。
              </p>

              <div className="grid grid-cols-3 gap-2">
                {FOLLOWABLE_LEAGUES.map(code => {
                  const on = prefs.followedLeagues.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => patch({ followedLeagues: toggleIn(prefs.followedLeagues, code) })}
                      className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                        on
                          ? 'border-accent-teal/50 bg-accent-teal/10'
                          : 'border-border-subtle bg-bg-app hover:border-border-strong'
                      }`}
                    >
                      <p className={`font-headline text-[13px] font-semibold ${on ? 'text-accent-teal' : 'text-slate-200'}`}>
                        {on ? '✓ ' : ''}{LEAGUE_NAMES[code]}
                      </p>
                      <p className="mt-0.5 font-mono text-[9px] text-slate-600">{code}</p>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-lg border border-border-subtle bg-bg-app px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">当前每周熬夜额度</span>
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
                <p className="mt-1 text-[10px] text-slate-500">
                  额度约束的是熬夜场次；零成本（傍晚）场次不占额度。
                </p>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Pill tone={bonusActive ? 'teal' : 'slate'}>
                  {bonusActive ? '+8 加成生效中' : leagueCount === 0 ? '未选择' : '全选 6 个 · 加成为 0'}
                </Pill>
                <span className="text-[10px] text-slate-500">
                  建议选 2–4 个真正会熬夜看的联赛
                </span>
              </div>
            </>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-border-subtle px-6 py-3.5">
          <button
            type="button"
            onClick={skip}
            className="font-mono text-[11px] text-slate-500 hover:text-slate-300"
          >
            跳过，以后再设置
          </button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-md border border-border-subtle px-3 py-1.5 font-mono text-[11px] text-slate-300 hover:bg-surface-hover"
              >
                上一步
              </button>
            )}
            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-md bg-primary-gold px-4 py-1.5 font-mono text-[11px] font-semibold text-black hover:bg-[#FFC426]"
              >
                {prefs.followedTeams.length ? `下一步（已选 ${prefs.followedTeams.length}）` : '下一步'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => finish(prefs)}
                className="rounded-md bg-primary-gold px-4 py-1.5 font-mono text-[11px] font-semibold text-black hover:bg-[#FFC426]"
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
