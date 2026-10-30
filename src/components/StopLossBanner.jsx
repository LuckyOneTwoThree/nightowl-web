import { Button } from './atoms.jsx';
import { teamName } from '../data/index.js';
import { hm } from '../core/format.js';
import { formatSleepHours } from '../core/sleep.js';

/**
 * 止损提醒：非阻断，不自动暂停播放。
 * 只在应用前台、到达个人止损点且该场尚未结束时出现。
 */
export default function StopLossBanner({ context, notice = null, onSleep, onSnooze, onIgnore }) {
  if (!context?.match || !context.ledger) return null;
  const { match, ledger } = context;
  const remaining = ledger.overWake
    ? '看完直接到起床点'
    : `看完只剩约 ${formatSleepHours(ledger.remainingHours)} 睡眠`;
  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="止损提醒"
      className="fixed bottom-5 left-1/2 z-modal w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-warn/35 bg-surface-card/95 p-3.5 shadow-pop backdrop-blur-xl animate-view-enter motion-reduce:animate-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-warn">已到你的止损点</p>
          <p className="mt-1 text-sm font-medium text-text-primary">
            {teamName(match.h)} vs {teamName(match.a)} · {hm(match.t)} 开球
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            按 {ledger.profile.wakeTime} 起床、最低 {ledger.profile.minSleep}h 计算，{remaining}。
            现在睡，明早看结果？
          </p>
          {notice && <p className="mt-1 text-2xs text-warn">{notice}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onSnooze}>再看 15 分钟</Button>
        <Button variant="default" size="sm" onClick={onIgnore}>继续看（今晚不再提醒）</Button>
        <Button variant="primary" size="sm" onClick={onSleep}>现在睡</Button>
      </div>
    </aside>
  );
}
