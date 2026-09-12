import { useMemo, useState } from 'react';
import { teams, FOLLOWABLE_LEAGUES, LEAGUE_NAMES, TEAM_MAP } from '../data/index.js';
import { Crest, Pill, SectionLabel } from './atoms.jsx';
import { defaultPrefs, toggleIn } from '../core/prefs.js';

/**
 * 设置抽屉（右侧滑出，480px）
 *
 * D6 关键点：**关注联赛是算法偏好**（影响 +8 加成），与赛程列表的**筛选药丸语义不同**。
 * 前者必须放在这里，不得与筛选器混排 —— 否则开发极易当成同一件事。
 */
export default function SettingsDrawer({ open, prefs, onPrefsChange, onClose, onRerunOnboarding }) {
  const [query, setQuery] = useState('');

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? teams.filter(
          t => t.zh.includes(query.trim()) || t.en.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
        )
      : teams;
    return list.slice(0, 24);
  }, [query]);

  const leagueCount = prefs.followedLeagues.length;
  const bonusActive = leagueCount > 0 && leagueCount < 6;

  const patch = p => onPrefsChange({ ...prefs, ...p });

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden="true"
      />

      {/* 抽屉 */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-border-subtle bg-surface-card shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <div>
            <h2 className="font-headline text-[15px] font-semibold text-slate-100">偏好与数据</h2>
            <p className="mt-0.5 text-[10px] text-slate-500">定制你的熬夜决策大脑</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border-subtle px-2 py-1 font-mono text-[11px] text-slate-400 hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="scrollbar-thin-dark flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 关注球队 */}
          <section>
            <SectionLabel right={<span className="font-mono text-[10px] text-slate-500">已选 {prefs.followedTeams.length}</span>}>
              关注球队
            </SectionLabel>

            {prefs.followedTeams.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
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

            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索 111 支球队…"
              className="mt-2.5 w-full rounded-md border border-border-subtle bg-bg-app px-3 py-1.5 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-border-strong focus:outline-none"
            />

            <div className="mt-2 grid grid-cols-6 gap-1.5">
              {filteredTeams.map(t => {
                const on = prefs.followedTeams.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={`${t.zh}${t.tag ? ` · ${t.tag}` : ''}`}
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

            <p className="mt-1.5 rounded border border-border-subtle bg-bg-app px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400">
              这里影响<strong className="font-semibold text-slate-200">算法排序</strong>
              （关注联赛场次 +8 分），与「赛程日历」里的联赛筛选
              <strong className="font-semibold text-slate-200">不是同一件事</strong>。
              核心规则：仅当已选 <strong className="font-semibold text-slate-200">少于 6 个</strong>{' '}
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
                    className={`rounded border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                      on
                        ? 'border-accent-teal/50 bg-accent-teal/15 text-accent-teal'
                        : 'border-border-subtle bg-bg-app text-slate-500 hover:text-slate-300'
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
              className="mt-1.5 font-mono text-[10px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
            >
              全选（注意：全选将使加成失效）
            </button>
          </section>

          {/* 睡眠成本与防剧透 */}
          <section>
            <SectionLabel>睡眠成本与规则</SectionLabel>

            <div className="mt-2 rounded-lg border border-border-subtle bg-bg-app px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-300">默认每周熬夜额度</span>
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

          {/* 数据状态 */}
          <section>
            <SectionLabel>数据与服务状态</SectionLabel>
            <div className="mt-2 space-y-1.5 rounded-lg border border-border-subtle bg-bg-app px-3 py-2.5 font-mono text-[10px] leading-relaxed text-slate-400">
              <p>赛程数据：本地快照 1,897 场（2026-08-16 ~ 2027-05-31）</p>
              <p>保鲜同步：未接入（P4）· 当前比分来自快照</p>
              <p>本地流代理：未接入（P3）</p>
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onPrefsChange(defaultPrefs())}
              className="font-mono text-[11px] text-slate-500 hover:text-slate-300"
            >
              恢复默认
            </button>
            {onRerunOnboarding && (
              <button
                type="button"
                onClick={onRerunOnboarding}
                className="font-mono text-[11px] text-slate-500 hover:text-slate-300"
              >
                ↻ 重新引导
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary-gold px-4 py-1.5 font-mono text-[11px] font-semibold text-black hover:bg-[#FFC426]"
          >
            完成
          </button>
        </div>
      </aside>
    </>
  );
}

function SwitchRow({ label, on, onChange, note }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-app px-3 py-2">
      <div>
        <p className="text-[11px] text-slate-300">{label}</p>
        {note && <p className="mt-0.5 font-mono text-[9px] text-slate-600">{note}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent-teal/70' : 'bg-slate-700'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            on ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
