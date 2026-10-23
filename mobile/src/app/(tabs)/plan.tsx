import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react-native';

import { leagueName, teamName } from '@data/index.js';
import { computeWeek } from '@core/owl.js';
import { nightOf, sleepTier } from '@core/engine.js';
import { hm, hmCost, zhDate } from '@core/format.js';
import { animateLayout } from '@/lib/layoutAnimation';
import { useNow } from '@/lib/useNow';
import { useDataRev } from '@/state/app';
import { usePrefs, usePrefsStore } from '@/state/prefs';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { SleepBadge } from '@/ui/SleepBadge';
import {
  colors,
  fontSize,
  leagueColor,
  radius,
  spacing,
  tierColor,
  withAlpha,
} from '@/ui/theme';
import type { Entry, Ev, Match } from '@/types';

type WeekData = {
  weekStartStr: string;
  plan: {
    best: Entry[];
    alt: Entry[];
    evs: Entry[];
    zeroList: Entry[];
    zeroCount: number;
    budget: number;
    used: number;
  };
  minefield: Array<{ m: Match; ev: Ev; reason: string }>;
  days: Array<{ date: string; count: number; cost: number; matches: Match[] }>;
  advice: string;
};

const BUDGETS = [0, 1, 2, 3, 4, 5, 6, 8];
const DAY_MS = 86_400_000;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export default function PlanScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const setBudget = usePrefsStore(state => state.setBudget);
  const rev = useDataRev();
  const now = useNow(60_000);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showZero, setShowZero] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const week = useMemo(
    () => computeWeek(now + weekOffset * 7 * DAY_MS, prefs) as unknown as WeekData,
    [now, weekOffset, prefs, rev]
  );

  const start = week.weekStartStr;
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const plan = week.plan;
  const remain = Math.max(0, plan.budget - plan.used);
  const hasAnyMatches = week.days.some(day => day.count > 0);
  const bestDaySet = useMemo(() => {
    const s = new Set<string>();
    for (const entry of plan.best) {
      s.add(nightOf(entry.m.t));
    }
    return s;
  }, [plan.best]);
  const activeDayObj = useMemo(
    () => (selectedDay ? week.days.find(d => d.date === selectedDay) ?? null : null),
    [selectedDay, week.days]
  );

  const openMatch = (id: string) =>
    router.push({ pathname: '/match/[id]', params: { id } });

  const changeWeek = (delta: number) => {
    void Haptics.selectionAsync();
    setSelectedDay(null);
    setWeekOffset(value => value + delta);
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>本周规划</Text>
          <Text style={styles.subline}>
            {start.slice(5).replace('-', '/')} – {end.slice(5).replace('-', '/')}
          </Text>
        </View>
        <View style={styles.weekNav}>
          <Pressable onPress={() => changeWeek(-1)} style={styles.navButton} accessibilityLabel="上一周">
            <ChevronLeft size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              setWeekOffset(0);
            }}
            style={[styles.todayButton, weekOffset === 0 && styles.todayButtonActive]}
          >
            <Text style={[styles.todayText, weekOffset === 0 && styles.todayTextActive]}>
              本周
            </Text>
          </Pressable>
          <Pressable onPress={() => changeWeek(1)} style={styles.navButton} accessibilityLabel="下一周">
            <ChevronRight size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <Card tone="panel" style={styles.budgetCard}>
        <View style={styles.budgetTop}>
          <View>
            <Text style={styles.eyebrow}>睡眠预算</Text>
            <Text style={styles.budgetValue}>
              {plan.budget.toFixed(1)}
              <Text style={styles.budgetUnit}> 小时 / 周</Text>
            </Text>
          </View>
          <View style={styles.budgetStats}>
            <Text style={styles.budgetStat}>已用 {hmCost(plan.used)}</Text>
            <Text style={styles.budgetStat}>结余 {hmCost(remain)}</Text>
          </View>
        </View>
        {plan.budget > 0 ? (
          <View style={styles.budgetBarTrack}>
            {plan.best.map(entry => {
              const t = sleepTier(entry.m.t);
              if (t.cost <= 0) return null;
              const pct = Math.min(100, (t.cost / plan.budget) * 100);
              return (
                <View
                  key={entry.m.id}
                  style={[
                    styles.budgetBarSegment,
                    {
                      width: `${pct}%`,
                      backgroundColor: tierColor(t.tier),
                    },
                  ]}
                />
              );
            })}
          </View>
        ) : null}
        <View style={styles.budgetRow}>
          {BUDGETS.map(hours => (
            <Chip
              key={hours}
              selected={plan.budget === hours}
              onPress={() => {
                void Haptics.selectionAsync();
                setBudget(hours);
              }}
            >
              {hours}h
            </Chip>
          ))}
        </View>
        <Text style={styles.hint}>
          零成本 S0 场次不占额度；背包最多 5 场，是本周可安排的场次上限。
        </Text>
      </Card>

      <View style={styles.section}>
        <SectionHeader
          title="本周精选"
          count={plan.best.length}
          right={<Text style={styles.ratio}>{plan.best.length} / 5</Text>}
        />
        {plan.best.length > 0 ? (
          <View style={styles.list}>
            {plan.best.map(entry => (
              <PickRow key={entry.m.id} entry={entry} onPress={() => openMatch(entry.m.id)} />
            ))}
          </View>
        ) : (
          <Card tone="panel" style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {!hasAnyMatches
                ? '本周暂无比赛'
                : plan.evs.length === 0
                  ? '本周暂无可安排的未开赛场次'
                  : '当前预算下暂未选出场次'}
            </Text>
            {plan.evs.length > 0 && plan.budget < 8 ? (
              <Button
                label="预算增加 1 小时"
                variant="secondary"
                onPress={() => setBudget(Math.min(8, plan.budget + 1))}
                style={styles.addBudget}
              />
            ) : null}
          </Card>
        )}
      </View>

      {plan.zeroCount > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            title="零成本顺带"
            count={plan.zeroCount}
            actionLabel={showZero ? '收起' : '展开'}
            onAction={() => {
              animateLayout();
              setShowZero(value => !value);
            }}
          />
          {showZero ? (
            <View style={styles.list}>
              {plan.zeroList.slice(0, 20).map(entry => (
                <Pressable
                  key={entry.m.id}
                  onPress={() => openMatch(entry.m.id)}
                  style={({ pressed }) => [styles.zeroRow, pressed && styles.pressed]}
                >
                  <Text style={styles.zeroTime}>{hm(entry.m.t)}</Text>
                  <Text style={styles.zeroTeams} numberOfLines={1}>
                    {teamName(entry.m.h)} vs {teamName(entry.m.a)}
                  </Text>
                  <Text style={styles.zeroIndex}>{entry.index.toFixed(1)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {week.minefield.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="本周雷区" count={week.minefield.length} />
          <View style={styles.list}>
            {week.minefield.slice(0, 4).map(item => (
              <Pressable
                key={item.m.id}
                onPress={() => openMatch(item.m.id)}
                style={({ pressed }) => [styles.mineRow, pressed && styles.pressed]}
              >
                <TriangleAlert size={15} color={colors.warn} />
                <View style={styles.mineText}>
                  <Text style={styles.mineTeams} numberOfLines={1}>
                    {teamName(item.m.h)} vs {teamName(item.m.a)}
                  </Text>
                  <Text style={styles.mineReason} numberOfLines={1}>
                    {item.reason}
                  </Text>
                </View>
                <Text style={styles.mineTime}>{hm(item.m.t)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="本周熬夜分布" />
        <Card tone="panel">
          {hasAnyMatches ? (
            <>
              <View style={styles.chart}>
                {week.days.map((day, index) => {
                  const height = day.count === 0 ? 3 : Math.max(8, (day.cost / 4.5) * 58);
                  const bucket =
                    day.cost >= 4.5
                      ? 4
                      : day.cost >= 3.5
                        ? 3
                        : day.cost >= 2.5
                          ? 2
                          : day.cost >= 1
                            ? 1
                            : 0;
                  const hasBest = bestDaySet.has(day.date);
                  const isSelected = selectedDay === day.date;
                  return (
                    <Pressable
                      key={day.date}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        animateLayout();
                        setSelectedDay(cur => (cur === day.date ? null : day.date));
                      }}
                      style={[
                        styles.chartColumn,
                        isSelected && styles.chartColumnActive,
                      ]}
                    >
                      <View style={styles.chartDotSlot}>
                        {hasBest ? <View style={styles.chartBestDot} /> : null}
                      </View>
                      <View style={styles.chartBarWrap}>
                        <View
                          style={[
                            styles.chartBar,
                            {
                              height,
                              backgroundColor:
                                day.count === 0 ? colors.hairline : tierColor(bucket),
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.chartLabel,
                          isSelected && { color: colors.accent, fontWeight: '700' },
                        ]}
                      >
                        周{WEEKDAYS[index]}
                      </Text>
                      <Text style={styles.chartCount}>{day.count || '·'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {activeDayObj ? (
                <View style={styles.dayPreview}>
                  <View style={styles.dayPreviewHead}>
                    <Text style={styles.dayPreviewTitle}>
                      {zhDate(activeDayObj.date)} · {activeDayObj.count} 场未开赛
                    </Text>
                    <Text style={styles.dayPreviewCost}>
                      最高消耗 {hmCost(activeDayObj.cost)}
                    </Text>
                  </View>
                  {activeDayObj.matches.length > 0 ? (
                    activeDayObj.matches.slice(0, 4).map(m => (
                      <Pressable
                        key={m.id}
                        onPress={() => openMatch(m.id)}
                        style={({ pressed }) => [
                          styles.dayPreviewRow,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.dayPreviewTime}>{hm(m.t)}</Text>
                        <Text style={styles.dayPreviewTeams} numberOfLines={1}>
                          {teamName(m.h)} vs {teamName(m.a)}
                        </Text>
                        <SleepBadge tier={sleepTier(m.t)} />
                      </Pressable>
                    ))
                  ) : (
                    <Text style={styles.emptyText}>当日暂无未开赛场次</Text>
                  )}
                </View>
              ) : null}
              <Text style={styles.advice}>{week.advice}</Text>
            </>
          ) : (
            <Text style={styles.emptyText}>本周暂无未开赛场次，暂无分布数据。</Text>
          )}
        </Card>
      </View>

      {plan.alt.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="备选" count={plan.alt.length} />
          <View style={styles.list}>
            {plan.alt.map(entry => (
              <Pressable
                key={entry.m.id}
                onPress={() => openMatch(entry.m.id)}
                style={({ pressed }) => [styles.altRow, pressed && styles.pressed]}
              >
                <View style={styles.altDate}>
                  <Text style={styles.altTime}>{hm(entry.m.t)}</Text>
                  <Text style={styles.altDay}>{zhDate(entry.m.t.split('T')[0])}</Text>
                </View>
                <Text style={styles.altTeams} numberOfLines={1}>
                  {teamName(entry.m.h)} vs {teamName(entry.m.a)}
                </Text>
                <Text style={styles.altIndex}>{entry.index.toFixed(1)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <Text style={styles.footer}>
        「本周精选」按睡眠预算与看点做二维背包，不是睡眠额度；零成本场次不计入。
      </Text>
    </Screen>
  );
}

function PickRow({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const match = entry.m;
  const tier = sleepTier(match.t);
  const reason = entry.ev.isFollowed
    ? '主队出战'
    : entry.ev.rivalry
      ? entry.ev.rivalry
      : entry.ev.keyNode
        ? '故事线关键节点'
        : entry.ev.star >= 3
          ? '焦点战'
          : '跨联赛焦点';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
    >
      <View style={[styles.pickBar, { backgroundColor: leagueColor(match.l) }]} />
      <View style={styles.pickTime}>
        <Text style={styles.pickTimeText}>{hm(match.t)}</Text>
        <Text style={styles.pickDate}>{match.t.slice(5, 10).replace('-', '/')}</Text>
      </View>
      <View style={styles.pickMain}>
        <View style={styles.pickTop}>
          <Text style={styles.pickLeague}>{leagueName(match.l)}</Text>
          <SleepBadge tier={tier} />
          <Text style={styles.pickIndex}>{entry.index.toFixed(1)}</Text>
        </View>
        <View style={styles.pickTeams}>
          <Crest id={match.h} size={20} />
          <Text style={styles.pickTeamName} numberOfLines={1}>
            {teamName(match.h)}
          </Text>
          <Text style={styles.pickVs}>vs</Text>
          <Crest id={match.a} size={20} />
          <Text style={styles.pickTeamName} numberOfLines={1}>
            {teamName(match.a)}
          </Text>
        </View>
        <Text style={styles.pickReason} numberOfLines={1}>
          {reason}
        </Text>
      </View>
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
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800', letterSpacing: 0.3 },
  subline: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 2 },
  weekNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  todayButton: {
    height: 30,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayButtonActive: { borderColor: colors.accent, backgroundColor: colors.goldSoft },
  todayText: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '600' },
  todayTextActive: { color: colors.accent },
  budgetCard: { gap: spacing.sm },
  budgetTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  eyebrow: { color: colors.textFaint, fontSize: fontSize.xs, fontWeight: '600' },
  budgetValue: {
    color: colors.resource,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  budgetUnit: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '500' },
  budgetStats: { alignItems: 'flex-end', gap: 3 },
  budgetStat: { color: colors.textMuted, fontSize: fontSize.xs },
  budgetBarTrack: {
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    flexDirection: 'row',
    overflow: 'hidden',
    gap: 2,
  },
  budgetBarSegment: {
    height: '100%',
    borderRadius: radius.full,
  },
  budgetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.xs },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  section: { gap: spacing.sm },
  ratio: { color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  list: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  emptyCard: { alignItems: 'center', gap: spacing.xs },
  emptyTitle: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
  addBudget: { marginTop: spacing.sm, height: 38 },
  pickRow: {
    flexDirection: 'row',
    minHeight: 92,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  pickBar: { width: 3, alignSelf: 'stretch' },
  pickTime: { width: 60, padding: spacing.md, gap: 2 },
  pickTimeText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pickDate: { color: colors.textFaint, fontSize: fontSize.xxs },
  pickMain: { flex: 1, paddingVertical: spacing.md, paddingRight: spacing.md, gap: 6 },
  pickTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickLeague: { color: colors.textMuted, fontSize: fontSize.xs },
  pickIndex: {
    marginLeft: 'auto',
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pickTeams: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickTeamName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', maxWidth: '34%' },
  pickVs: { color: colors.textFaint, fontSize: fontSize.xxs },
  pickReason: { color: colors.textFaint, fontSize: fontSize.xs },
  zeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  zeroTime: {
    width: 42,
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  zeroTeams: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm },
  zeroIndex: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  mineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  mineText: { flex: 1, gap: 2 },
  mineTeams: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  mineReason: { color: colors.textFaint, fontSize: fontSize.xs },
  mineTime: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingTop: spacing.xs },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  chartColumnActive: {
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  chartDotSlot: { height: 6, justifyContent: 'center', alignItems: 'center' },
  chartBestDot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  chartBarWrap: { height: 60, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  chartBar: { width: '62%', borderRadius: radius.sm, minHeight: 3 },
  chartLabel: { color: colors.textFaint, fontSize: fontSize.xs },
  chartCount: { color: colors.textMuted, fontSize: fontSize.xxs, fontVariant: ['tabular-nums'] },
  dayPreview: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    gap: spacing.xs,
  },
  dayPreviewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  dayPreviewTitle: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  dayPreviewCost: { color: colors.textMuted, fontSize: fontSize.xxs, fontVariant: ['tabular-nums'] },
  dayPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  dayPreviewTime: {
    width: 40,
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  dayPreviewTeams: { flex: 1, color: colors.textSecondary, fontSize: fontSize.xs },
  advice: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 18, marginTop: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  altDate: { width: 70, gap: 1 },
  altTime: { color: colors.textSecondary, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  altDay: { color: colors.textFaint, fontSize: fontSize.xxs },
  altTeams: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm },
  altIndex: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  footer: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17, textAlign: 'center' },
  pressed: { opacity: 0.8 },
});
