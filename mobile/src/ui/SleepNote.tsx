import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import type { Match } from '@/types';
import { formatSleepHours, sleepLedger } from '@core/sleep.js';
import type { Prefs } from '@/state/prefs';

import { colors, fontSize } from './theme';

type SleepPrefs = Pick<Prefs, 'sleepEnabled' | 'sleepWakeTime' | 'sleepMinHours'>;

export function sleepLedgerFor(match: Match | null | undefined, prefs: SleepPrefs) {
  if (!match?.t || !prefs.sleepEnabled) return null;
  const ledger = sleepLedger(match.t, {
    enabled: prefs.sleepEnabled,
    wakeTime: prefs.sleepWakeTime,
    minSleep: prefs.sleepMinHours,
  });
  return ledger.valid && ledger.ready ? ledger : null;
}

export function SleepNote({
  match,
  prefs,
  style,
}: {
  match: Match | null | undefined;
  prefs: SleepPrefs;
  style?: StyleProp<TextStyle>;
}) {
  const ledger = sleepLedgerFor(match, prefs);
  if (!ledger) return null;
  const text = ledger.overWake ? '看完直接到起床点' : `看完约剩 ${formatSleepHours(ledger.remainingHours)}`;
  const gap =
    ledger.belowFloor && !ledger.overWake ? ` · 低于 ${ledger.profile.minSleep}h 底线，建议补看` : '';
  return (
    <Text
      style={[styles.note, ledger.belowFloor && styles.warn, style]}
      numberOfLines={2}
      accessibilityLabel={`按 ${ledger.profile.wakeTime} 起床，${text}${gap}`}
    >
      按 {ledger.profile.wakeTime} 起床 · {text}
      {gap}
    </Text>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 16 },
  warn: { color: colors.warn, fontWeight: '600' },
});
