import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search as SearchIcon, X } from 'lucide-react-native';

import {
  FOLLOWABLE_LEAGUES,
  LEAGUE_ORDER,
  leagueName,
  teams,
} from '@data/index.js';
import { computeScheduleRows } from '@core/owl.js';
import { useNow } from '@/lib/useNow';
import { useDataRev } from '@/state/app';
import { usePrefs } from '@/state/prefs';
import { Crest } from '@/ui/Crest';
import { EmptyState } from '@/ui/EmptyState';
import { MatchRow } from '@/ui/MatchRow';
import { SectionHeader } from '@/ui/SectionHeader';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { Match } from '@/types';

const SUGGESTED_TEAMS = ['ARS', 'MCI', 'LIV', 'FCB', 'PSG', 'RMA'];

export default function SearchScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const rev = useDataRev();
  const now = useNow(60_000);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();

  const teamResults = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return [];
    return teams
      .filter(team =>
        [team.zh, team.en, team.id].some(value => value.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [trimmed]);

  const matchResults = useMemo(() => {
    if (!trimmed) return [] as Match[];
    const rows = computeScheduleRows(now, prefs, {
      leagues: [...LEAGUE_ORDER],
      onlyFollowed: false,
      query: trimmed,
    }) as Array<{ type: 'date' | 'match'; m?: Match }>;
    return rows
      .filter(row => row.type === 'match' && row.m)
      .slice(0, 30)
      .map(row => row.m as Match);
  }, [trimmed, now, prefs, rev]);

  const suggestedTeams = useMemo(
    () => teams.filter(team => SUGGESTED_TEAMS.includes(team.id)),
    []
  );

  const goSchedule = (q: string) => {
    router.dismissAll();
    // nav 是一次性的导航令牌：同关键词再次搜索时参数不会变，
    // 没有它赛程页会认为“已应用过”而忽略这次跳转。
    router.push({ pathname: '/schedule', params: { q, date: 'all', nav: String(Date.now()) } });
  };

  const openTeam = (teamId: string) => {
    router.dismissAll();
    router.push({ pathname: '/team/[id]', params: { id: teamId } });
  };

  const openMatch = (id: string) =>
    router.push({ pathname: '/match/[id]', params: { id } });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.inputWrap}>
          <SearchIcon size={16} color={colors.textFaint} />
          <TextInput
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            value={query}
            onChangeText={setQuery}
            placeholder="搜索球队、比赛或联赛"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={14} accessibilityLabel="清空搜索">
              <X size={16} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.cancelHit}>
          <Text style={styles.cancel}>取消</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!trimmed ? (
          <>
            <Text style={styles.sectionLabel}>热门球队</Text>
            <View style={styles.teamChips}>
              {suggestedTeams.map(team => (
                <Pressable
                  key={team.id}
                  onPress={() => openTeam(team.id)}
                  style={({ pressed }) => [styles.teamChip, pressed && styles.pressed]}
                >
                  <Crest id={team.id} size={24} />
                  <Text style={styles.teamChipText}>{team.zh}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>按联赛浏览</Text>
            <View style={styles.leagueChips}>
              {FOLLOWABLE_LEAGUES.map(code => (
                <Pressable
                  key={code}
                  onPress={() => goSchedule(leagueName(code))}
                  style={({ pressed }) => [styles.leagueChip, pressed && styles.pressed]}
                >
                  <Text style={styles.leagueText}>{leagueName(code)}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.hint}>
              搜索范围覆盖中文名、英文名、缩写与联赛名；选择球队后会跳到对应赛程。
            </Text>
          </>
        ) : (
          <>
            {teamResults.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="球队" count={teamResults.length} />
                <View style={styles.list}>
                  {teamResults.map(team => (
                    <Pressable
                      key={team.id}
                      onPress={() => openTeam(team.id)}
                      style={({ pressed }) => [styles.teamRow, pressed && styles.pressed]}
                    >
                      <Crest id={team.id} size={30} />
                      <View style={styles.teamRowText}>
                        <Text style={styles.teamRowName}>{team.zh}</Text>
                        <Text style={styles.teamRowMeta}>
                          {team.en} · {leagueName(team.league)}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="比赛" count={matchResults.length} />
              {matchResults.length > 0 ? (
                <View style={styles.list}>
                  {matchResults.map(match => (
                    <MatchRow
                      key={match.id}
                      match={match}
                      now={now}
                      prefs={prefs}
                      onPress={() => openMatch(match.id)}
                    />
                  ))}
                </View>
              ) : (
                <EmptyState
                  icon={<SearchIcon size={20} color={colors.textMuted} />}
                  title="没有找到比赛"
                  description="试试球队英文名、缩写，或只输入两个字。"
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    height: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  input: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: 0 },
  cancelHit: { minHeight: 32, justifyContent: 'center' },
  cancel: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  body: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  sectionLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    paddingTop: spacing.sm,
  },
  teamChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  teamChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  teamChipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  leagueChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  leagueChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  leagueText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 18 },
  section: { gap: spacing.sm },
  list: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  teamRowText: { flex: 1, gap: 1 },
  teamRowName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  teamRowMeta: { color: colors.textFaint, fontSize: fontSize.xs },
  pressed: { opacity: 0.8 },
});
