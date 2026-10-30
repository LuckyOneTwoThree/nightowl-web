import { formatSleepHours, sleepLedger } from '../core/sleep.js';

export function sleepProfileFromPrefs(prefs) {
  return {
    enabled: prefs?.sleepEnabled === true,
    wakeTime: prefs?.sleepWakeTime || '07:30',
    minSleep: prefs?.sleepMinHours ?? 7
  };
}

export function sleepLedgerFor(match, prefs) {
  if (!match?.t) return null;
  const ledger = sleepLedger(match.t, sleepProfileFromPrefs(prefs));
  return ledger.valid && ledger.ready ? ledger : null;
}

export function sleepLedgerText(ledger) {
  if (!ledger) return '';
  if (ledger.overWake) return '看完直接到起床点';
  return `看完约剩 ${formatSleepHours(ledger.remainingHours)}`;
}

/**
 * 一行个人睡眠结论。只在睡眠档案启用且时间可解析时出现；
 * 低于底线时把结果说清楚，不用“睡够”掩盖缺口。
 */
export default function SleepNote({ match, prefs, className = '', showWake = true, warn = false, size = 'sm' }) {
  const ledger = sleepLedgerFor(match, prefs);
  if (!ledger) return null;
  const text = sleepLedgerText(ledger);
  const gap =
    ledger.belowFloor && !ledger.overWake
      ? ` · 低于 ${ledger.profile.minSleep}h 底线，建议补看`
      : '';
  const tone = ledger.belowFloor ? 'text-warn' : 'text-text-muted';
  const title = `按 ${ledger.profile.wakeTime} 起床，预计 ${ledger.endClock} 结束；${
    ledger.overWake
      ? '看完已经到起床点'
      : `剩余约 ${formatSleepHours(ledger.remainingHours)}，最低 ${ledger.profile.minSleep}h`
  }`;
  return (
    <span
      role={warn ? 'note' : undefined}
      className={`inline-flex min-w-0 items-center gap-1 ${size === 'md' ? 'text-xs' : 'text-2xs'} ${tone} ${className}`}
      title={title}
    >
      {showWake && <span className="font-num tabular-nums">{ledger.profile.wakeTime}</span>}
      {showWake && <span className="text-text-faint">起床 ·</span>}
      <span className={ledger.belowFloor ? 'font-medium' : ''}>{text}</span>
      {gap && <span>{gap}</span>}
    </span>
  );
}
