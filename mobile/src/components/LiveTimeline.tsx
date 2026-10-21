import { StyleSheet, Text, View } from 'react-native';

import { EVENT_LABEL, EVENT_TONE, eventSummary } from '@core/live-events.js';

import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { Match } from '@/types';
import type { LiveEvent } from '@/data/useLiveMatch';

const TONES = EVENT_TONE as Record<string, string>;
const LABELS = EVENT_LABEL as Record<string, string>;

const TONE: Record<string, string> = {
  accent: colors.accent,
  danger: colors.danger,
  warn: colors.warn,
  neutral: colors.textMuted,
};

export function LiveTimeline({
  match,
  events,
  live,
}: {
  match: Match;
  events: LiveEvent[];
  live: boolean;
}) {
  const list = live ? [...events].reverse() : events;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {live ? <View style={styles.liveDot} /> : null}
        <Text style={styles.title}>{live ? '实时事件' : '比赛事件'}</Text>
        <Text style={styles.count}>{events.length}</Text>
      </View>

      {list.length === 0 ? (
        <Text style={styles.empty}>暂无关键事件</Text>
      ) : (
        list.map((event, index) => {
          const tone = TONE[TONES[event.type] || 'neutral'] || colors.textMuted;
          return (
            <View key={`${event.clock}-${event.type}-${event.text}-${index}`} style={styles.row}>
              <Text style={styles.clock}>{event.clock || '--'}</Text>
              <View style={[styles.marker, { backgroundColor: tone }]} />
              <View style={styles.body}>
                <Text style={[styles.summary, { color: tone }]}>
                  {eventSummary(event, match)}
                </Text>
                {event.text ? (
                  <Text style={styles.text} numberOfLines={2}>
                    {event.text}
                  </Text>
                ) : null}
                <Text style={styles.type}>{LABELS[event.type] || '事件'}</Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.live },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  count: { marginLeft: 'auto', color: colors.textFaint, fontSize: fontSize.xs },
  empty: { color: colors.textMuted, fontSize: fontSize.sm, paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  clock: {
    width: 42,
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  marker: { width: 3, borderRadius: radius.full, opacity: 0.9 },
  body: { flex: 1, gap: 2 },
  summary: { fontSize: fontSize.sm, fontWeight: '700' },
  text: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 17 },
  type: { color: colors.textFaint, fontSize: fontSize.xxs, letterSpacing: 0.5 },
});
