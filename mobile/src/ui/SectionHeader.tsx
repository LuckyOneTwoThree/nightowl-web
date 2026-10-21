import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from './theme';

type Props = {
  title: string;
  count?: number;
  live?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  right?: ReactNode;
};

export function SectionHeader({ title, count, live = false, actionLabel, onAction, right }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.titleRow}>
        {live ? <View style={styles.liveDot} /> : null}
        <Text style={styles.title}>{title}</Text>
        {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
      </View>
      {right}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 26,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', letterSpacing: 0.2 },
  count: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  action: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  liveDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: colors.live },
});
