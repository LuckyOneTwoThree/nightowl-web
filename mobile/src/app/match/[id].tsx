import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Bookmark,
  Share2,
  Sparkles,
} from 'lucide-react-native';

import {
  getFixtures,
  leagueColor,
  leagueName,
  storylines,
  teamColor,
  teamName,
} from '@data/index.js';
import { evalOne, sameNightPicks, stateOf, upcomingForTeams } from '@core/owl.js';
import {
  countdown as engineCountdown,
  followedBonus,
  leagueBonus,
  PRODUCT_WEIGHTS,
  sleepTier,
  storyBonus,
  ts,
} from '@core/engine.js';
import { bjClock, bjDate, hm, humanCountdownShort, liveMinute as minuteOf, zhDate } from '@core/format.js';
import { eventKey, eventSummary, shouldNotifyEvent } from '@core/live-events.js';
import { narrativeOf } from '@core/narrative.js';
import { computeMatchStandings } from '@core/standings.js';
import { computeMatchStats } from '@core/stats.js';
import { unrevealedTonightIds } from '@core/reveal.js';

import { animateLayout } from '@/lib/layoutAnimation';
import { hasScheduledMatchReminder, scheduleMatchReminder } from '@/lib/reminders';
import { useLiveMatch, type LiveData } from '@/data/useLiveMatch';
import { useNow } from '@/lib/useNow';
import { useStopLossPrompt } from '@/lib/useStopLoss';
import { useAppStore, useDataRev } from '@/state/app';
import { useWatchLaterStore } from '@/state/queue';
import { pendingQueue } from '@core/queue.js';
import { usePrefs } from '@/state/prefs';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { LiveTimeline } from '@/components/LiveTimeline';
import { WatchSheet } from '@/components/WatchSheet';
import { StopLossBanner } from '@/components/StopLossBanner';
import { EmptyState } from '@/ui/EmptyState';
import { FormDots } from '@/ui/FormDots';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { SleepBadge } from '@/ui/SleepBadge';
import { SleepNote } from '@/ui/SleepNote';
import { colors, fontSize, radius, spacing, tierColor, withAlpha } from '@/ui/theme';
import type { Entry, Ev, Match, MatchStandings, Narrative, Tier } from '@/types';

type Tab = 'intel' | 'stats';

type FormItem = {
  result: 'W' | 'D' | 'L';
  opponent: string;
  score: string;
  date: string;
  isHome: boolean;
};

type Season = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  winRate: number;
};

type StatsData = {
  home: { id: string; form: FormItem[]; season: Season };
  away: { id: string; form: FormItem[]; season: Season };
  h2h: {
    meetings: Array<{ id: string; date: string; home: string; away: string; score: string }>;
    summary: { t1Wins: number; draws: number; t2Wins: number; total: number };
  };
};

export default function MatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; watch?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const prefs = usePrefs();
  const rev = useDataRev();
  const watchLaterItems = useWatchLaterStore(state => state.items);
  const addWatchLater = useWatchLaterStore(state => state.add);
  const now = useNow(30_000);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('intel');
  const revealedInStore = useAppStore(s => (id ? !!s.revealedIds[id] : false));
  const revealedIds = useAppStore(s => s.revealedIds);
  const revealMatch = useAppStore(s => s.revealMatch);
  const hideMatch = useAppStore(s => s.hideMatch);
  const [forceHidden, setForceHidden] = useState(false);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  const scoreVisible = prefs.spoilerFree ? revealedInStore : !forceHidden;
  const queuedForMorning = pendingQueue(watchLaterItems).some(item => item.id === id);
  const handleRevealScore = () => {
    setForceHidden(false);
    if (id) revealMatch(id);
  };
  const handleHideScore = () => {
    if (prefs.spoilerFree) {
      if (id) hideMatch(id);
    } else {
      setForceHidden(true);
    }
  };
  const [watchOpen, setWatchOpen] = useState(params.watch === '1');
  const [reminderSet, setReminderSet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  // 以系统已排程通知为事实来源，而不是页面 state。
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    const sync = () => {
      void hasScheduledMatchReminder(id).then(value => {
        if (alive) setReminderSet(value);
      });
    };
    sync();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [id, rev]);

  const match = useMemo(
    () => getFixtures().find((item: Match) => item.id === id) as Match | undefined,
    [id, rev]
  );
  const stopLoss = useStopLossPrompt(match ?? null, prefs, now, focused);

  const spoilerExcludedIds = useMemo(
    () => unrevealedTonightIds(getFixtures(), now, prefs.spoilerFree, revealedIds),
    [now, prefs.spoilerFree, revealedIds, rev]
  );

  const intel = useMemo(() => {
    if (!match) return null;
    const { ev, index } = evalOne(match, prefs) as { ev: Ev; index: number };
    return {
      ev,
      index,
      tier: sleepTier(match.t) as Tier,
      narrative: narrativeOf(match, ev, storylines) as Narrative,
      stats: computeMatchStats(match, null, { excludeIds: spoilerExcludedIds }) as StatsData,
      standings: computeMatchStandings(match, getFixtures(), { nowTs: now, excludeIds: spoilerExcludedIds }) as MatchStandings,
      upcoming: upcomingForTeams(match, undefined, 4, now) as { home: Match[]; away: Match[] },
      sameNight: sameNightPicks(match, prefs, 3, now) as Entry[],
    };
  }, [match, prefs, now, rev, spoilerExcludedIds]);

  const state = match ? (stateOf(match, now) as string) : 'sched';
  const isDone = match
    ? state === 'finished' || state === 'ended_pending' || match.st === 'done'
    : false;
  const isLive = state === 'live';
  const live = useLiveMatch(match ?? null, !!match && (isLive || isDone), isLive ? 30_000 : 0);
  const liveEvents = live.data?.events;
  const prevLiveEvents = useRef(new Set<string>());
  const liveInitFor = useRef<string | null>(null);

  // 切场先作废上一场的事件基线：否则新比赛首个快照里的历史事件会被当成“新事件”提示。
  useEffect(() => {
    liveInitFor.current = null;
    prevLiveEvents.current = new Set();
  }, [match?.id]);

  useEffect(() => {
    if (!match || !liveEvents?.length) return;
    if (liveInitFor.current !== match.id) {
      liveInitFor.current = match.id;
      prevLiveEvents.current = new Set(liveEvents.map(eventKey));
      return;
    }
    const next = new Set(prevLiveEvents.current);
    for (const event of liveEvents) {
      const key = eventKey(event);
      if (next.has(key)) continue;
      // 基线无条件记录：静默期到达的事件不因之后「揭晓」而补发（与桌面口径一致）
      next.add(key);
      // 防剧透：比分未揭晓时进球/红牌事件 toast 等于直接剧透
      if (prefs.notifyLiveEvents && scoreVisible && shouldNotifyEvent(event)) {
        setToast(eventSummary(event, match));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
    prevLiveEvents.current = next;
  }, [liveEvents, match, prefs.notifyLiveEvents, scoreVisible]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!match || !intel) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={4} accessibilityLabel="返回">
            <ChevronLeft size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>比赛详情</Text>
          <View style={styles.headerButton} />
        </View>
        <EmptyState
          title="没有找到这场比赛"
          description={`比赛 ID：${id || '（空）'}`}
          actionLabel="返回"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  const liveData = live.data;
  const liveFinished = liveData?.state === 'finished';
  const finishedNow = isDone || liveFinished;
  const liveNow = isLive && !finishedNow;
  const liveScoreText =
    liveData?.score && liveData.score.h != null && liveData.score.a != null
      ? `${liveData.score.h}-${liveData.score.a}`
      : null;
  const liveMinuteText = liveData?.minuteLabel || `${minuteOf(ts(match.t), now)}'`;
  const finalScore = liveScoreText || match.sc || null;
  const countdown = engineCountdown(ts(match.t), now);
  const tier = intel.tier;
  const color = tierColor(tier.tier);

  const share = () => {
    void Share.share({
      message: `${teamName(match.h)} vs ${teamName(match.a)} · ${hm(match.t)} · ${leagueName(
        match.l
      )} · 夜猫指数 ${intel.index.toFixed(1)}`,
    });
  };

  // 只有系统里真的存在该场的提醒，才显示「提醒已开启」。
  // autoReminded 只代表偏好意图，不代表权限与排程成功，不能当事实来源。
  const reminded = reminderSet;

  const handleReminder = async () => {
    const ok = await scheduleMatchReminder(match);
    if (ok) {
      setReminderSet(true);
      setToast('已设置赛前提醒');
    } else {
      setToast('未设置成功：安装版或赛前 15 分钟内可用');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} hitSlop={4} accessibilityLabel="返回">
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Animated.Text
            style={[
              styles.headerTitle,
              {
                opacity: scrollY.interpolate({
                  inputRange: [0, 72],
                  outputRange: [1, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            比赛详情
          </Animated.Text>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.headerTitleCompact,
              {
                opacity: scrollY.interpolate({
                  inputRange: [96, 164],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            {finishedNow && scoreVisible && finalScore
              ? `${teamName(match.h)} ${finalScore} ${teamName(match.a)}`
              : liveNow && liveScoreText && scoreVisible
                ? `${teamName(match.h)} ${liveScoreText} ${teamName(match.a)}`
                : `${teamName(match.h)} vs ${teamName(match.a)}`}
          </Animated.Text>
        </View>
        <Pressable onPress={share} style={styles.headerButton} hitSlop={4} accessibilityLabel="分享比赛">
          <Share2 size={18} color={colors.text} />
        </Pressable>
      </View>

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: liveNow ? 104 : insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        <LinearGradient
          colors={[
            withAlpha(teamColor(match.h), 0.22),
            colors.card,
            withAlpha(teamColor(match.a), 0.18),
          ]}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={styles.leagueRow}>
              <View style={[styles.leagueDot, { backgroundColor: leagueColor(match.l) }]} />
              <Text style={styles.leagueText}>
                {leagueName(match.l)}
                {match.r ? ` · 第 ${match.r} 轮` : ''}
              </Text>
            </View>
            <SleepBadge tier={tier} size="md" showZh />
          </View>

          <View style={styles.teams}>
            <View style={styles.team}>
              <Crest id={match.h} size={56} />
              <Text style={styles.teamName} numberOfLines={1}>
                {teamName(match.h)}
              </Text>
            </View>
            <View style={styles.center}>
              {finishedNow && scoreVisible && finalScore ? (
                <Text style={styles.score}>{finalScore}</Text>
              ) : finishedNow && finalScore ? (
                <>
                  <Pressable onPress={handleRevealScore} style={styles.revealButton} hitSlop={10}>
                    <Eye size={13} color={colors.accent} />
                    <Text style={styles.revealText}>揭晓比分</Text>
                  </Pressable>
                </>
              ) : finishedNow ? (
                <Text style={styles.vs}>已结束</Text>
              ) : liveNow && liveScoreText && scoreVisible ? (
                <>
                  <Text style={styles.score}>{liveScoreText}</Text>
                  <View style={styles.liveRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveLabel}>
                      {liveData?.statusText || '进行中'} {liveMinuteText}
                    </Text>
                  </View>
                </>
              ) : liveNow && liveScoreText ? (
                <>
                  <Pressable onPress={handleRevealScore} style={styles.revealButton} hitSlop={10}>
                    <Eye size={13} color={colors.accent} />
                    <Text style={styles.revealText}>揭晓实时比分</Text>
                  </Pressable>
                  <View style={styles.liveRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveLabel}>
                      {liveData?.statusText || '进行中'} {liveMinuteText}
                    </Text>
                  </View>
                </>
              ) : liveNow ? (
                <>
                  <View style={styles.liveRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveLabel}>LIVE</Text>
                  </View>
                  <Text style={styles.liveMinute}>{liveMinuteText}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.vs}>VS</Text>
                  <Text style={styles.time}>{hm(match.t)}</Text>
                  <Text style={styles.countdown}>{humanCountdownShort(countdown)}</Text>
                </>
              )}
            </View>
            <View style={styles.team}>
              <Crest id={match.a} size={56} />
              <Text style={styles.teamName} numberOfLines={1}>
                {teamName(match.a)}
              </Text>
            </View>
          </View>

          <View style={[styles.stateStrip, liveNow && styles.stateStripLive]}>
            {liveNow ? (
              <View style={styles.stateLeft}>
                <View style={styles.liveDot} />
                <Text style={styles.stateLiveText}>
                  {liveData?.statusText || '正在直播'}
                  {liveData?.minuteLabel ? ` · ${liveData.minuteLabel}` : ''}
                </Text>
              </View>
            ) : finishedNow ? (
              <>
                <View style={styles.stateLeft}>
                  <CheckCircle2 size={14} color={colors.textMuted} />
                  <Text style={styles.stateText}>已结束</Text>
                </View>
                <Pressable onPress={() => setWatchOpen(true)} hitSlop={16}>
                  <Text style={styles.stateAction}>看集锦</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.stateLeft}>
                  <Bell size={14} color={colors.textMuted} />
                  <Text style={styles.stateText} numberOfLines={1}>
                    距开球 {humanCountdownShort(countdown)}
                  </Text>
                </View>
                <View style={styles.stateActions}>
                  <Pressable onPress={() => setWatchOpen(true)} hitSlop={16}>
                    <Text style={styles.stateSecondary}>观看入口</Text>
                  </Pressable>
                  {reminded ? (
                    <View style={styles.stateReminded}>
                      <CheckCircle2 size={14} color={colors.accent} />
                      <Text style={styles.stateRemindedText}>提醒已开启</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={handleReminder}
                      hitSlop={8}
                      style={styles.stateReminderChip}
                    >
                      <Bell size={13} color={colors.textSecondary} />
                      <Text style={styles.stateReminderText}>提醒</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>

          {liveNow && live.error ? (
            <Text style={styles.liveStale}>
              实时数据暂时不可用
              {live.lastSuccessAt ? ` · 最后更新 ${bjClock(live.lastSuccessAt, false)}` : ''}
            </Text>
          ) : null}

          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Sparkles size={14} color={colors.accent} />
              <Text style={styles.metricAccent}>夜猫指数 {intel.index.toFixed(1)}</Text>
            </View>
            <Text style={styles.metricMuted}>看点 {intel.ev.star} 星</Text>
          </View>

          <SleepNote match={match} prefs={prefs} style={styles.sleepNote} />

          <Pressable
            onPress={() => {
              if (!queuedForMorning) {
                const result = addWatchLater(match);
                setToast(
                  result.ok
                    ? '已加入明早补看'
                    : result.reason === 'full'
                      ? '补看队列已满，请先在「我的」移除旧条目'
                      : '加入补看失败'
                );
              }
            }}
            disabled={queuedForMorning}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={queuedForMorning ? '已加入明早补看' : '加入明早补看'}
            style={({ pressed }) => [
              styles.watchLaterButton,
              queuedForMorning && styles.watchLaterButtonOn,
              pressed && styles.pressed,
            ]}
          >
            <Bookmark size={14} color={queuedForMorning ? colors.accent : colors.textSecondary} />
            <Text style={[styles.watchLaterText, queuedForMorning && styles.watchLaterTextOn]}>
              {queuedForMorning ? '已加入明早补看' : '明早补看'}
            </Text>
          </Pressable>

          {finishedNow && scoreVisible && finalScore ? (
            <Pressable onPress={handleHideScore} style={styles.hideScore} hitSlop={14}>
              <EyeOff size={13} color={colors.textMuted} />
              <Text style={styles.hideScoreText}>重新隐藏比分</Text>
            </Pressable>
          ) : null}
        </LinearGradient>

        <View style={styles.segmentWrap}>
          <SegmentedControl
            value={tab}
            onChange={value => {
              animateLayout();
              setTab(value as Tab);
            }}
            options={[
              { key: 'intel', label: '情报' },
              { key: 'stats', label: '数据' },
            ]}
          />
        </View>

        {tab === 'intel' ? (
          <IntelTab
            match={match}
            intel={intel}
            live={liveData}
            isLive={liveNow}
            scoreVisible={scoreVisible}
            onReveal={handleRevealScore}
            onOpenMatch={matchId =>
              router.push({ pathname: '/match/[id]', params: { id: matchId } })
            }
          />
        ) : (
          <StatsTab
            match={match}
            stats={intel.stats}
            standings={intel.standings}
            onOpenMatch={matchId =>
              router.push({ pathname: '/match/[id]', params: { id: matchId } })
            }
            onOpenStandings={league =>
              router.push({
                pathname: '/standings/[league]',
                params: { league, matchId: match.id },
              })
            }
          />
        )}
      </Animated.ScrollView>

      {liveNow ? (
        <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <Button
            label="看直播"
            onPress={() => setWatchOpen(true)}
            style={styles.primaryAction}
          />
        </View>
      ) : null}

      {toast ? (
        <View
          pointerEvents="none"
          style={[styles.toast, { bottom: insets.bottom + (liveNow ? 92 : 24) }]}
        >
          <CheckCircle2 size={14} color={colors.accent} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <StopLossBanner
        context={stopLoss.context}
        notice={stopLoss.notice}
        onSleep={stopLoss.sleep}
        onSnooze={stopLoss.snooze}
        onIgnore={stopLoss.ignore}
      />

      <WatchSheet
        visible={watchOpen}
        onClose={() => setWatchOpen(false)}
        match={match}
        now={now}
        live={liveData}
        isDone={finishedNow}
        isLive={liveNow}
        revealed={scoreVisible}
        onReveal={handleRevealScore}
      />
    </SafeAreaView>
  );
}

function IntelTab({
  match,
  intel,
  live,
  isLive,
  scoreVisible,
  onReveal,
  onOpenMatch,
}: {
  match: Match;
  intel: {
    ev: Ev;
    index: number;
    tier: Tier;
    narrative: Narrative;
    upcoming: { home: Match[]; away: Match[] };
    sameNight: Entry[];
  };
  live: LiveData | null;
  isLive: boolean;
  scoreVisible: boolean;
  onReveal: () => void;
  onOpenMatch: (id: string) => void;
}) {
  const [showAttribution, setShowAttribution] = useState(false);
  const weights = PRODUCT_WEIGHTS;
  const starPart = intel.ev.star * 10;
  const storyPart = storyBonus(intel.ev, weights);
  const followPart = followedBonus(intel.ev, weights);
  const leaguePart = leagueBonus(intel.ev, weights);
  const denominator = 1 + intel.tier.cost + weights.watchCost;

  return (
    <View style={styles.tabGap}>
      {live && live.events.length > 0 ? (
        scoreVisible ? (
          <Card style={styles.cardGap}>
            <LiveTimeline match={match} events={live.events} live={isLive} />
          </Card>
        ) : (
          <Card style={styles.cardGap}>
            <Pressable onPress={onReveal} style={styles.revealButton}>
              <Eye size={13} color={colors.accent} />
              <Text style={styles.revealText}>
                {isLive ? '实时事件已隐藏 · 揭晓' : '比赛事件已隐藏 · 揭晓'}
              </Text>
            </Pressable>
          </Card>
        )
      ) : null}

      <Card style={styles.cardGap}>
        <View style={styles.cardHeader}>
          <View style={{ gap: 2 }}>
            <Text style={styles.cardEyebrow}>熬夜代价</Text>
            <Text style={styles.cardTitle}>
              {intel.tier.label} {intel.tier.zh} · {intel.tier.cost}h
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <SleepBadge tier={intel.tier} />
            <Chip tone="default">{hm(match.t)} 开球</Chip>
          </View>
        </View>
        <TierMeter tier={intel.tier} />
        <Text style={styles.cardLine}>睡眠成本按开球时间实时计算，不读取静态字段。</Text>
      </Card>

      <Card style={styles.cardGap}>
        <Text style={styles.cardEyebrow}>看点与故事线</Text>
        <Text style={styles.cardTitle} numberOfLines={3}>{intel.narrative.headline}</Text>
        {intel.narrative.lines.map(line => (
          <Text key={line} style={styles.cardLine}>
            · {line}
          </Text>
        ))}
        {intel.ev.bonuses.length > 0 ? (
          <View style={styles.chips}>
            {intel.ev.bonuses.map(bonus => (
              <Chip key={bonus} tone="default">
                {bonus}
              </Chip>
            ))}
          </View>
        ) : null}
      </Card>

      <Card style={styles.cardGap}>
        <Pressable
          onPress={() => {
            animateLayout();
            setShowAttribution(value => !value);
          }}
          style={styles.attributionHeader}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ expanded: showAttribution }}
        >
          <Text style={styles.cardEyebrow}>指数归因</Text>
          <View style={styles.attributionToggle}>
            <Text style={styles.attributionIndex}>{intel.index.toFixed(1)}</Text>
            {showAttribution ? (
              <ChevronUp size={16} color={colors.textMuted} />
            ) : (
              <ChevronDown size={16} color={colors.textMuted} />
            )}
          </View>
        </Pressable>
        {showAttribution ? (
          <>
            <AttributionRow
              label="看点星级"
              value={`+${starPart.toFixed(1)}`}
              ratio={starPart / 50}
              positive
            />
            <AttributionRow
              label="故事线加成"
              value={`+${storyPart.toFixed(1)}`}
              ratio={storyPart / 40}
              positive
            />
            <AttributionRow
              label="关注球队"
              value={`+${followPart.toFixed(1)}`}
              ratio={followPart / 45}
              positive
            />
            <AttributionRow
              label="关注联赛"
              value={`+${leaguePart.toFixed(1)}`}
              ratio={leaguePart / 20}
              positive
            />
            <AttributionRow
              label="睡眠成本"
              value={`${intel.tier.cost.toFixed(1)}h`}
              ratio={intel.tier.cost / 4.5}
              barColor={tierColor(intel.tier.tier)}
            />
            <View style={styles.formula}>
              <Text style={styles.formulaText}>
                指数 = (看点 + 故事线 + 关注 + 联赛) ÷ (1 + 睡眠成本 + 0.5)
              </Text>
              <Text style={styles.formulaResult}>
                分子 {(starPart + storyPart + followPart + leaguePart).toFixed(1)} ÷ 分母{' '}
                {denominator.toFixed(1)} = {intel.index.toFixed(1)}
              </Text>
            </View>
          </>
        ) : null}
      </Card>

      <Card style={styles.cardGap}>
        <Text style={styles.cardEyebrow}>双方后续赛程</Text>
        <UpcomingTeam
          label={teamName(match.h)}
          matches={intel.upcoming.home}
          onOpen={onOpenMatch}
        />
        <View style={styles.divider} />
        <UpcomingTeam
          label={teamName(match.a)}
          matches={intel.upcoming.away}
          onOpen={onOpenMatch}
        />
      </Card>

      {intel.sameNight.length > 0 ? (
        <Card style={styles.cardGap}>
          <Text style={styles.cardEyebrow}>同夜其他推荐</Text>
          {intel.sameNight.map(entry => (
            <Pressable
              key={entry.m.id}
              onPress={() => onOpenMatch(entry.m.id)}
              style={({ pressed }) => [styles.sameNightRow, pressed && styles.pressed]}
            >
              <Text style={styles.sameNightTime}>{hm(entry.m.t)}</Text>
              <Text style={styles.sameNightTeams} numberOfLines={1}>
                {teamName(entry.m.h)} vs {teamName(entry.m.a)}
              </Text>
              <Text style={styles.sameNightIndex}>{entry.index.toFixed(1)}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function StatsTab({
  match,
  stats,
  standings,
  onOpenMatch,
  onOpenStandings,
}: {
  match: Match;
  stats: StatsData;
  standings: MatchStandings;
  onOpenMatch: (id: string) => void;
  onOpenStandings: (league: string) => void;
}) {
  const homeForm = summaryOf(stats.home.form);
  const awayForm = summaryOf(stats.away.form);

  return (
    <View style={styles.tabGap}>
      <Card style={styles.cardGap}>
        <Text style={styles.cardEyebrow}>近 5 场走势</Text>
        <FormRow teamId={match.h} form={stats.home.form} summary={homeForm} />
        <View style={styles.divider} />
        <FormRow teamId={match.a} form={stats.away.form} summary={awayForm} />
      </Card>

      <Card style={styles.cardGap}>
        <Text style={styles.cardEyebrow}>赛季攻防</Text>
        <View style={styles.tableHead}>
          <Text style={styles.tableLabel} />
          <Text style={styles.tableTeam} numberOfLines={1}>{teamName(match.h)}</Text>
          <Text style={styles.tableTeam} numberOfLines={1}>{teamName(match.a)}</Text>
        </View>
        <SeasonRow label="场次" home={stats.home.season.played} away={stats.away.season.played} />
        <SeasonRow
          label="胜-平-负"
          home={`${stats.home.season.wins}-${stats.home.season.draws}-${stats.home.season.losses}`}
          away={`${stats.away.season.wins}-${stats.away.season.draws}-${stats.away.season.losses}`}
        />
        <SeasonRow
          label="进 / 失"
          home={`${stats.home.season.goalsFor}/${stats.home.season.goalsAgainst}`}
          away={`${stats.away.season.goalsFor}/${stats.away.season.goalsAgainst}`}
        />
        <SeasonRow
          label="胜率"
          home={`${stats.home.season.winRate}%`}
          away={`${stats.away.season.winRate}%`}
          accent
        />
      </Card>

      <StandingsCard
        match={match}
        standings={standings}
        onOpenStandings={onOpenStandings}
      />

      <Card style={styles.cardGap}>
        <Text style={styles.cardEyebrow}>历史交锋</Text>
        <View style={styles.h2hSummary}>
          <View style={styles.h2hSide}>
            <Text style={styles.h2hTeam} numberOfLines={1}>{teamName(match.h)}</Text>
            <Text style={styles.h2hBig}>{stats.h2h.summary.t1Wins}</Text>
            <Text style={styles.h2hLabel}>胜</Text>
          </View>
          <View style={styles.h2hCenter}>
            <Text style={styles.h2hBig}>{stats.h2h.summary.draws}</Text>
            <Text style={styles.h2hLabel}>平</Text>
          </View>
          <View style={styles.h2hSide}>
            <Text style={styles.h2hTeam} numberOfLines={1}>{teamName(match.a)}</Text>
            <Text style={styles.h2hBig}>{stats.h2h.summary.t2Wins}</Text>
            <Text style={styles.h2hLabel}>胜</Text>
          </View>
        </View>
        {stats.h2h.meetings.length > 0 ? (
          stats.h2h.meetings.map(meeting => (
            <Pressable
              key={meeting.id}
              onPress={() => onOpenMatch(meeting.id)}
              accessibilityRole="button"
              accessibilityLabel={`查看 ${teamName(meeting.home)} 对 ${teamName(meeting.away)} 的比赛`}
              style={({ pressed }) => [styles.meetingRow, pressed && styles.pressed]}
            >
              <Text style={styles.meetingDate}>{zhDate(meeting.date.split('T')[0])}</Text>
              <Text style={styles.meetingTeams} numberOfLines={1}>
                {teamName(meeting.home)} vs {teamName(meeting.away)}
              </Text>
              <Text style={styles.meetingScore}>{meeting.score}</Text>
              <ChevronRight size={14} color={colors.textFaint} />
            </Pressable>
          ))
        ) : (
          <Text style={styles.cardLine}>暂无已完赛的直接交手记录。</Text>
        )}
      </Card>
    </View>
  );
}

function StandingsCard({
  match,
  standings,
  onOpenStandings,
}: {
  match: Match;
  standings: MatchStandings;
  onOpenStandings: (league: string) => void;
}) {
  const league = standings.league;
  if (!standings.supported || !league) return null;

  const asOfText = standings.historical
    ? '截至本场开球前'
    : standings.lastResultAt
      ? `截至 ${bjDate(standings.lastResultAt).slice(5)}`
      : '暂无赛果';
  const metaText =
    standings.doneCount > 0 ? `${asOfText} · ${standings.doneCount} 场` : asOfText;
  const rows = [
    { id: match.h, row: standings.home },
    { id: match.a, row: standings.away },
  ];

  return (
    <Card style={styles.cardGap}>
      <Text style={styles.cardEyebrow}>积分榜位置</Text>
      <Text style={styles.standingsAsOf}>
        {leagueName(league)} · {metaText}
      </Text>
      {standings.rows.length === 0 ? (
        <Text style={styles.cardLine}>{standings.note || '本联赛暂无已同步赛果'}</Text>
      ) : (
        <View>
          {rows.map(({ id, row }, index) => (
            <View
              key={id}
              style={[styles.standingsRow, index > 0 && styles.standingsRowBorder]}
            >
              <View style={styles.standingsTop}>
                <Crest id={id} size={22} />
                <Text style={styles.standingsTeam} numberOfLines={1}>
                  {teamName(id)}
                </Text>
                {row && row.zoneKey !== 'mid' ? (
                  <Chip tone={row.zoneTone === 'warn' ? 'warn' : 'default'}>
                    {row.zoneLabel}
                  </Chip>
                ) : null}
                <Text style={styles.standingsRank}>
                  {row ? `第 ${row.rank}` : '暂无'}
                </Text>
              </View>
              {row ? (
                <>
                  <Text style={styles.standingsStats}>
                    {row.played} 场 · {row.points} 分 · 净胜球 {formatGd(row.gd)}
                  </Text>
                  {row.context ? (
                    <Text style={styles.standingsContext}>
                      {row.context.primary}
                      {row.context.secondary ? ` · ${row.context.secondary}` : ''}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.standingsContext}>该队暂无已同步赛果</Text>
              )}
            </View>
          ))}
          <Text style={styles.standingsHint}>
            排名按积分 → 净胜球 → 进球数简化排序；国内分区为参考线，欧冠按赛制。
          </Text>
          <Pressable
            onPress={() => onOpenStandings(league)}
            accessibilityRole="button"
            accessibilityLabel="查看完整积分榜"
            style={({ pressed }) => [styles.standingsLink, pressed && styles.pressed]}
          >
            <Text style={styles.standingsLinkText}>查看完整积分榜</Text>
            <ChevronRight size={14} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}
    </Card>
  );
}

function formatGd(gd: number) {
  return gd > 0 ? `+${gd}` : `${gd}`;
}

function TierMeter({ tier }: { tier: Tier }) {
  return (
    <View>
      <View style={styles.meter}>
        {[0, 1, 2, 3, 4].map(index => (
          <View
            key={index}
            style={[
              styles.meterBar,
              {
                backgroundColor: tierColor(index),
                opacity: index === tier.tier ? 1 : 0.22,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.meterLabels}>
        {['S0', 'S1', 'S2', 'S3', 'S4'].map(label => (
          <Text key={label} style={styles.meterLabel}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function AttributionRow({
  label,
  value,
  ratio = 0,
  positive = false,
  barColor,
}: {
  label: string;
  value: string;
  ratio?: number;
  positive?: boolean;
  barColor?: string;
}) {
  const pct = Math.max(0, Math.min(1, ratio));
  const fill = barColor ?? (positive ? colors.accent : colors.resource);
  return (
    <View style={styles.attrRowWrap}>
      <View style={styles.attrRow}>
        <Text style={styles.attrLabel}>{label}</Text>
        <Text style={[styles.attrValue, positive && { color: colors.accent }]}>{value}</Text>
      </View>
      <View style={styles.attrTrack}>
        <View
          style={[
            styles.attrFill,
            {
              width: `${Math.round(pct * 100)}%`,
              backgroundColor: fill,
              opacity: pct > 0 ? 0.85 : 0.15,
            },
          ]}
        />
      </View>
    </View>
  );
}

function UpcomingTeam({
  label,
  matches,
  onOpen,
}: {
  label: string;
  matches: Match[];
  onOpen: (id: string) => void;
}) {
  return (
    <View style={styles.upcomingBlock}>
      <Text style={styles.upcomingTeam}>{label}</Text>
      {matches.length > 0 ? (
        matches.slice(0, 3).map(match => (
          <Pressable
            key={match.id}
            onPress={() => onOpen(match.id)}
            style={({ pressed }) => [styles.upcomingRow, pressed && styles.pressed]}
          >
            <Crest id={match.h} size={18} />
            <Crest id={match.a} size={18} />
            <Text style={styles.upcomingTeams} numberOfLines={1}>
              {teamName(match.h)} vs {teamName(match.a)}
            </Text>
            <Text style={styles.upcomingTime}>
              {match.t.slice(5, 10).replace('-', '/')} {hm(match.t)}
            </Text>
          </Pressable>
        ))
      ) : (
        <Text style={styles.cardLine}>暂无后续赛程。</Text>
      )}
    </View>
  );
}

function FormRow({
  teamId,
  form,
  summary,
}: {
  teamId: string;
  form: FormItem[];
  summary: { wins: number; draws: number; losses: number };
}) {
  return (
    <View style={styles.formRow}>
      <View style={styles.formTeam}>
        <Crest id={teamId} size={24} />
        <Text style={styles.formTeamName} numberOfLines={1}>
          {teamName(teamId)}
        </Text>
      </View>
      <View style={styles.formDots}>
        {form.length > 0 ? (
          <FormDots form={form} />
        ) : (
          <Text style={styles.cardLine}>暂无已完赛记录</Text>
        )}
      </View>
      <Text style={styles.formSummary}>
        {summary.wins}胜 {summary.draws}平 {summary.losses}负
      </Text>
    </View>
  );
}

function SeasonRow({
  label,
  home,
  away,
  accent = false,
}: {
  label: string;
  home: string | number;
  away: string | number;
  accent?: boolean;
}) {
  return (
    <View style={styles.seasonRow}>
      <Text style={styles.seasonLabel}>{label}</Text>
      <Text style={[styles.seasonValue, accent && { color: colors.accent }]}>{home}</Text>
      <Text style={[styles.seasonValue, accent && { color: colors.accent }]}>{away}</Text>
    </View>
  );
}

function summaryOf(form: FormItem[]) {
  return form.reduce(
    (acc, item) => {
      if (item.result === 'W') acc.wins += 1;
      else if (item.result === 'L') acc.losses += 1;
      else acc.draws += 1;
      return acc;
    },
    { wins: 0, draws: 0, losses: 0 }
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
  headerTitleWrap: { flex: 1, minWidth: 0, marginHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: '700', textAlign: 'center' },
  headerTitleCompact: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  hero: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: withAlpha(colors.text, 0.08),
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leagueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leagueDot: { width: 7, height: 7, borderRadius: radius.full },
  leagueText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '600' },
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
  center: { width: 108, alignItems: 'center', gap: 3 },
  vs: { color: colors.textFaint, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 1.4 },
  time: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  countdown: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  score: {
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  revealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.panel,
  },
  revealText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '600' },
  hideScore: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  hideScoreText: { color: colors.textFaint, fontSize: fontSize.xs },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.live },
  liveLabel: { color: colors.live, fontSize: fontSize.sm, fontWeight: '700' },
  liveMinute: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  stateStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stateStripLive: {
    borderColor: withAlpha(colors.live, 0.35),
    backgroundColor: withAlpha(colors.live, 0.10),
  },
  stateLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stateActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stateReminderChip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.panel,
  },
  stateReminderText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  stateReminded: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stateRemindedText: { color: colors.textSecondary, fontSize: fontSize.xs },
  stateSecondary: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '600' },
  liveStale: { color: colors.warn, fontSize: fontSize.xs, marginTop: spacing.xs },
  stateText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1 },
  stateLiveText: { color: colors.live, fontSize: fontSize.sm, fontWeight: '700' },
  stateAction: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  segmentWrap: {
    backgroundColor: colors.bg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    zIndex: 2,
  },
  sleepNote: { marginTop: spacing.xs + 2 },
  watchLaterButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
  },
  watchLaterButtonOn: {
    borderColor: colors.accent,
    backgroundColor: colors.goldSoft,
  },
  watchLaterText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  watchLaterTextOn: { color: colors.accent },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  metric: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metricAccent: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricMuted: { color: colors.textMuted, fontSize: fontSize.sm },
  tabGap: { gap: spacing.md },
  cardGap: { gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardEyebrow: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  attributionHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attributionToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  attributionIndex: {
    color: colors.accent,
    fontSize: fontSize.lg,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cardTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: '700' },
  cardLine: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.hairline },
  meter: { flexDirection: 'row', gap: 5, marginTop: spacing.sm },
  meterBar: { flex: 1, height: 6, borderRadius: radius.full },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  meterLabel: { color: colors.textFaint, fontSize: fontSize.xs },
  attrRowWrap: {
    gap: 4,
    paddingVertical: 3,
  },
  attrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attrTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.hairline,
    overflow: 'hidden',
  },
  attrFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  attrLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  attrValue: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  formula: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: 3,
  },
  formulaText: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  formulaResult: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  upcomingBlock: { gap: spacing.sm },
  upcomingTeam: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  upcomingRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  upcomingTeams: { flex: 1, color: colors.textMuted, fontSize: fontSize.xs },
  upcomingTime: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  sameNightRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  sameNightTime: {
    width: 42,
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  sameNightTeams: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm },
  sameNightIndex: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  formRow: { gap: spacing.sm },
  formTeam: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  formTeamName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  formDots: { flexDirection: 'row', gap: 6 },
  formSummary: { color: colors.textMuted, fontSize: fontSize.xs },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: spacing.xs },
  tableLabel: { flex: 1 },
  tableTeam: {
    width: 82,
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textAlign: 'right',
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  seasonLabel: { flex: 1, color: colors.textMuted, fontSize: fontSize.xs },
  seasonValue: {
    width: 82,
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  h2hSummary: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  h2hSide: { flex: 1, alignItems: 'center', gap: 2 },
  h2hCenter: { flex: 0.7, alignItems: 'center', gap: 2, justifyContent: 'center' },
  h2hTeam: { color: colors.textSecondary, fontSize: fontSize.xs, maxWidth: '100%' },
  h2hBig: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  h2hLabel: { color: colors.textFaint, fontSize: fontSize.xs },
  meetingRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  standingsAsOf: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  standingsRow: {
    paddingVertical: spacing.sm,
  },
  standingsRowBorder: {
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  standingsTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  standingsTeam: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  standingsRank: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  standingsStats: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  standingsContext: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    lineHeight: 17,
    marginTop: 2,
  },
  standingsHint: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    lineHeight: 15,
    marginTop: spacing.sm,
  },
  standingsLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  standingsLinkText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  meetingDate: { width: 48, color: colors.textFaint, fontSize: fontSize.xs },
  meetingTeams: { flex: 1, color: colors.textSecondary, fontSize: fontSize.xs },
  meetingScore: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  primaryAction: { width: '100%' },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11,14,21,0.94)',
    borderWidth: 1,
    borderColor: colors.control,
    zIndex: 20,
    elevation: 8,
  },
  toastText: { color: colors.textSecondary, fontSize: fontSize.sm },
  pressed: { opacity: 0.8 },
});
