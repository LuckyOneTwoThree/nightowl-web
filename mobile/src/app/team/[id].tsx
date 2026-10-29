import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';

import { TEAM_MAP, getFixtures, leagueName, teamName } from '@data/index.js';
import { computeSeasonStats, computeTeamForm } from '@core/stats.js';
import { unrevealedTonightIds } from '@core/reveal.js';
import { evalOne } from '@core/owl.js';
import { ts } from '@core/engine.js';
import { hm, zhDate } from '@core/format.js';

import { useNow } from '@/lib/useNow';
import { useAppStore, useDataRev } from '@/state/app';
import { usePrefs, usePrefsStore } from '@/state/prefs';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { FormDots } from '@/ui/FormDots';
import { MatchRow } from '@/ui/MatchRow';
import { SectionHeader } from '@/ui/SectionHeader';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { Match } from '@/types';

type TeamInfo = {
  id: string;
  zh: string;
  en: string;
  league: string;
  color: string;
  tag?: string;
};

type FormItem = {
  result: 'W' | 'D' | 'L';
  opponent: string;
  score: string;
  date: string;
};

export default function TeamScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const team = (id ? (TEAM_MAP as Record<string, TeamInfo>)[id] : null) || null;
  const prefs = usePrefs();
  const rev = useDataRev();
  const now = useNow(60_000);
  const revealedIds = useAppStore(state => state.revealedIds);
  const toggleTeam = usePrefsStore(state => state.toggleTeam);

  const fixtures = useMemo(() => getFixtures() as Match[], [rev]);
  const matches = useMemo(
    () =>
      fixtures
        .filter(match => match.h === id || match.a === id)
        .sort((a, b) => ts(a.t) - ts(b.t)),
    [fixtures, id]
  );
  const upcoming = useMemo(
    () =>
      matches
        .filter(match => match.st === 'sched' && !match.tbd && ts(match.t) > now)
        .slice(0, 5),
    [matches, now]
  );
  const recent = useMemo(
    () =>
      matches
        .filter(match => match.st === 'done' && match.sc)
        .slice(-5)
        .reverse(),
    [matches]
  );
  const next = upcoming[0] || null;
  const nextIntel = next ? (evalOne(next, prefs) as { index: number }) : null;
  const spoilerExcludedIds = useMemo(() => {
    const ids = unrevealedTonightIds(fixtures, now, prefs.spoilerFree, revealedIds);
    return ids.size ? ids : null;
  }, [fixtures, now, prefs.spoilerFree, revealedIds]);
  const form = useMemo(
    () => (team ? (computeTeamForm(id, null as unknown as object, fixtures, 5, { excludeIds: spoilerExcludedIds }) as FormItem[]) : []),
    [id, team, fixtures, spoilerExcludedIds]
  );
  const season = useMemo(
    () =>
      team
        ? (computeSeasonStats(id, team.league, fixtures, Infinity, { excludeIds: spoilerExcludedIds }) as {
            played: number;
            wins: number;
            draws: number;
            losses: number;
            goalsFor: number;
            goalsAgainst: number;
            winRate: number;
          })
        : null,
    [id, team, fixtures, spoilerExcludedIds]
  );
  const formSummary = form.reduce(
    (acc, item) => {
      if (item.result === 'W') acc.wins += 1;
      else if (item.result === 'L') acc.losses += 1;
      else acc.draws += 1;
      return acc;
    },
    { wins: 0, draws: 0, losses: 0 }
  );
  const followed = !!id && prefs.followedTeams.includes(id);

  const openMatch = (matchId: string) =>
    router.push({ pathname: '/match/[id]', params: { id: matchId } });

  if (!team || !id) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={4} accessibilityLabel="返回">
            <ChevronLeft size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>球队</Text>
          <View style={styles.back} />
        </View>
        <View style={styles.emptyRoot}>
          <Text style={styles.emptyTitle}>没有找到这支球队</Text>
          <Pressable onPress={() => router.back()} style={styles.emptyButton}>
            <Text style={styles.emptyButtonText}>返回</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={4} accessibilityLabel="返回">
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>球队</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Crest id={id} size={64} />
          <View style={styles.heroText}>
            <Text style={styles.name}>{teamName(id)}</Text>
            <Text style={styles.en}>{team.en}</Text>
            <View style={styles.tags}>
              <Chip>{leagueName(team.league)}</Chip>
              {team.tag ? <Chip tone="default">{team.tag}</Chip> : null}
            </View>
          </View>
          <Pressable
            onPress={() => toggleTeam(id)}
            style={[styles.follow, followed && styles.followActive]}
            hitSlop={5}
            accessibilityRole="button"
            accessibilityState={{ selected: followed }}
          >
            {followed ? (
              <Check size={14} color={colors.accent} />
            ) : (
              <Plus size={14} color={colors.textSecondary} />
            )}
            <Text style={[styles.followText, followed && { color: colors.accent }]}>
              {followed ? '已关注' : '关注'}
            </Text>
          </Pressable>
        </View>

        {next ? (
          <Pressable
            onPress={() => openMatch(next.id)}
            accessibilityRole="button"
            accessibilityLabel={`下一场，${teamName(next.h)} 对 ${teamName(next.a)}`}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Card tone="panel" style={styles.nextCard}>
              <View style={styles.nextTop}>
                <Text style={styles.eyebrow}>下一场</Text>
                {nextIntel ? (
                  <Chip tone="accent">{nextIntel.index.toFixed(1)}</Chip>
                ) : null}
              </View>
              <View style={styles.nextRow}>
                <Crest id={next.h} size={36} />
                <Crest id={next.a} size={36} />
                <View style={styles.nextText}>
                  <Text style={styles.nextTeams} numberOfLines={1}>
                    {teamName(next.h)} vs {teamName(next.a)}
                  </Text>
                  <Text style={styles.nextMeta}>
                    {leagueName(next.l)} · {zhDate(next.t.slice(0, 10))} {hm(next.t)}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.textFaint} />
              </View>
            </Card>
          </Pressable>
        ) : (
          <Card tone="panel">
            <Text style={styles.muted}>暂无后续赛程。</Text>
          </Card>
        )}

        <Card style={styles.card}>
          <Text style={styles.eyebrow}>近 5 场</Text>
          {form.length > 0 ? (
            <>
              <View style={styles.formDots}>
                <FormDots form={form} />
              </View>
              <Text style={styles.formSummary}>
                {formSummary.wins}胜 {formSummary.draws}平 {formSummary.losses}负
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>暂无已完赛记录。</Text>
          )}
          {spoilerExcludedIds ? (
            <Text style={styles.muted}>
              已排除今晚未揭晓 {spoilerExcludedIds.size} 场，避免从近况倒推比分。
            </Text>
          ) : null}
        </Card>

        {season ? (
          <Card style={styles.card}>
            <Text style={styles.eyebrow}>赛季攻防 · {leagueName(team.league)}</Text>
            <View style={styles.statGrid}>
              <Stat label="场次" value={String(season.played)} />
              <Stat label="胜-平-负" value={`${season.wins}-${season.draws}-${season.losses}`} />
              <Stat label="进 / 失" value={`${season.goalsFor}/${season.goalsAgainst}`} />
              <Stat label="胜率" value={`${season.winRate}%`} accent />
            </View>
          </Card>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="后续赛程" count={upcoming.length} />
          {upcoming.length > 0 ? (
            <View style={styles.list}>
              {upcoming.map(match => (
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
            <Text style={styles.muted}>暂无后续赛程。</Text>
          )}
        </View>

        {recent.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="最近结果" count={recent.length} />
            <View style={styles.list}>
              {recent.map(match => (
                <MatchRow
                  key={match.id}
                  match={match}
                  now={now}
                  prefs={prefs}
                  onPress={() => openMatch(match.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && { color: colors.accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.lg,
  },
  heroText: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  en: { color: colors.textFaint, fontSize: fontSize.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  follow: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.panel,
  },
  followActive: { borderColor: colors.accent, backgroundColor: colors.goldSoft },
  followText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  nextCard: { gap: spacing.sm },
  nextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nextText: { flex: 1, gap: 2 },
  nextTeams: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  nextMeta: { color: colors.textFaint, fontSize: fontSize.xs },
  eyebrow: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  card: { gap: spacing.sm },
  formDots: { paddingTop: spacing.xs },
  formSummary: { color: colors.textMuted, fontSize: fontSize.xs },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.xs },
  stat: {
    width: '48%',
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    padding: spacing.md,
    gap: 2,
  },
  statValue: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statLabel: { color: colors.textFaint, fontSize: fontSize.xs },
  section: { gap: spacing.sm },
  list: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  pressed: { opacity: 0.8 },
  emptyRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  emptyButton: {
    height: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyButtonText: { color: colors.accentInk, fontSize: fontSize.md, fontWeight: '700' },
});
