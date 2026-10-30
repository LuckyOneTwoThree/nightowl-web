import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react-native';

import { leagueName, teamName } from '@data/index.js';
import { computeWeek } from '@core/owl.js';
import { owlDay, sleepTier, PRODUCT_PLAN_OPTS } from '@core/engine.js';
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
    kickoffGroups: KickoffGroup[];
  };
  minefield: Array<{ m: Match; ev: Ev; reason: string }>;
  days: Array<{ date: string; count: number; cost: number; matches: Match[] }>;
  advice: string;
};

type KickoffGroup = {
  t: string;
  entries: Entry[];
  chosen: Entry;
};

const BUDGETS = [0, 1, 2, 3, 4, 5, 6, 8];
const DAY_MS = 86_400_000;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
/** 精选名额上限以算法配置为唯一出处 */
const PLAN_MAX_PICKS = PRODUCT_PLAN_OPTS.maxPicks;

export default function PlanScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const setBudget = usePrefsStore(state => state.setBudget);
  const rev = useDataRev();
  const now = useNow(60_000);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showZero, setShowZero] = useState(false);
  const [showMinefield, setShowMinefield] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const week = useMemo(
    // 周偏移只移动「看哪一周」的锚点；可排性始终用真实 now（后移 now 会把未来周
    // 前半段误判成历史，见 core computeWeek 的 weekOffset 语义）
    () => computeWeek(now, prefs, { weekOffset }) as unknown as WeekData,
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
      s.add(owlDay(entry.m.t));
    }
    return s;
  }, [plan.best]);
  const kickoffGroupByMatch = useMemo(() => {
    const map = new Map<string, KickoffGroup>();
    for (const group of plan.kickoffGroups || []) {
      for (const entry of group.entries) {
        map.set(entry.m.id, group);
      }
    }
    return map;
  }, [plan.kickoffGroups]);
  const activeDayObj = useMemo(
    () => (selectedDay ? week.days.find(d => d.date === selectedDay) ?? null : null),
    [selectedDay, week.days]
  );

  const periodLabel =
    weekOffset === 0 ? '本周规划' : weekOffset > 0 ? '未来周规划' : '历史周规划';
  const weekWord = weekOffset === 0 ? '本周' : '该周';

  const openMatch = (id: string) =>
    router.push({ pathname: '/match/[id]', params: { id } });

  const changeWeek = (delta: number) => {
    void Haptics.selectionAsync();
    setSelectedDay(null);
    setShowZero(false);
    setShowMinefield(false);
    setWeekOffset(value => value + delta);
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{periodLabel}</Text>
          <Text style={styles.subline}>
            {start.slice(5).replace('-', '/')} – {end.slice(5).replace('-', '/')} 夜
          </Text>
        </View>
        <View style={styles.weekNav}>
          <Pressable onPress={() => changeWeek(-1)} style={styles.navButton} hitSlop={6} accessibilityLabel="上一周">
            <ChevronLeft size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              setSelectedDay(null);
              setShowZero(false);
              setShowMinefield(false);
              setWeekOffset(0);
            }}
            hitSlop={7}
            style={[styles.todayButton, weekOffset === 0 && styles.todayButtonActive]}
          >
            <Text style={[styles.todayText, weekOffset === 0 && styles.todayTextActive]}>
              本周
            </Text>
          </Pressable>
          <Pressable onPress={() => changeWeek(1)} style={styles.navButton} hitSlop={6} accessibilityLabel="下一周">
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
          零成本 S0 场次不占额度，但同一时段仍只能看一场；背包最多 5 场，是本周可安排的场次上限。
        </Text>
      </Card>

      <View style={styles.section}>
        <SectionHeader
          title={`${weekWord}精选`}
          count={plan.best.length}
          right={<Text style={styles.ratio}>{plan.best.length} / {PLAN_MAX_PICKS}</Text>}
        />
        {plan.best.length > 0 ? (
          <View style={styles.list}>
            {plan.best.map(entry => (
              <PickRow
                key={entry.m.id}
                entry={entry}
                kickoffGroup={kickoffGroupByMatch.get(entry.m.id)}
                onPress={() => openMatch(entry.m.id)}
              />
            ))}
          </View>
        ) : (
          <Card tone="panel" style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {!hasAnyMatches
                ? `${weekWord}暂无比赛`
                : plan.evs.length === 0
                  ? `${weekWord}暂无可安排的未开赛场次`
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
              {plan.zeroList.map(entry => (
                <Pressable
                  key={entry.m.id}
                  onPress={() => openMatch(entry.m.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${teamName(entry.m.h)} 对 ${teamName(entry.m.a)}，指数 ${entry.index.toFixed(1)}`}
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
          <SectionHeader
            title={`${weekWord}雷区`}
            count={week.minefield.length}
            actionLabel={
              week.minefield.length > 4 ? (showMinefield ? '收起' : '查看全部') : undefined
            }
            onAction={
              week.minefield.length > 4
                ? () => {
                    animateLayout();
                    setShowMinefield(value => !value);
                  }
                : undefined
            }
          />
          <View style={styles.list}>
            {(showMinefield ? week.minefield : week.minefield.slice(0, 4)).map(item => (
              <Pressable
                key={item.m.id}
                onPress={() => openMatch(item.m.id)}
                accessibilityRole="button"
                accessibilityLabel={`${teamName(item.m.h)} 对 ${teamName(item.m.a)}，雷区，${hm(item.m.t)}`}
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
        <SectionHeader title={`${weekWord}熬夜分布`} />
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
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`周${WEEKDAYS[index]}，${day.count} 场，最高消耗 ${hmCost(day.cost)}`}
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
                      {zhDate(activeDayObj.date)} · {activeDayObj.count} 场
                    </Text>
                    <Text style={styles.dayPreviewCost}>
                      最高消耗 {hmCost(activeDayObj.cost)}
                    </Text>
                  </View>
                  {activeDayObj.matches.length > 0 ? (
                    <>
                      {activeDayObj.matches.slice(0, 4).map(m => (
                        <Pressable
                          key={m.id}
                          onPress={() => openMatch(m.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`${teamName(m.h)} 对 ${teamName(m.a)}，${hm(m.t)}`}
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
                      ))}
                      {activeDayObj.matches.length > 4 ? (
                        <Text style={styles.dayPreviewMore}>
                          还有 {activeDayObj.matches.length - 4} 场，可在赛程中查看
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.emptyText}>当日暂无未开赛场次</Text>
                  )}
                </View>
              ) : null}
              <Text style={styles.advice}>{week.advice}</Text>
            </>
          ) : (
            <Text style={styles.emptyText}>{weekWord}暂无未开赛场次，暂无分布数据。</Text>
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
                accessibilityRole="button"
                accessibilityLabel={`${teamName(entry.m.h)} 对 ${teamName(entry.m.a)}，指数 ${entry.index.toFixed(1)}`}
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
        「{weekWord}精选」按睡眠预算与看点做二维背包，不是睡眠额度；零成本场次不计入。
      </Text>
    </Screen>
  );
}

function PickRow({
  entry,
  kickoffGroup,
  onPress,
}: {
  entry: Entry;
  kickoffGroup?: KickoffGroup;
  onPress: () => void;
}) {
  const match = entry.m;
  const tier = sleepTier(match.t);
  const night = owlDay(match.t);
  const dateLabel =
    night === match.t.slice(0, 10)
      ? match.t.slice(5, 10).replace('-', '/')
      : `${night.slice(5).replace('-', '/')} 夜`;
  const groupAlternatives = kickoffGroup
    ? kickoffGroup.entries.filter(x => x.m.id !== match.id)
    : [];
  const groupSize = kickoffGroup?.entries.length ?? 0;
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
      accessibilityRole="button"
      accessibilityLabel={`${teamName(match.h)} 对 ${teamName(match.a)}，${dateLabel} ${hm(match.t)}，指数 ${entry.index.toFixed(1)}`}
      style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
    >
      <View style={[styles.pickBar, { backgroundColor: leagueColor(match.l) }]} />
      <View style={styles.pickTime}>
        <Text style={styles.pickTimeText}>{hm(match.t)}</Text>
        <Text style={styles.pickDate}>{dateLabel}</Text>
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
        {groupAlternatives.length > 0 ? (
          <>
            <Text style={styles.pickConflict} numberOfLines={1}>
              同时开球 · 只能看一场 · 组内 {groupSize} 场
            </Text>
            <Text style={styles.pickConflictNames} numberOfLines={1}>
              同组：{groupAlternatives.slice(0, 2).map(x => `${teamName(x.m.h)} vs ${teamName(x.m.a)}`).join('、')}
              {groupAlternatives.length > 2 ? ' 等' : ''}
            </Text>
          </>
        ) : null}
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
  addBudget: { marginTop: spacing.sm, height: 44 },
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
  pickDate: { color: colors.textFaint, fontSize: fontSize.xs },
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
  pickVs: { color: colors.textFaint, fontSize: fontSize.xs },
  pickReason: { color: colors.textFaint, fontSize: fontSize.xs },
  pickConflict: { color: colors.warn, fontSize: fontSize.xs, fontWeight: '600' },
  pickConflictNames: { color: colors.textFaint, fontSize: fontSize.xs },
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
  chartCount: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
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
  dayPreviewCost: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  dayPreviewMore: { color: colors.textFaint, fontSize: fontSize.xs, paddingTop: 2 },
  dayPreviewRow: {
    minHeight: 44,
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
  altDay: { color: colors.textFaint, fontSize: fontSize.xs },
  altTeams: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm },
  altIndex: { color: colors.textMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  footer: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17, textAlign: 'center' },
  pressed: { opacity: 0.8 },
});
