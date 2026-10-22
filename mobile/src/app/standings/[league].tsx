import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { getFixtures, leagueName, teamName } from '@data/index.js';
import { STANDINGS_LEAGUES, computeStandings, standingsCutoff } from '@core/standings.js';
import { isFinished } from '@core/engine.js';
import { bjDate } from '@core/format.js';

import { useDataRev } from '@/state/app';
import { useNow } from '@/lib/useNow';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { Match, StandingsRow } from '@/types';

type LeagueTable = {
  rows: StandingsRow[];
  doneCount: number;
  lastResultAt: number | null;
  note: string | null;
};

type DisplayItem =
  | { type: 'group'; key: string; label: string }
  | { type: 'row'; key: string; row: StandingsRow };

function displayItems(rows: StandingsRow[], league: string): DisplayItem[] {
  const out: DisplayItem[] = [];
  const isUcl = league === 'UCL';
  rows.forEach((row, index) => {
    if (isUcl && row.rank === 9) {
      out.push({ type: 'group', key: 'ucl-playoff', label: '附加赛区' });
    }
    if (isUcl && row.rank === 25) {
      out.push({ type: 'group', key: 'ucl-out', label: '出局区' });
    }
    if (!isUcl && row.rank === 5) {
      out.push({ type: 'group', key: 'top-end', label: '前四参考线' });
    }
    if (!isUcl && row.zoneKey === 'bottom' && rows[index - 1]?.zoneKey !== 'bottom') {
      out.push({ type: 'group', key: 'bottom-start', label: '后三名风险区' });
    }
    out.push({ type: 'row', key: row.teamId, row });
  });
  return out;
}

function formatGd(gd: number) {
  return gd > 0 ? `+${gd}` : `${gd}`;
}

export default function StandingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ league?: string; matchId?: string }>();
  const rev = useDataRev();
  const now = useNow(30_000);

  const rawLeague = Array.isArray(params.league) ? params.league[0] : params.league;
  const rawMatchId = Array.isArray(params.matchId) ? params.matchId[0] : params.matchId;
  const initialLeague = STANDINGS_LEAGUES.includes(rawLeague || '') ? rawLeague! : 'PL';
  const [league, setLeague] = useState(initialLeague);

  useEffect(() => {
    setLeague(initialLeague);
  }, [initialLeague]);

  const match = useMemo(
    () => getFixtures().find(item => item.id === rawMatchId) as Match | undefined,
    [rawMatchId, rev]
  );
  const isMatchLeague = !!match && match.l === league;
  const historical = isMatchLeague && isFinished(match);

  const table = useMemo(() => {
    const asOfTs = historical ? standingsCutoff(match, now) : now;
    return computeStandings(league, getFixtures(), { asOfTs }) as LeagueTable;
  }, [league, historical, match, now, rev]);

  const isUcl = league === 'UCL';
  const focusIds = new Set(isMatchLeague && match ? [match.h, match.a] : []);
  const homeRow =
    isMatchLeague && match ? table.rows.find(row => row.teamId === match.h) || null : null;
  const awayRow =
    isMatchLeague && match ? table.rows.find(row => row.teamId === match.a) || null : null;
  const asOfText = historical
    ? '截至本场开球前'
    : table.lastResultAt
      ? `截至 ${bjDate(table.lastResultAt).slice(5)}`
      : '暂无赛果';
  const matchSummary =
    isMatchLeague && match
      ? `本场：${teamName(match.h)} ${homeRow ? `第${homeRow.rank}` : '暂无'} · ${teamName(
          match.a
        )} ${awayRow ? `第${awayRow.rank}` : '暂无'}`
      : null;
  const items = displayItems(table.rows, league);

  const chooseLeague = (next: string) => {
    setLeague(next);
    router.setParams({ league: next });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            onPress={() => router.back()}
            style={styles.headerButton}
            accessibilityLabel="返回"
          >
            <ChevronLeft size={20} color={colors.text} />
          </Pressable>
          <View style={styles.modeControl}>
            <SegmentedControl
              value="standings"
              onChange={value => {
                if (value === 'schedule') router.dismissTo('/schedule');
              }}
              options={[
                { key: 'schedule', label: '赛程' },
                { key: 'standings', label: '积分榜' },
              ]}
            />
          </View>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.subline}>本地已同步赛果 · 同分简化排序</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.leagueScroll}
        contentContainerStyle={styles.leagueStrip}
      >
        {STANDINGS_LEAGUES.map(code => (
          <Chip
            key={code}
            selected={code === league}
            onPress={() => chooseLeague(code)}
          >
            {leagueName(code)}
          </Chip>
        ))}
      </ScrollView>

      <View style={styles.metaBlock}>
        <Text style={styles.metaText}>
          {leagueName(league)} · {asOfText} · {table.doneCount} 场已同步
        </Text>
        <Text style={styles.legendText}>
          {isUcl ? '前8直通 / 9–24 附加赛 / 25–36 出局' : '前四参考线 / 后三名风险区'}
        </Text>
        {matchSummary ? <Text style={styles.matchSummary}>{matchSummary}</Text> : null}
        <Text style={styles.hintText}>
          {isUcl
            ? '各队场次可能不同 · 同分按积分/净胜球/进球简化排序'
            : '分区为参考线 · 同分按积分/净胜球/进球简化排序'}
        </Text>
      </View>

      <View style={styles.tableHead}>
        <Text style={[styles.rankCol, styles.headText]}>#</Text>
        <Text style={[styles.teamCol, styles.headText]}>球队</Text>
        <Text style={[styles.numCol, styles.headText]}>赛</Text>
        <Text style={[styles.gdCol, styles.headText]}>净</Text>
        <Text style={[styles.ptsCol, styles.headText]}>分</Text>
      </View>

      <ScrollView
        style={styles.rows}
        contentContainerStyle={styles.rowsContent}
        showsVerticalScrollIndicator={false}
      >
        {items.length === 0 ? (
          <Text style={styles.empty}>{table.note || '本联赛暂无已同步赛果'}</Text>
        ) : (
          items.map(item => {
            if (item.type === 'group') {
              return (
                <View key={item.key} style={styles.groupRow}>
                  <Text style={styles.groupLabel}>{item.label}</Text>
                </View>
              );
            }

            const row = item.row;
            const focused = focusIds.has(row.teamId);
            return (
              <Pressable
                key={item.key}
                onPress={() =>
                  router.push({ pathname: '/team/[id]', params: { id: row.teamId } })
                }
                accessibilityRole="button"
                accessibilityLabel={`查看 ${teamName(row.teamId)} 球队页`}
                style={({ pressed }) => [
                  styles.row,
                  focused && styles.rowFocus,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.rankCol, styles.rankText]}>{row.rank}</Text>
                <View style={styles.teamCol}>
                  <Crest id={row.teamId} size={20} />
                  <Text style={styles.teamName} numberOfLines={1}>
                    {teamName(row.teamId)}
                  </Text>
                  {focused ? <Text style={styles.matchBadge}>本场</Text> : null}
                </View>
                <Text style={[styles.numCol, styles.numText]}>{row.played}</Text>
                <Text style={[styles.gdCol, styles.numText]}>{formatGd(row.gd)}</Text>
                <Text style={[styles.ptsCol, styles.ptsText]}>{row.points}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  headerSpacer: { width: 38, height: 38 },
  modeControl: { flex: 1, minWidth: 0 },
  subline: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 2 },
  leagueScroll: { flexGrow: 0 },
  leagueStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  metaBlock: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  metaText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  legendText: { color: colors.textMuted, fontSize: fontSize.xs },
  matchSummary: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  hintText: { color: colors.textFaint, fontSize: fontSize.xxs, marginTop: 2 },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
  },
  headText: { color: colors.textFaint, fontSize: fontSize.xxs, fontWeight: '600' },
  rows: { flex: 1 },
  rowsContent: { paddingBottom: spacing.xxl },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowFocus: { backgroundColor: colors.raised },
  pressed: { opacity: 0.8 },
  rankCol: { width: 30, textAlign: 'right' },
  teamCol: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  numCol: { width: 34, textAlign: 'right' },
  gdCol: { width: 44, textAlign: 'right' },
  ptsCol: { width: 38, textAlign: 'right' },
  rankText: {
    color: colors.textMuted,
    fontSize: fontSize.xxs,
    fontVariant: ['tabular-nums'],
  },
  teamName: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  matchBadge: {
    color: colors.textSecondary,
    fontSize: fontSize.xxs,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.full,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  numText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  ptsText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  groupRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  groupLabel: {
    color: colors.textFaint,
    fontSize: fontSize.xxs,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
});
