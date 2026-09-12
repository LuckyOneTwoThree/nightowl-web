import { hm, zhDate, weekdayOf, datePart, liveMinute, humanCountdown } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts } from '../core/engine.js';
import { Crest, Pill, LiveDot } from './atoms.jsx';

/**
 * 右栏播放区 + 线路切换台
 *
 * 当前阶段（P2）说明：
 *   直播链路（本地流代理 / M3U8 重写 / 抓取对齐）属 P3，尚未接入。
 *   本组件先把「赛前态 / 进行中态 / 完赛态」三种非播放形态做对，
 *   播放器容器与线路台的骨架就位，P3 时替换为 ArtPlayer + hls.js。
 *
 * 数据纪律（D3）：进行中只显示**进行分钟**，比分位显示 —（实时比分不可达）。
 * 线路标签只显示**文本名**，不显示码率 / 帧率 / 延迟（`tv` 字段全空，无结构化元数据）。
 */
export default function PlayerStage({ match, state, now, countdown }) {
  if (!match) {
    return (
      <div className="flex aspect-video max-h-[46vh] w-full items-center justify-center rounded-xl border border-border-subtle bg-black/60">
        <p className="text-[11px] text-slate-500">从左侧选择一场比赛</p>
      </div>
    );
  }

  const kickTs = ts(match.t);
  const live = state === 'live';
  const minute = live ? liveMinute(kickTs, now) : 0;
  const finished = state === 'finished';

  return (
    <div className="flex flex-col gap-2.5">
      {/* 16:9 播放容器 */}
      <div className="relative aspect-video max-h-[46vh] w-full overflow-hidden rounded-xl border border-border-subtle bg-black">
        {/* 背景：无球赛时的静态氛围（不使用任何编造的战术图 / 数据可视化） */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgba(255,184,0,0.10),transparent_60%)]" />

        {/* 顶部信息条 */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/75 to-transparent px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-headline text-[13px] font-semibold text-slate-100">
              {teamName(match.h)} vs {teamName(match.a)}
            </span>
            <Pill>
              {leagueName(match.l)} 第 {match.r} 轮
            </Pill>
          </div>
          {live && (
            <Pill tone="red">
              <LiveDot />
              LIVE {minute}′
            </Pill>
          )}
        </div>

        {/* 中央态 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="flex items-center gap-4">
            <Crest id={match.h} size={52} />
            <span className="font-mono text-[22px] font-bold tabular-nums text-slate-200">
              {finished ? match.sc || '—' : '—'}
            </span>
            <Crest id={match.a} size={52} />
          </div>

          {state === 'sched' && (
            <div className="text-center">
              <p className="font-mono text-[10px] tracking-wider text-slate-500">距开球</p>
              <p className="font-mono text-[28px] font-bold tabular-nums text-primary-gold">{countdown}</p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                {zhDate(datePart(match.t))} {weekdayOf(datePart(match.t))} {hm(match.t)} 北京时间
              </p>
            </div>
          )}

          {live && (
            <p className="font-mono text-[11px] text-live-red">比赛进行中 · {minute} 分钟</p>
          )}

          {state === 'ended_pending' && (
            <p className="text-[11px] text-slate-400">比赛已结束，等待比分录入</p>
          )}

          {finished && <p className="font-mono text-[10px] text-slate-500">终场</p>}

          {state === 'pp' && <p className="text-[11px] text-slate-400">本场延期，日历将原位提示</p>}
        </div>

        {/* 底部：链路状态（P3 接入后替换为播放器控制条） */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-3.5 py-2.5">
          <div className="flex items-center gap-1.5">
            <Pill tone="warn">直播链路待接入</Pill>
            <span className="font-mono text-[9px] text-slate-500">
              本地流代理与抓取对齐属 P3，尚未实现
            </span>
          </div>
          <span className="font-mono text-[9px] text-slate-600">
            快捷键 [F] 全屏 [P] 画中画 [M] 静音 [1-4] 切源（接入后启用）
          </span>
        </div>
      </div>

      {/* 线路切换台骨架 */}
      <StreamSwitcher disabled />
    </div>
  );
}

/**
 * 线路切换台
 * 线路名来自抓取源原始文案（纯文本）；不展示码率 / 清晰度等结构化字段。
 */
function StreamSwitcher({ disabled }) {
  const lines = [
    { id: 1, label: '线路1', primary: true },
    { id: 2, label: '线路2' },
    { id: 3, label: '线路3' },
    { id: 4, label: '备用内嵌' }
  ];

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        {lines.map(l => (
          <button
            key={l.id}
            type="button"
            disabled={disabled}
            className={`rounded border px-2.5 py-1 font-mono text-[10px] transition-colors ${
              disabled
                ? 'cursor-not-allowed border-border-subtle bg-surface-card text-slate-600'
                : l.primary
                  ? 'border-primary-gold/50 bg-primary-gold/15 text-primary-gold'
                  : 'border-border-subtle bg-surface-card text-slate-400 hover:text-slate-200'
            }`}
          >
            {l.primary ? '● ' : ''}
            {l.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled}
        title={disabled ? '需先确定目标源站（SP-2）' : undefined}
        className={`rounded border px-2.5 py-1 font-mono text-[10px] transition-colors ${
          disabled
            ? 'cursor-not-allowed border-border-subtle bg-surface-card text-slate-600'
            : 'border-border-strong bg-surface-elevated text-slate-200 hover:bg-surface-hover'
        }`}
      >
        ↗ 直达原站
      </button>
    </div>
  );
}
