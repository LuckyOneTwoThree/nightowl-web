import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Eye } from 'lucide-react-native';

import { evalOne, stateOf } from '@core/owl.js';
import { sleepTier, ts } from '@core/engine.js';
import { hm, liveMinute, zhDate } from '@core/format.js';
import { completedWatchHint, WATCH_HINT_LEVEL } from '@core/reveal.js';
import { leagueColor, leagueName, teamName } from '@data/index.js';

import { selectionFeedback } from '@/lib/feedback';
import { useAppStore, useMatchRevealed } from '@/state/app';
import { useWatchLaterStore } from '@/state/queue';
import { Crest } from '@/ui/Crest';
import { colors, fontSize, radius, spacing, tierColor, withAlpha, weight } from '@/ui/theme';
import type { Prefs } from '@/state/prefs';
import type { Ev, Match } from '@/types';

type Props = {
  match: Match;
  now: number;
  prefs: Prefs;
  onPress: () => void;
  minefield?: boolean;
  showTier?: boolean;
  showDate?: boolean;
  isLast?: boolean;
};

function parseScoreWinner(sc?: string | null): 'h' | 'a' | 'd' | null {
  if (!sc) return null;
  const parts = sc.split('-').map(s => parseInt(s.trim(), 10));
  if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  if (parts[0] > parts[1]) return 'h';
  if (parts[1] > parts[0]) return 'a';
  return 'd';
}

export const MatchRow = memo(function MatchRow({
  match,
  now,
  prefs,
  onPress,
  minefield = false,
  showTier = true,
  showDate = false,
  isLast = false,
}: Props) {
  const { ev, index } = evalOne(match, prefs) as { ev: Ev & { stakes?: Array<{ label?: string }> }; index: number };
  const state = stateOf(match, now) as string;
  const isLive = state === 'live';
  const isDone = state === 'finished' || state === 'ended_pending';
  const tier = sleepTier(match.t);
  const minute = isLive ? liveMinute(ts(match.t), now) : 0;
  const scoreVisible = useMatchRevealed(match.id, prefs.spoilerFree);
  const revealMatch = useAppStore(s => s.revealMatch);
  const queueStatus = useWatchLaterStore(
    s => s.items.find(item => item.id === match.id)?.status ?? null
  );

  const homeFollowed = prefs.followedTeams.includes(match.h);
  const awayFollowed = prefs.followedTeams.includes(match.a);
  const isTbd = !!match.tbd;
  const score = isDone && match.sc && /^\d+-\d+$/.test(match.sc) ? match.sc : null;
  const hasScore = !!score;
  const [homeScore, awayScore] = score ? score.split('-') : [];
  const winner = hasScore && scoreVisible ? parseScoreWinner(score) : null;
  const tColor = tierColor(tier.tier);
  const watchHint = useMemo(
    () =>
      hasScore && !scoreVisible
        ? (completedWatchHint as (m: Match, ev?: unknown) => {
            level: string;
            label: string;
            shortLabel: string;
          } | null)(match, ev)
        : null,
    [hasScore, scoreVisible, match, ev]
  );
  const stakeTag = !isDone && !isTbd && state !== 'pp'
    ? ev?.rivalry || ev?.stakes?.[0]?.label || null
    : null;
  const stateLabel = isTbd
    ? '时间待定'
    : isLive
      ? `进行中 ${minute} 分钟`
      : hasScore
        ? scoreVisible
          ? `已结束 ${score}`
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
      accessibilityRole="button"
      accessibilityLabel={`${teamName(match.h)} 对 ${teamName(match.a)}，${leagueName(match.l)}，${
        isTbd ? '时间待定' : hm(match.t)
      }，${stateLabel}${isTbd ? '' : `，夜猫指数 ${index.toFixed(1)}`}`}
      accessibilityHint="双击查看比赛详情"
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowBorder,
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
        {showDate && !isTbd ? (
          <Text style={styles.dateMini} numberOfLines={1}>
            {zhDate(match.t.slice(0, 10))}
          </Text>
        ) : null}
        <Text style={styles.time}>{isTbd ? '--:--' : hm(match.t)}</Text>
        <Text style={styles.league} numberOfLines={1}>
          {leagueName(match.l)}
          {showTier && !isTbd ? (
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
          {hasScore && scoreVisible ? (
            <Text style={[styles.rowScore, winner === 'h' && styles.rowScoreWinner]}>
              {homeScore}
            </Text>
          ) : null}
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
          {hasScore && scoreVisible ? (
            <Text style={[styles.rowScore, winner === 'a' && styles.rowScoreWinner]}>
              {awayScore}
            </Text>
          ) : null}
        </View>
        {stakeTag || queueStatus === 'pending' ? (
          <View style={styles.metaRow}>
            {queueStatus === 'pending' ? <Text style={styles.queuedTag}>已入补看</Text> : null}
            {stakeTag ? (
              <Text style={styles.stakeTag} numberOfLines={1}>
                {stakeTag}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.right}>
        {isLive ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{minute}'</Text>
          </View>
        ) : hasScore ? (
          scoreVisible ? (
            <Text style={styles.doneSub}>完场</Text>
          ) : (
            <View style={styles.revealWrap}>
              {watchHint && watchHint.level !== WATCH_HINT_LEVEL.NORMAL ? (
                <Text
                  style={[
                    styles.watchHintText,
                    watchHint.level === WATCH_HINT_LEVEL.HIGH
                      ? styles.watchHintHigh
                      : styles.watchHintLow,
                  ]}
                  numberOfLines={1}
                >
                  {watchHint.shortLabel}
                </Text>
              ) : null}
              <Pressable
                onPress={e => {
                  e.stopPropagation();
                  selectionFeedback();
                  revealMatch(match.id);
                }}
                hitSlop={13}
                accessibilityRole="button"
                accessibilityLabel="揭晓比分"
                style={({ pressed }) => [styles.revealPill, pressed && styles.pressed]}
              >
                <Eye size={11} color={colors.accent} />
                <Text style={styles.revealPillText}>揭晓</Text>
              </Pressable>
            </View>
          )
        ) : isDone ? (
          <Text style={styles.doneText}>已结束</Text>
        ) : state === 'pp' ? (
          <Text style={styles.doneText}>延期</Text>
        ) : isTbd ? (
          <Text style={styles.doneText}>待定</Text>
        ) : (
          /* 指数弱化：金色强调只留给 Hero 与详情页的指数归因，
             列表行逐行点金会让「今晚之选」失去唯一性。
             读屏口径仍由父级 accessibilityLabel 完整给出。 */
          <Text style={styles.index}>{index.toFixed(1)}</Text>
        )}
        {minefield ? (
          <View style={styles.warnRow}>
            <AlertTriangle size={11} color={colors.warn} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.md,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowFollowed: {
    backgroundColor: withAlpha(colors.accent, 0.03),
  },
  pressed: { backgroundColor: colors.raised },
  leagueBar: { width: 3, alignSelf: 'stretch', marginRight: spacing.sm },
  timeCol: { width: 60, gap: 2 },
  dateMini: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: weight.label,
    fontVariant: ['tabular-nums'],
  },
  time: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  league: { color: colors.textFaint, fontSize: fontSize.xs },
  tierInline: { fontWeight: weight.title, fontSize: fontSize.xs },
  teams: { flex: 1, gap: 5, paddingVertical: spacing.sm, paddingRight: spacing.xs },
  teamLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  teamName: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: weight.label, flex: 1 },
  teamNameFollowed: { color: colors.text, fontWeight: weight.title },
  teamNameWinner: { color: colors.text, fontWeight: weight.title },
  teamNameLoser: { color: colors.textMuted },
  rowScore: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
    minWidth: 14,
    textAlign: 'right',
  },
  rowScoreWinner: { color: colors.text, fontWeight: weight.title },
  followDot: {
    width: 5,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queuedTag: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: weight.title,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.3),
    borderRadius: radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  stakeTag: {
    flex: 1,
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  right: { minWidth: 44, alignItems: 'flex-end', gap: 3 },
  revealWrap: { alignItems: 'flex-end', gap: 3 },
  watchHintText: { fontSize: 10, fontWeight: weight.title },
  watchHintHigh: { color: colors.accent },
  watchHintLow: { color: colors.textFaint },
  index: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: weight.title,
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
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.35),
    backgroundColor: colors.goldSoft,
  },
  revealPillText: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: weight.title,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.live, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.live, 0.32),
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.live },
  liveText: {
    color: colors.live,
    fontSize: fontSize.xs,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  warnRow: { flexDirection: 'row', alignItems: 'center' },
});
