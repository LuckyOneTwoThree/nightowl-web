import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Eye } from 'lucide-react-native';

import { evalOne, stateOf, INDEX_HIGHLIGHT_THRESHOLD } from '@core/owl.js';
import { sleepTier, ts } from '@core/engine.js';
import { hm, liveMinute } from '@core/format.js';
import { leagueColor, leagueName, teamName } from '@data/index.js';

import { selectionFeedback } from '@/lib/feedback';
import { useAppStore, useMatchRevealed } from '@/state/app';
import { Crest } from '@/ui/Crest';
import { colors, fontSize, radius, spacing, tierColor, withAlpha } from '@/ui/theme';
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

function parseScoreWinner(sc?: string | null): 'h' | 'a' | 'd' | null {
  if (!sc) return null;
  const parts = sc.split('-').map(s => parseInt(s.trim(), 10));
  if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  if (parts[0] > parts[1]) return 'h';
  if (parts[1] > parts[0]) return 'a';
  return 'd';
}

export function MatchRow({ match, now, prefs, onPress, minefield = false, showTier = true }: Props) {
  const { index } = evalOne(match, prefs) as { index: number };
  const state = stateOf(match, now) as string;
  const isLive = state === 'live';
  const isDone = state === 'finished' || state === 'ended_pending';
  const tier = sleepTier(match.t);
  const minute = isLive ? liveMinute(ts(match.t), now) : 0;
  const scoreVisible = useMatchRevealed(match.id, prefs.spoilerFree);
  const revealMatch = useAppStore(s => s.revealMatch);

  const homeFollowed = prefs.followedTeams.includes(match.h);
  const awayFollowed = prefs.followedTeams.includes(match.a);
  const hasScore = isDone && !!match.sc;
  const winner = hasScore && scoreVisible ? parseScoreWinner(match.sc) : null;
  const tColor = tierColor(tier.tier);
  const stateLabel = isLive
    ? `进行中 ${minute} 分钟`
    : hasScore
      ? scoreVisible
        ? `已结束 ${match.sc}`
        : '已结束，比分未揭晓'
      : isDone
        ? '已结束'
        : state === 'pp'
          ? '延期'
          : '未开赛';

  return (
    <Pressable
      onPress={() => {
        selectionFeedback();
        onPress();
      }}
      android_ripple={{ color: colors.press }}
      accessibilityRole="button"
      accessibilityLabel={`${teamName(match.h)} 对 ${teamName(match.a)}，${leagueName(match.l)}，${hm(
        match.t
      )}，${stateLabel}，夜猫指数 ${index.toFixed(1)}`}
      accessibilityHint="双击查看比赛详情"
      style={({ pressed }) => [
        styles.row,
        (homeFollowed || awayFollowed) && styles.rowFollowed,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.leagueBar,
          { backgroundColor: isLive ? colors.live : leagueColor(match.l) },
        ]}
      />
      <View style={styles.timeCol}>
        <Text style={styles.time}>{hm(match.t)}</Text>
        <Text style={styles.league} numberOfLines={1}>
          {leagueName(match.l)}
          {showTier ? (
            <Text style={[styles.tierInline, { color: tColor }]}>{` · ${tier.label}`}</Text>
          ) : null}
        </Text>
      </View>

      <View style={styles.teams}>
        <View style={styles.teamLine}>
          <Crest id={match.h} size={22} />
          <Text
            style={[
              styles.teamName,
              homeFollowed && styles.teamNameFollowed,
              winner === 'h' && styles.teamNameWinner,
              winner === 'a' && styles.teamNameLoser,
            ]}
            numberOfLines={1}
          >
            {teamName(match.h)}
          </Text>
          {homeFollowed ? <View style={styles.followDot} /> : null}
        </View>
        <View style={styles.teamLine}>
          <Crest id={match.a} size={22} />
          <Text
            style={[
              styles.teamName,
              awayFollowed && styles.teamNameFollowed,
              winner === 'a' && styles.teamNameWinner,
              winner === 'h' && styles.teamNameLoser,
            ]}
            numberOfLines={1}
          >
            {teamName(match.a)}
          </Text>
          {awayFollowed ? <View style={styles.followDot} /> : null}
        </View>
      </View>

      <View style={styles.right}>
        {isLive ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{minute}'</Text>
          </View>
        ) : hasScore ? (
          scoreVisible ? (
            <View style={styles.scoreCol}>
              <Text style={styles.scoreText}>{match.sc}</Text>
              <Text style={styles.doneSub}>完场</Text>
            </View>
          ) : (
            <Pressable
              onPress={e => {
                e.stopPropagation();
                selectionFeedback();
                revealMatch(match.id);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="揭晓比分"
              style={({ pressed }) => [styles.revealPill, pressed && styles.pressed]}
            >
              <Eye size={11} color={colors.accent} />
              <Text style={styles.revealPillText}>揭晓</Text>
            </Pressable>
          )
        ) : isDone ? (
          <Text style={styles.doneText}>已结束</Text>
        ) : state === 'pp' ? (
          <Text style={styles.doneText}>延期</Text>
        ) : (
          <Text
            style={[
              styles.index,
              { color: index >= INDEX_HIGHLIGHT_THRESHOLD ? colors.accent : colors.textSecondary },
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
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowFollowed: {
    backgroundColor: withAlpha(colors.accent, 0.03),
  },
  pressed: { backgroundColor: colors.press },
  leagueBar: { width: 3, alignSelf: 'stretch', marginRight: spacing.sm },
  timeCol: { width: 60, gap: 2 },
  time: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  league: { color: colors.textFaint, fontSize: fontSize.xs },
  tierInline: { fontWeight: '700', fontSize: fontSize.xs },
  teams: { flex: 1, gap: 5, paddingVertical: spacing.sm, paddingRight: spacing.xs },
  teamLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  teamName: { color: colors.textSecondary, fontSize: fontSize.md, flexShrink: 1 },
  teamNameFollowed: { color: colors.text, fontWeight: '600' },
  teamNameWinner: { color: colors.text, fontWeight: '700' },
  teamNameLoser: { color: colors.textMuted },
  followDot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  right: { minWidth: 56, alignItems: 'flex-end', gap: 3 },
  index: {
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  scoreCol: { alignItems: 'flex-end', gap: 1 },
  scoreText: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  doneSub: { color: colors.textFaint, fontSize: fontSize.xs },
  doneText: { color: colors.textFaint, fontSize: fontSize.xs },
  revealPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.35),
    backgroundColor: colors.goldSoft,
  },
  revealPillText: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: withAlpha(colors.live, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.live, 0.32),
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.live },
  liveText: {
    color: colors.live,
    fontSize: fontSize.xs,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  warnRow: { flexDirection: 'row', alignItems: 'center' },
});
