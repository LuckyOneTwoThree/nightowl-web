import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { teamName } from '@data/index.js';
import { hm } from '@core/format.js';
import { formatSleepHours } from '@core/sleep.js';
import { colors, fontSize, radius, spacing } from '@/ui/theme';

type Props = {
  context: any;
  notice: string | null;
  onSleep: () => void;
  onSnooze: () => void;
  onIgnore: () => void;
};

export function StopLossBanner({ context, notice, onSleep, onSnooze, onIgnore }: Props) {
  const insets = useSafeAreaInsets();
  if (!context?.match || !context?.ledger) return null;
  const { match, ledger } = context;
  const remaining = ledger.overWake
    ? '看完直接到起床点'
    : `看完只剩约 ${formatSleepHours(ledger.remainingHours)} 睡眠`;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.card} accessibilityLiveRegion="polite" accessibilityLabel="止损提醒">
        <Text style={styles.eyebrow}>已到你的止损点</Text>
        <Text style={styles.title} numberOfLines={1}>
          {teamName(match.h)} vs {teamName(match.a)} · {hm(match.t)} 开球
        </Text>
        <Text style={styles.body}>
          按 {ledger.profile.wakeTime} 起床、最低 {ledger.profile.minSleep}h 计算，{remaining}。
          现在睡，明早看结果？
        </Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <View style={styles.actions}>
          <Pressable
            onPress={onSnooze}
            accessibilityRole="button"
            accessibilityLabel="再看十五分钟"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>再看 15 分钟</Text>
          </Pressable>
          <Pressable
            onPress={onIgnore}
            accessibilityRole="button"
            accessibilityLabel="继续看，今晚不再提醒"
            style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
          >
            <Text style={styles.ghostText}>继续看</Text>
          </Pressable>
          <Pressable
            onPress={onSleep}
            accessibilityRole="button"
            accessibilityLabel="现在睡，加入明早补看"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>现在睡</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: 'rgba(224,168,46,0.38)',
    backgroundColor: 'rgba(20,25,36,0.97)',
    padding: spacing.lg,
    gap: spacing.xs,
  },
  eyebrow: { color: colors.warn, fontSize: fontSize.xs, fontWeight: '700' },
  title: { color: colors.text, fontSize: fontSize.base, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  notice: { color: colors.warn, fontSize: fontSize.xs, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  primary: {
    minHeight: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '800' },
  secondary: {
    minHeight: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.panel,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  ghost: { minHeight: 40, borderRadius: radius.lg, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.textMuted, fontSize: fontSize.xs },
  pressed: { opacity: 0.78 },
});
