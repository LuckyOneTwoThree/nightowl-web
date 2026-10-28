import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import {
  ChevronRight,
  MoonStar,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react-native';

import { getFixtures, leagueName, storylines, teamColor, teamName } from '@data/index.js';
import {
  computeReplayPicks,
  computeTonight,
  groupTonight,
  heroTier,
  stateOf,
} from '@core/owl.js';
import { countdown as engineCountdown, sleepTier, ts } from '@core/engine.js';
import {
  bjClock,
  bjDate,
  hm,
  humanCountdownShort,
  liveMinute,
  weekdayOf,
} from '@core/format.js';
import { narrativeOf } from '@core/narrative.js';
import { syncNow } from '@/data/sync/run';
import { useSyncState } from '@/data/sync/useSync';
import { freshnessOf } from '@/data/fixtures';
import { impactFeedback } from '@/lib/feedback';
import { animateLayout } from '@/lib/layoutAnimation';
import { useNow } from '@/lib/useNow';
import { useAppStore, useDataRev } from '@/state/app';
import { usePrefs } from '@/state/prefs';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { MatchRow } from '@/ui/MatchRow';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { SleepBadge } from '@/ui/SleepBadge';
import { colors, fontSize, radius, spacing, withAlpha } from '@/ui/theme';
import type { Entry, Match, Narrative, Tier } from '@/types';

type ReplayPick = Entry & { reason: string };

export default function TonightScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const rev = useDataRev();
  const source = useAppStore(state => state.source);
  const now = useNow(30_000);
  const { syncing, syncError } = useSyncState();
  const [showFinished, setShowFinished] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const tonight = useMemo(
    () => computeTonight(now, prefs),
    [now, prefs, rev]
  ) as {
    night: string;
    slice: Match[];
    hero: Entry | null;
    extras: Entry[];
    focal: Entry | null;
    minefieldIds: Set<string>;
  };

  const hero = tonight.hero;
  const listSlice = useMemo(
    () => (hero ? tonight.slice.filter(match => match.id !== hero.m.id) : tonight.slice),
    [tonight.slice, hero]
  );
  const groups = useMemo(() => groupTonight(listSlice, now), [listSlice, now]) as {
    live: Match[];
    upcoming: Match[];
    finished: Match[];
  };
  const liveCount = groups.live.length + (hero && stateOf(hero.m, now) === 'live' ? 1 : 0);

  const replay = useMemo(
    () => computeReplayPicks(now, prefs, 3) as ReplayPick[],
    [now, prefs, rev]
  );

  const heroNarrative = useMemo(
    () => (hero ? (narrativeOf(hero.m, hero.ev, storylines) as Narrative) : null),
    [hero]
  );
  const freshness = useMemo(
    () => freshnessOf(getFixtures(), now, source),
    [now, source, rev]
  );

  const refresh = useCallback(async () => {
    try {
      await syncNow();
    } catch {
      // 同步失败时保留本地数据，错误由 syncError 展示
    }
  }, []);

  const pullRefresh = useCallback(() => {
    setChecking(true);
    setRefreshNote(null);
    void syncNow({ quick: true })
      .then(outcome => {
        if (outcome.busy) {
          setRefreshNote('后台同步中，稍后再试');
          return;
        }
        if (outcome.status === 'failed') {
          setRefreshNote('比分同步失败，沿用本地数据');
        } else if (outcome.status === 'partial_failure') {
          setRefreshNote(`已更新 ${outcome.changed} 场，部分来源失败`);
        } else if (outcome.status === 'updated') {
          setRefreshNote(`已更新 ${outcome.changed} 场比分`);
        } else if (outcome.status === 'not_needed') {
          setRefreshNote('暂无可检查的比分');
        } else {
          setRefreshNote('暂无比分更新');
        }
      })
      .catch(() => {
        setRefreshNote(null);
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!refreshNote) return undefined;
    const timer = setTimeout(() => setRefreshNote(null), 2400);
    return () => clearTimeout(timer);
  }, [refreshNote]);

  const openMatch = useCallback(
    (id: string) => router.push({ pathname: '/match/[id]', params: { id } }),
    [router]
  );

  const openHero = useCallback(() => {
    if (!hero) return;
    router.push({
      pathname: '/match/[id]',
      params: {
        id: hero.m.id,
        ...(stateOf(hero.m, now) === 'live' ? { watch: '1' } : {}),
      },
    });
  }, [hero, now, router]);

  const todayLabel = `${bjDate(now)} ${weekdayOf(bjDate(now))}`;

  return (
    <Screen scroll onRefresh={pullRefresh}>
      <View style={styles.header}>
        <View style={styles.brandBlock}>
          <Image
            source={require('../../../assets/brand/logo.png')}
            style={styles.brandLogo}
            contentFit="cover"
            accessibilityLabel="夜猫看台"
          />
          <View style={styles.headerText}>
            <Text style={styles.brand}>夜猫看台</Text>
            <Text style={styles.subline}>
              {todayLabel} · {bjClock(now, false)} 北京
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.push('/search')}
          style={styles.iconButton}
          accessibilityLabel="搜索球队或比赛"
        >
          <Search size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.contextRow}>
        {syncing || checking ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <View style={styles.contextDot} />
        )}
        <Text style={styles.contextText}>
          {syncing
            ? '正在更新比分…'
            : checking
              ? '正在检查比分…'
              : refreshNote ??
                `今晚 ${tonight.slice.length} 场${
                  liveCount > 0 ? ` · ${liveCount} 场进行中` : ''
                }${freshness.pendingCount > 0 ? ` · ${freshness.pendingCount} 场待录` : ''}`}
        </Text>
      </View>

      {syncError ? (
        <View style={styles.errorBanner}>
          <TriangleAlert size={14} color={colors.warn} />
          <Text style={styles.errorText} numberOfLines={2}>
            比分同步失败，沿用本地数据
          </Text>
          <Pressable onPress={refresh} hitSlop={8}>
            <Text style={styles.errorAction}>重试</Text>
          </Pressable>
        </View>
      ) : null}

      {hero ? (
        <HeroCard
          hero={hero}
          narrative={heroNarrative}
          now={now}
          level={heroTier(hero.index) as 'highlight' | 'standard' | 'weak'}
          onPress={openHero}
        />
      ) : tonight.focal ? (
        <FocalCard entry={tonight.focal} now={now} onPress={() => openMatch(tonight.focal!.m.id)} />
      ) : (
        <Card style={styles.emptyHero}>
          <Text style={styles.emptyTitle}>今晚没有比赛</Text>
          <Text style={styles.emptyText}>下一场焦点战会在赛程中出现。</Text>
          <Button
            label="查看赛程"
            variant="secondary"
            onPress={() => router.push('/schedule')}
            style={styles.emptyAction}
          />
        </Card>
      )}

      {prefs.followedTeams.length === 0 ? (
        <Pressable
          onPress={() => router.push('/team-picker')}
          style={({ pressed }) => [styles.prompt, pressed && styles.pressed]}
        >
          <View style={styles.promptIcon}>
            <Sparkles size={16} color={colors.accent} />
          </View>
          <View style={styles.promptText}>
            <Text style={styles.promptTitle}>关注球队，推荐会更准</Text>
            <Text style={styles.promptSub}>今晚之选会优先你关注的球队</Text>
          </View>
          <ChevronRight size={16} color={colors.textFaint} />
        </Pressable>
      ) : null}

      {groups.live.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="进行中" count={groups.live.length} live />
          <View style={styles.list}>
            {groups.live.map(match => (
              <MatchRow
                key={match.id}
                match={match}
                now={now}
                prefs={prefs}
                minefield={tonight.minefieldIds.has(match.id)}
                onPress={() => openMatch(match.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader
          title="未开赛"
          count={groups.upcoming.length}
          actionLabel={groups.upcoming.length > 8 ? '全部赛程' : undefined}
          onAction={groups.upcoming.length > 8 ? () => router.push('/schedule') : undefined}
        />
        {groups.upcoming.length > 0 ? (
          <View style={styles.list}>
            {groups.upcoming.slice(0, 8).map(match => (
              <MatchRow
                key={match.id}
                match={match}
                now={now}
                prefs={prefs}
                minefield={tonight.minefieldIds.has(match.id)}
                onPress={() => openMatch(match.id)}
              />
            ))}
          </View>
        ) : (
          <Card style={styles.smallCard}>
            <Text style={styles.emptyText}>今晚没有未开赛场次。</Text>
          </Card>
        )}
      </View>

      {groups.finished.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            title="已结束"
            count={groups.finished.length}
            actionLabel={showFinished ? '收起' : '展开'}
            onAction={() => {
              animateLayout();
              setShowFinished(value => !value);
            }}
          />
          {showFinished ? (
            <View style={styles.list}>
              {groups.finished.map(match => (
                <MatchRow
                  key={match.id}
                  match={match}
                  now={now}
                  prefs={prefs}
                  onPress={() => openMatch(match.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {replay.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="最近值得补看" count={replay.length} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.replayRow}
          >
            {replay.map(pick => (
              <Pressable
                key={pick.m.id}
                onPress={() => openMatch(pick.m.id)}
                style={({ pressed }) => [styles.replayCard, pressed && styles.pressed]}
              >
                <View style={styles.replayTop}>
                  <Chip tone="default">{pick.reason}</Chip>
                  <Text style={styles.replayIndex}>{pick.index.toFixed(1)}</Text>
                </View>
                <View style={styles.replayTeams}>
                  <View style={styles.replayTeam}>
                    <Crest id={pick.m.h} size={22} />
                    <Text style={styles.replayTeamName} numberOfLines={1}>
                      {teamName(pick.m.h)}
                    </Text>
                  </View>
                  <View style={styles.replayTeam}>
                    <Crest id={pick.m.a} size={22} />
                    <Text style={styles.replayTeamName} numberOfLines={1}>
                      {teamName(pick.m.a)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.replayMeta}>
                  {leagueName(pick.m.l)} · {pick.m.t.slice(5, 10).replace('-', '/')} {hm(pick.m.t)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          数据来源：{freshness.source === 'stored' ? '本地同步数据' : '内置快照'}
          {freshness.lastScoreAt
            ? ` · 最近比分 ${bjDate(Date.parse(freshness.lastScoreAt))}`
            : ''}
        </Text>
        <Text style={styles.footerText}>
          {freshness.pendingCount > 0
            ? `${freshness.pendingCount} 场已开球但比分待录`
            : '比分已保持新鲜'}
        </Text>
      </View>
    </Screen>
  );
}

function HeroCard({
  hero,
  narrative,
  now,
  level,
  onPress,
}: {
  hero: Entry;
  narrative: Narrative | null;
  now: number;
  level: 'highlight' | 'standard' | 'weak';
  onPress: () => void;
}) {
  const tier = sleepTier(hero.m.t) as Tier;
  const countdown = engineCountdown(ts(hero.m.t), now);
  const isLive = stateOf(hero.m, now) === 'live';
  const weak = level === 'weak';
  const isHighlight = level === 'highlight';
  const energyFill = Math.max(1, Math.min(5, Math.ceil(hero.index / 6)));

  return (
    <Pressable
      onPress={() => {
        impactFeedback();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`今晚之选，${teamName(hero.m.h)} 对 ${teamName(hero.m.a)}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <LinearGradient
        colors={
          weak
            ? [withAlpha(teamColor(hero.m.h), 0.12), colors.card, colors.card]
            : [
                withAlpha(teamColor(hero.m.h), isHighlight ? 0.25 : 0.2),
                colors.card,
                withAlpha(teamColor(hero.m.a), isHighlight ? 0.2 : 0.14),
              ]
        }
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.hero,
          isHighlight && styles.heroHighlight,
          weak && styles.heroWeak,
        ]}
      >
        <View style={styles.heroTop}>
          <View style={styles.heroTopLeft}>
            <View style={styles.eyebrowRow}>
              {isHighlight ? <Sparkles size={11} color={colors.accent} /> : null}
              <Text
                style={[
                  styles.heroEyebrow,
                  isHighlight && styles.heroEyebrowHighlight,
                ]}
              >
                {isHighlight
                  ? '今晚之选 · 焦点夜'
                  : weak
                    ? '今夜平淡 · 若熬夜看这一场'
                    : '今晚之选'}
              </Text>
            </View>
            <Text style={styles.heroLeague}>
              {leagueName(hero.m.l)}
              {hero.m.r ? ` · 第 ${hero.m.r} 轮` : ''}
            </Text>
          </View>
          <SleepBadge tier={tier} size="md" showZh />
        </View>

        <View style={styles.teams}>
          <View style={styles.team}>
            <Crest id={hero.m.h} size={62} />
            <Text style={styles.teamName} numberOfLines={1}>
              {teamName(hero.m.h)}
            </Text>
          </View>
          <View style={styles.center}>
            {isLive ? (
              <>
                <View style={styles.heroLivePill}>
                  <View style={styles.heroLiveDot} />
                  <Text style={styles.heroLiveLabel}>LIVE</Text>
                </View>
                <Text style={styles.heroLiveMinute}>{liveMinute(ts(hero.m.t), now)}'</Text>
              </>
            ) : (
              <>
                <Text style={styles.vs}>VS</Text>
                <Text style={styles.time}>{hm(hero.m.t)}</Text>
                <Text style={styles.countdown}>{humanCountdownShort(countdown)}</Text>
              </>
            )}
          </View>
          <View style={styles.team}>
            <Crest id={hero.m.a} size={62} />
            <Text style={styles.teamName} numberOfLines={1}>
              {teamName(hero.m.a)}
            </Text>
          </View>
        </View>

        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>夜猫指数</Text>
            <View style={styles.metricIndexRow}>
              <Text style={styles.metricAccent}>{hero.index.toFixed(1)}</Text>
              <View style={styles.energyBarRow}>
                {[1, 2, 3, 4, 5].map(step => (
                  <View
                    key={step}
                    style={[
                      styles.energyTick,
                      step <= energyFill ? styles.energyTickOn : styles.energyTickOff,
                    ]}
                  />
                ))}
              </View>
            </View>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>看点</Text>
            <Text style={styles.metricValue}>{hero.ev.star} 星</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>开球</Text>
            <Text style={styles.metricValue}>{hm(hero.m.t)}</Text>
          </View>
        </View>

        {narrative ? (
          <View style={styles.narrative}>
            <Text style={styles.headline} numberOfLines={2}>
              {narrative.headline}
            </Text>
            {narrative.lines.slice(0, 1).map(line => (
              <Text key={line} style={styles.line} numberOfLines={1}>
                · {line}
              </Text>
            ))}
          </View>
        ) : null}

        {weak ? (
          <View style={styles.weakNotice}>
            <MoonStar size={13} color={colors.textMuted} />
            <Text style={styles.weakText}>指数偏低，今晚可以量力而行</Text>
          </View>
        ) : null}

        <View style={[styles.cta, weak && !isLive && styles.ctaSecondary]}>
          <Text style={[styles.ctaText, weak && !isLive && styles.ctaTextSecondary]}>
            {isLive ? '看直播' : weak ? '查看详情' : '查看比赛'}
          </Text>
          <ChevronRight
            size={16}
            color={weak && !isLive ? colors.textSecondary : colors.accentInk}
          />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function FocalCard({
  entry,
  now,
  onPress,
}: {
  entry: Entry;
  now: number;
  onPress: () => void;
}) {
  const countdown = engineCountdown(ts(entry.m.t), now);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.focal}>
        <Text style={styles.heroLeague}>下一场焦点战</Text>
        <Text style={styles.focalTitle}>
          {teamName(entry.m.h)} vs {teamName(entry.m.a)}
        </Text>
        <Text style={styles.focalMeta}>
          {leagueName(entry.m.l)} · {hm(entry.m.t)} · {humanCountdownShort(countdown)}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  brandBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandLogo: { width: 36, height: 36, borderRadius: radius.lg },
  headerText: { gap: 2 },
  brand: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800', letterSpacing: 0.6 },
  subline: { color: colors.textFaint, fontSize: fontSize.xs, letterSpacing: 0.3 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  contextDot: { width: 5, height: 5, borderRadius: radius.full, backgroundColor: colors.accent },
  contextText: { color: colors.textMuted, fontSize: fontSize.sm },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(224,168,46,0.35)',
    backgroundColor: 'rgba(224,168,46,0.08)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.xs },
  errorAction: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  hero: {
    borderRadius: radius.xxxl,
    borderWidth: 1,
    borderColor: withAlpha(colors.text, 0.08),
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  heroHighlight: {
    borderColor: withAlpha(colors.accent, 0.35),
  },
  heroWeak: {
    borderColor: colors.hairline,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heroTopLeft: { gap: 3 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroEyebrow: {
    color: colors.textFaint,
    fontSize: fontSize.xxs,
    fontWeight: '700',
    letterSpacing: 1,
  },
  heroEyebrowHighlight: {
    color: colors.accent,
  },
  heroLeague: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tierPill: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: colors.panel,
  },
  tierText: { fontSize: fontSize.xs, fontWeight: '700' },
  teams: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  team: { flex: 1, alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  teamName: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: '700',
    maxWidth: 112,
    textAlign: 'center',
  },
  center: { width: 96, alignItems: 'center', gap: 1 },
  vs: { color: colors.textFaint, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 1.4 },
  time: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  heroLivePill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroLiveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.live },
  heroLiveLabel: { color: colors.live, fontSize: fontSize.xs, fontWeight: '700' },
  heroLiveMinute: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  countdown: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: withAlpha(colors.text, 0.07),
    paddingTop: spacing.md,
  },
  metric: { flex: 1, gap: 3 },
  metricLabel: { color: colors.textFaint, fontSize: fontSize.xxs, letterSpacing: 0.4 },
  metricIndexRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricAccent: {
    color: colors.accent,
    fontSize: fontSize.base,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  energyBarRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  energyTick: { width: 3, height: 10, borderRadius: 1.5 },
  energyTickOn: { backgroundColor: colors.accent },
  energyTickOff: { backgroundColor: withAlpha(colors.text, 0.14) },
  metricValue: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: withAlpha(colors.text, 0.1) },
  narrative: {
    borderTopWidth: 1,
    borderTopColor: withAlpha(colors.text, 0.07),
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  headline: { color: colors.text, fontSize: fontSize.base, fontWeight: '600', lineHeight: 21 },
  line: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  weakNotice: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  weakText: { color: colors.textMuted, fontSize: fontSize.xs },
  cta: {
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  ctaSecondary: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.control,
  },
  ctaText: { color: colors.accentInk, fontSize: fontSize.md, fontWeight: '800' },
  ctaTextSecondary: { color: colors.textSecondary, fontWeight: '700' },
  focal: { gap: spacing.xs },
  focalTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700' },
  focalMeta: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    fontVariant: ['tabular-nums'],
  },
  emptyHero: { gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
  emptyAction: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    padding: spacing.md,
  },
  promptIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
  },
  promptText: { flex: 1, gap: 2 },
  promptTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  promptSub: { color: colors.textFaint, fontSize: fontSize.xs },
  section: { gap: spacing.sm },
  list: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  smallCard: { paddingVertical: spacing.md },
  replayRow: { gap: spacing.md, paddingRight: spacing.lg },
  replayCard: {
    width: 232,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  replayTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  replayIndex: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  replayTeams: { gap: 5 },
  replayTeam: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  replayTeamName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', flex: 1 },
  replayMeta: { color: colors.textFaint, fontSize: fontSize.xs },
  footer: { gap: 3, paddingTop: spacing.sm },
  footerText: { color: colors.textFaint, fontSize: fontSize.xs, textAlign: 'center' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
});
