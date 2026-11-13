import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus.js';
import { FOLLOWABLE_LEAGUES, LEAGUE_NAMES, leagueColor } from '../data/index.js';
import { BrandLogo, Button, Chip, Hint, Meta, TogglePill } from './atoms.jsx';
import TeamPicker from './TeamPicker.jsx';

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

const TEAM_RULE =
  '不设主队也能用。但「今晚之选」的第一优先级就是主队出战，跳过这一步的话推荐会少一层偏向。';

const LEAGUE_RULE =
  '关注联赛给该联赛场次 +8 夜猫指数；建议 2–4 个真正会熬夜看的。全选 6 个等于没有偏好，加成为 0。';

/**
 * 首次体验引导（两步向导）
 *
 * 为什么要有：不设主队时，Hero 排序第一优先级（isFollowed 布尔比较）永远不生效，
 * 首屏只能看到"矮子里拔将军"的标准档卡片。引导把这件事在第一次运行就解决。
 *
 * 球队选择的实现与设置面板共用 TeamPicker —— 两处曾经是两份副本。
 */
export default function Onboarding({ open, prefs, onPrefsChange, onClose }) {
  const [step, setStep] = useState(1);
  const [enableSleepOnFinish, setEnableSleepOnFinish] = useState(true);
  const step2FirstRef = useRef(null);

  // 关闭即回到第一步：否则从设置里「重新引导」会直接停在用户上次离开的第 2 步。
  useEffect(() => {
    if (!open) {
      setStep(1);
      setEnableSleepOnFinish(true);
    }
  }, [open]);

  // 背景 inert 时键盘焦点不能落在 body 上：第 1 步 TeamPicker 自带 autoFocus（不抢），
  // 第 2 步聚焦第一个联赛开关；关闭时统一归还。
  useDialogFocus(open, step === 2 ? step2FirstRef : null);

  const patch = p => onPrefsChange({ ...prefs, ...p });

  if (!open) return null;

  const leagueCount = prefs.followedLeagues.length;
  const bonusActive = leagueCount > 0 && leagueCount < 6;

  const finish = () => {
    if (enableSleepOnFinish && !prefs.sleepEnabled) {
      onPrefsChange({
        ...prefs,
        sleepEnabled: true,
        sleepWeekendEnabled: prefs.sleepWeekendEnabled !== false
      });
    }
    markOnboardingDone();
    onClose();
  };

  const skip = () => {
    markOnboardingDone();
    onClose();
  };

  const toggleLeague = code =>
    patch({
      followedLeagues: prefs.followedLeagues.includes(code)
        ? prefs.followedLeagues.filter(x => x !== code)
        : [...prefs.followedLeagues, code]
    });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-6"
    >
      <div className="flex max-h-[86vh] w-[580px] flex-col overflow-hidden rounded-2xl border border-line-hairline bg-surface-panel shadow-pop">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line-hairline px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={36} rounded="xl" withGlow />
            <div>
              <h2 id="onboarding-title" className="font-headline text-lg font-semibold text-text-primary">
                欢迎来到夜猫看台
              </h2>
              <Meta className="mt-0.5 block">
                第 {step} / 2 步 · {step === 1 ? '选主队' : '选关注联赛与熬夜额度'}
              </Meta>
            </div>
          </div>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {[1, 2].map(n => (
              <span key={n} className={`h-1 w-6 rounded-full ${step >= n ? 'bg-accent' : 'bg-line-control'}`} />
            ))}
          </div>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === 1 ? (
            <>
              <div className="mb-3 flex items-center gap-1.5 text-xs text-text-secondary">
                关注的球队会优先排入「今晚之选」
                <Hint content={TEAM_RULE} align="start" />
              </div>
              <TeamPicker
                selected={prefs.followedTeams}
                onChange={v => patch({ followedTeams: v })}
                gridClass="grid-cols-5"
                listClass="max-h-72"
                autoFocus
              />
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-1.5 text-xs text-text-secondary">
                选经常熬夜看的联赛
                <Hint content={LEAGUE_RULE} align="start" />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {FOLLOWABLE_LEAGUES.map(code => (
                  <TogglePill
                    key={code}
                    ref={code === FOLLOWABLE_LEAGUES[0] ? step2FirstRef : undefined}
                    on={prefs.followedLeagues.includes(code)}
                    onClick={() => toggleLeague(code)}
                    label={LEAGUE_NAMES[code]}
                    color={leagueColor(code)}
                  />
                ))}
              </div>

              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-text-secondary">每周熬夜额度</span>
                  <span className="font-num text-sm font-semibold tabular-nums text-resource">
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
                  className="mt-2 w-full accent-resource"
                  aria-label="每周熬夜额度"
                />
              </div>

              <div className="mt-3">
                <Chip tone={bonusActive ? 'resource' : 'neutral'}>
                  {bonusActive ? '+8 生效' : leagueCount === 0 ? '未选择' : '全选 · +0'}
                </Chip>
              </div>

              <div className="mt-4 rounded-xl border border-line-hairline bg-surface-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-text-primary">作息底线与睡眠账本</p>
                    <Meta className="mt-0.5 block">自动按次日是工作日还是周末，算出每场看完还剩多少睡眠</Meta>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-2xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={enableSleepOnFinish}
                      onChange={e => setEnableSleepOnFinish(e.target.checked)}
                      className="accent-accent"
                    />
                    <span>开启</span>
                  </label>
                </div>

                {enableSleepOnFinish && (
                  <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-line-hairline pt-2.5">
                    <div>
                      <span className="text-2xs text-text-muted">工作日早晨起床</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {['07:00', '07:30', '08:00', '08:30'].map(t => {
                          const active = (prefs.sleepWakeTime || '07:30') === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => patch({ sleepWakeTime: t })}
                              className={`rounded px-2 py-0.5 font-num text-2xs tabular-nums transition-colors cursor-pointer ${
                                active
                                  ? 'bg-accent/20 text-accent font-medium'
                                  : 'bg-surface-panel text-text-muted hover:text-text-primary'
                              }`}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <span className="text-2xs text-text-muted">周末（周五/六夜）起床</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {['08:30', '09:00', '09:30', '10:00'].map(t => {
                          const active = (prefs.sleepWeekendWakeTime || '09:00') === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => patch({ sleepWeekendEnabled: true, sleepWeekendWakeTime: t })}
                              className={`rounded px-2 py-0.5 font-num text-2xs tabular-nums transition-colors cursor-pointer ${
                                active
                                  ? 'bg-accent/20 text-accent font-medium'
                                  : 'bg-surface-panel text-text-muted hover:text-text-primary'
                              }`}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 底部：一屏只有一个 primary */}
        <div className="flex items-center justify-between border-t border-line-hairline px-6 py-3.5">
          <Button variant="text" onClick={skip}>
            跳过
          </Button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <Button variant="text" onClick={() => setStep(1)}>
                上一步
              </Button>
            )}
            {step === 1 ? (
              <Button variant="primary" onClick={() => setStep(2)}>
                下一步
                {prefs.followedTeams.length > 0 && (
                  <Meta num className="text-accent/70">{prefs.followedTeams.length}</Meta>
                )}
              </Button>
            ) : (
              <Button variant="primary" onClick={finish}>
                完成
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
