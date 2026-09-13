import { hm, zhDate, weekdayOf, datePart, liveMinute } from '../core/format.js';
import { teamName, leagueName } from '../data/index.js';
import { ts, sleepTier } from '../core/engine.js';
import { Button, Chip, Crest, Hint, LiveDot, Meta, SleepBadge, Stars } from './atoms.jsx';
import { IconPlay, IconWarn } from './icons.jsx';

/**
 * 三档措辞。指数 < 5 时不吹不硬推 —— 这是产品纪律，不是样式分支。
 * `ctaVariant: primary` 意味着它是本屏唯一的实心强调按钮。
 */
const TIER_COPY = {
  highlight: { label: '今晚焦点', cta: '开始观赛', ctaVariant: 'primary' },
  standard: { label: '今晚可看', cta: '开始观赛', ctaVariant: 'default' },
  weak: { label: '今夜无必看', cta: '仍要观看', ctaVariant: 'ghost' }
};

/**
 * 今晚之选 Hero 卡（D9 分档）
 *
 * 降噪要点：
 *   · 高亮档此前用 `bg-gradient-to-b from-amber-500/8`，与卡片本身的金边、
 *     金色 CTA、金色指数叠加成四层强调。现在卡内的品牌金只剩两个角色：
 *     描边 = 这张卡是今晚之选，实心 CTA = 这里点下去。档位措辞与指数回归中性
 *     ——同一个指数在下方情报面板表头已经用 accent 标过一次，重复上色不增加信息。
 *   · 「L2 看点」是内容供给层级的内部编号，对用户没有决策价值，降为 Hint。
 *   · 冷知识此前是紫色斜体底块 —— 一个装饰性色块抢走了主看点的注意力，
 *     改为正文下方的一行弱文字。
 *   · 卡片不渲染 narrative.lines / trivia：默认选中的就是今晚之选，这两块会与下方
 *     情报面板的「看点与故事线」逐字重复三行。卡片只留一句推荐语，展开内容
 *     归面板这个唯一事实来源，省下的竖向空间还给赛程列表。
 */
export default function HeroCard({ hero, tier, narrative, state, now, onWatch, indexHint }) {
  const m = hero.m;
  const ev = hero.ev;
  const copy = TIER_COPY[tier] || TIER_COPY.standard;
  const isHighlight = tier === 'highlight';
  const isWeak = tier === 'weak';

  const live = state === 'live';
  const minute = live ? liveMinute(ts(m.t), now) : 0;
  const tierCost = sleepTier(m.t).cost;

  return (
    <article
      className={`no-drag rounded-lg bg-surface-card p-3.5 shadow-card transition-colors ${
        isHighlight ? 'border border-accent/25' : 'border border-line-hairline'
      } ${isWeak ? 'opacity-90' : ''}`}
    >
      {/* 标题行：档位措辞 + 夜猫指数 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`text-2xs font-semibold ${isHighlight ? 'text-text-secondary' : 'text-text-muted'}`}
          >
            {copy.label}
          </span>
          <Stars star={ev.star} />
          {ev.isFollowed && <Chip tone="accent">主队</Chip>}
        </div>
        <div className="flex shrink-0 items-baseline gap-1">
          <Hint content={indexHint} align="end" />
          <span className="text-2xs text-text-faint">夜猫指数</span>
          <span
            className={`font-num text-sm font-semibold tabular-nums ${
              isHighlight ? 'text-text-primary' : 'text-text-secondary'
            }`}
          >
            {hero.index.toFixed(1)}
          </span>
        </div>
      </div>

      {/* 对阵 */}
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center justify-end gap-2">
          <span className="truncate text-sm font-semibold text-text-primary" title={teamName(m.h)}>
            {teamName(m.h)}
          </span>
          <Crest id={m.h} size={26} />
        </div>
        <span className="px-1 font-num text-2xs text-text-faint">vs</span>
        <div className="flex min-w-0 items-center gap-2">
          <Crest id={m.a} size={26} />
          <span className="truncate text-sm font-semibold text-text-primary" title={teamName(m.a)}>
            {teamName(m.a)}
          </span>
        </div>
      </div>

      {/* 时刻行 */}
      <div className="mt-1.5 flex items-center justify-center gap-2">
        {live ? (
          <span className="inline-flex items-center gap-1.5">
            <LiveDot />
            <span className="font-num text-2xs font-medium text-live">进行中 {minute}′</span>
          </span>
        ) : (
          <Meta num>
            {m.tbd ? '时间待定' : `${hm(m.t)} 开球`} · {zhDate(datePart(m.t))} {weekdayOf(datePart(m.t))}
          </Meta>
        )}
        <Meta>{leagueName(m.l)} 第 {m.r} 轮</Meta>
      </div>

      {/* 主看点：只给一句话推荐语，展开内容在下方情报面板 */}
      <div className="mt-3 border-t border-line-hairline pt-2.5">
        <p className="text-xs font-medium leading-relaxed text-text-primary">{narrative.headline}</p>
      </div>

      {/* 底部：睡眠代价 + CTA */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SleepBadge match={m} />
          {tierCost >= 3.5 && (
            <span className="inline-flex items-center gap-1 text-2xs text-danger">
              <IconWarn size={11} />
              熬夜代价高
            </span>
          )}
        </div>
        <Button variant={copy.ctaVariant} size="md" icon={<IconPlay />} onClick={() => onWatch(m.id)}>
          {copy.cta}
        </Button>
      </div>
    </article>
  );
}

/** 无球日 / 全部 tbd 降级卡：下一场焦点战倒计时 */
export function NoMatchCard({ focal, countdown, onSelect }) {
  if (!focal) {
    return (
      <article className="no-drag rounded-lg border border-line-hairline bg-surface-card p-4 text-center shadow-card">
        <p className="text-sm font-medium text-text-primary">近期没有可安排的比赛</p>
        <p className="mt-1 text-2xs text-text-muted">赛程数据可能尚未同步，可在「偏好与数据」中手动同步。</p>
      </article>
    );
  }

  const m = focal.m;
  return (
    <article className="no-drag rounded-lg border border-line-hairline bg-surface-card p-3.5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold text-text-muted">今夜无球 · 下一场焦点</span>
        <Stars star={focal.ev.star} />
      </div>

      <div className="mt-3 flex items-center justify-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Crest id={m.h} size={22} />
          <span className="truncate text-sm font-semibold text-text-primary">{teamName(m.h)}</span>
        </div>
        <span className="font-num text-2xs text-text-faint">vs</span>
        <div className="flex min-w-0 items-center gap-2">
          <Crest id={m.a} size={22} />
          <span className="truncate text-sm font-semibold text-text-primary">{teamName(m.a)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center border-t border-line-hairline pt-2.5">
        <span className="text-2xs text-text-faint">距开球</span>
        <span className="font-num text-xl font-semibold tabular-nums text-accent">{countdown}</span>
        <Meta num className="mt-0.5">
          {zhDate(datePart(m.t))} {weekdayOf(datePart(m.t))} {hm(m.t)} · {leagueName(m.l)}
        </Meta>
      </div>

      <Button variant="default" size="md" className="mt-3 w-full" onClick={() => onSelect(m.id)}>
        查看赛前情报
      </Button>
    </article>
  );
}
