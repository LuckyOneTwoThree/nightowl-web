import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontSize, radius, spacing, tierColor, withAlpha } from './theme';
import type { Tier } from '@/types';

type Props = {
  tier: Tier | null | undefined;
  size?: 'sm' | 'md';
  showZh?: boolean;
  showCost?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SleepBadge({
  tier,
  size = 'sm',
  showZh = false,
  showCost = true,
  style,
}: Props) {
  if (!tier) return null;
  const color = tierColor(tier.tier);
  const bg = withAlpha(color, 0.14);
  const border = withAlpha(color, 0.42);

  return (
    <View
      style={[
        styles.base,
        size === 'md' ? styles.md : styles.sm,
        { backgroundColor: bg, borderColor: border },
        style,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, size === 'md' ? styles.labelMd : styles.labelSm, { color }]}>
        {tier.label}
        {showZh && tier.zh ? ` ${tier.zh}` : ''}
      </Text>
      {showCost && tier.cost > 0 ? (
        <Text
          style={[
            styles.cost,
            size === 'md' ? styles.labelMd : styles.labelSm,
            { color: withAlpha(color, 0.85) },
          ]}
        >
          · {tier.cost}h
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    gap: 4,
  },
  sm: {
    height: 22,
    paddingHorizontal: spacing.sm,
  },
  md: {
    height: 26,
    paddingHorizontal: spacing.sm + 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
  },
  label: {
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cost: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  labelSm: {
    fontSize: fontSize.xxs,
  },
  labelMd: {
    fontSize: fontSize.xs,
  },
});
