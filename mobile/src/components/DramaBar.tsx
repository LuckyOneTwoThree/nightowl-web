import { StyleSheet, Text, View } from 'react-native';

import { WATCH_HINT_LEVEL } from '@core/reveal.js';
import { Chip } from '@/ui/Chip';
import { colors, fontSize, radius, spacing } from '@/ui/theme';

export type DramaTag = {
  id: string;
  label: string;
  tone: 'accent' | 'warn' | 'neutral';
  priority: number;
};

export type DramaSummary = {
  available: boolean;
  hasEvents: boolean;
  tags: DramaTag[];
  pulseMinutes: number[];
  degradedReason: string | null;
};

type Props = {
  drama: DramaSummary | null;
  fallbackHint?: {
    level: string;
    label: string;
    shortLabel: string;
  } | null;
  compact?: boolean;
};

export function DramaBar({ drama, fallbackHint = null, compact = false }: Props) {
  const tags = drama?.tags || [];
  const pulses = drama?.hasEvents ? drama.pulseMinutes || [] : [];

  if (tags.length === 0 && !fallbackHint && pulses.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.tags}>
        {tags.length > 0 ? (
          tags.map(tag => (
            <Chip
              key={tag.id}
              tone={tag.tone === 'accent' ? 'accent' : tag.tone === 'warn' ? 'warn' : 'default'}
            >
              {tag.label}
            </Chip>
          ))
        ) : fallbackHint ? (
          <Chip tone={fallbackHint.level === WATCH_HINT_LEVEL.HIGH ? 'accent' : 'default'}>
            {fallbackHint.label}
          </Chip>
        ) : null}
        {!compact && drama?.degradedReason === 'no-events' && tags.length > 0 ? (
          <Text style={styles.degraded}>暂无时间轴，仅按赛果烈度标记</Text>
        ) : null}
      </View>

      {!compact && pulses.length > 0 ? (
        <View
          style={styles.pulseRow}
          accessibilityLabel={`全场高能时间点脉冲共 ${pulses.length} 处`}
        >
          <Text style={styles.clock}>0'</Text>
          <View style={styles.track}>
            {pulses.map(min => {
              const leftPct = Math.max(2, Math.min(98, Math.round((min / 100) * 100)));
              return <View key={min} style={[styles.dot, { left: `${leftPct}%` }]} />;
            })}
          </View>
          <Text style={styles.clock}>90'+</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  degraded: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
  },
  pulseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  clock: {
    color: colors.textFaint,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
    position: 'relative',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
});
