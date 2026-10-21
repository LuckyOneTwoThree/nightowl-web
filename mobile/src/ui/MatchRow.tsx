import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';

import { evalOne, stateOf } from '@core/owl.js';
import { sleepTier, ts } from '@core/engine.js';
import { hm, liveMinute } from '@core/format.js';
import { leagueColor, leagueName, teamName } from '@data/index.js';

import { Crest } from '@/ui/Crest';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { Prefs } from '@/state/prefs';
import type { Match } from '@/types';

type Props = {
  match: Match;
  now: number;
  prefs: Prefs;
  onPress: () => void;
  minefield?: boolean;
  showTier?: boolean;
};

export function MatchRow({ match, now, prefs, onPress, minefield = false, showTier = true }: Props) {
  const { index } = evalOne(match, prefs) as { index: number };
  const state = stateOf(match, now) as string;
  const isLive = state === 'live';
  const isDone = state === 'finished' || state === 'ended_pending';
  const tier = sleepTier(match.t);
  const minute = isLive ? liveMinute(ts(match.t), now) : 0;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.press }}
      accessibilityRole="button"
      accessibilityLabel={`${teamName(match.h)} 对 ${teamName(match.a)}，${hm(match.t)}，${leagueName(match.l)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.leagueBar, { backgroundColor: leagueColor(match.l) }]} />
      <View style={styles.timeCol}>
        <Text style={styles.time}>{hm(match.t)}</Text>
        <Text style={styles.league} numberOfLines={1}>
          {leagueName(match.l)}
          {showTier ? ` · ${tier.label}` : ''}
        </Text>
      </View>

      <View style={styles.teams}>
        <View style={styles.teamLine}>
          <Crest id={match.h} size={22} />
          <Text style={styles.teamName} numberOfLines={1}>
            {teamName(match.h)}
          </Text>
        </View>
        <View style={styles.teamLine}>
          <Crest id={match.a} size={22} />
          <Text style={styles.teamName} numberOfLines={1}>
            {teamName(match.a)}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        {isLive ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{minute}'</Text>
          </View>
        ) : isDone ? (
          <Text style={styles.doneText}>已结束</Text>
        ) : state === 'pp' ? (
          <Text style={styles.doneText}>延期</Text>
        ) : (
          <Text
            style={[
              styles.index,
              { color: index >= 15 ? colors.accent : colors.textSecondary },
            ]}
          >
            {index.toFixed(1)}
          </Text>
        )}
        {minefield ? (
          <View style={styles.warnRow}>
            <AlertTriangle size={11} color={colors.warn} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  pressed: { backgroundColor: colors.press },
  leagueBar: { width: 3, alignSelf: 'stretch', marginRight: spacing.sm },
  timeCol: { width: 56, gap: 2 },
  time: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  league: { color: colors.textFaint, fontSize: fontSize.xs },
  teams: { flex: 1, gap: 4, paddingVertical: spacing.sm },
  teamLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  teamName: { color: colors.textSecondary, fontSize: fontSize.md, flex: 1 },
  right: { minWidth: 48, alignItems: 'flex-end', gap: 3 },
  index: {
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  doneText: { color: colors.textFaint, fontSize: fontSize.xs },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.live },
  liveText: { color: colors.live, fontSize: fontSize.xs, fontWeight: '700' },
  warnRow: { flexDirection: 'row', alignItems: 'center' },
});
