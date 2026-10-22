import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';

import { LEAGUE_ORDER, leagueName } from '@data/index.js';
import {
  computeScheduleRows,
  dayCounts,
  owlDayOffset,
} from '@core/owl.js';
import { nightOf } from '@core/engine.js';
import { weekdayOf, zhDate } from '@core/format.js';
import { syncNow } from '@/data/sync/run';
import { useNow } from '@/lib/useNow';
import { useDataRev } from '@/state/app';
import { usePrefs } from '@/state/prefs';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { MatchRow } from '@/ui/MatchRow';
import { Sheet } from '@/ui/Sheet';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { Match } from '@/types';

type Row =
  | { type: 'date'; key: string; date: string; count: number }
  | { type: 'match'; key: string; m: Match };

type DateSection = {
  date: string;
  count: number;
  data: Match[];
};

type Filters = {
  leagues: string[];
  onlyFollowed: boolean;
  query: string;
};

const DEFAULT_FILTERS = (): Filters => ({
  leagues: [...LEAGUE_ORDER],
  onlyFollowed: false,
  query: '',
});

export default function ScheduleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; date?: string }>();
  const prefs = usePrefs();
  const rev = useDataRev();
  const now = useNow(60_000);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedDate, setSelectedDate] = useState<string | 'all' | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const appliedParams = useRef<string | null>(null);

  const today = nightOf(now);
  const activeDate = selectedDate ?? today;

  useEffect(() => {
    const key = `${params.q ?? ''}|${params.date ?? ''}`;
    if (appliedParams.current === key) return;
    appliedParams.current = key;
    if (params.q) {
      setFilters(current => ({ ...current, query: params.q as string }));
    }
    if (params.date) {
      setSelectedDate(params.date);
    }
  }, [params.q, params.date]);

  const counts = useMemo(() => dayCounts() as Record<string, number>, [rev]);

  const dates = useMemo(
    () => Array.from({ length: 15 }, (_, index) => owlDayOffset(index - 2, now)),
    [now]
  );

  const rows = useMemo(() => {
    if (filters.leagues.length === 0) return [] as Row[];
    return computeScheduleRows(now, prefs, {
      leagues: filters.leagues,
      onlyFollowed: filters.onlyFollowed,
      query: filters.query,
    }) as Row[];
  }, [now, prefs, filters, rev]);

  const visibleRows = useMemo(() => {
    if (activeDate === 'all') return rows;
    const start = rows.findIndex(row => row.type === 'date' && row.date === activeDate);
    if (start < 0) return [];
    let end = rows.length;
    for (let index = start + 1; index < rows.length; index += 1) {
      if (rows[index].type === 'date') {
        end = index;
        break;
      }
    }
    return rows.slice(start, end);
  }, [rows, activeDate]);

  const sections = useMemo(() => {
    const result: DateSection[] = [];
    let current: DateSection | null = null;
    for (const row of visibleRows) {
      if (row.type === 'date') {
        current = { date: row.date, count: row.count, data: [] };
        result.push(current);
      } else if (current) {
        current.data.push(row.m);
      }
    }
    return result.filter(section => section.data.length > 0);
  }, [visibleRows]);

  const refresh = useCallback(() => {
    setChecking(true);
    setRefreshNote(null);
    void syncNow({ quick: true })
      .then(outcome => {
        setRefreshNote(
          outcome.changed > 0 ? `已更新 ${outcome.changed} 场比分` : '暂无比分更新'
        );
      })
      .catch(() => {
        setRefreshNote('比分更新失败，沿用本地数据');
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!refreshNote) return undefined;
    const timer = setTimeout(() => setRefreshNote(null), 2400);
    return () => clearTimeout(timer);
  }, [refreshNote]);

  const allLeaguesSelected = filters.leagues.length === LEAGUE_ORDER.length;
  const leagueFilterLabel = allLeaguesSelected
    ? '全部联赛'
    : filters.leagues.length === 0
      ? '未选联赛'
      : `${filters.leagues.length} 个联赛`;
  const filtersDirty = !allLeaguesSelected || filters.onlyFollowed;

  const toggleLeague = (code: string) => {
    setFilters(current => {
      const selected = current.leagues.includes(code);
      const leagues = selected
        ? current.leagues.filter(item => item !== code)
        : [...current.leagues, code];
      return { ...current, leagues };
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>赛程</Text>
          <Text style={[styles.subline, (checking || refreshNote) && styles.sublineNote]}>
            {checking
              ? '正在检查比分…'
              : refreshNote ?? '全季赛程 · 北京时间 · 夜猫日口径'}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/search')}
          style={styles.iconButton}
          accessibilityLabel="搜索球队或比赛"
        >
          <Search size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dateScroll}
        contentContainerStyle={styles.dateStrip}
      >
        <Pressable
          onPress={() => setSelectedDate('all')}
          style={[styles.dateCard, styles.allCard, activeDate === 'all' && styles.dateCardActive]}
        >
          <Text style={[styles.dateWeekday, activeDate === 'all' && styles.dateActiveText]}>
            全季
          </Text>
          <Text style={[styles.dateDay, activeDate === 'all' && styles.dateActiveText]}>
            {rows.filter(row => row.type === 'match').length}
          </Text>
          <Text style={styles.dateCount}>场</Text>
        </Pressable>
        {dates.map(date => {
          const active = activeDate === date;
          const isToday = date === today;
          const count = counts[date] ?? 0;
          return (
            <Pressable
              key={date}
              onPress={() => setSelectedDate(date)}
              style={[
                styles.dateCard,
                isToday && !active && styles.dateCardToday,
                active && styles.dateCardActive,
              ]}
            >
              <Text style={[styles.dateWeekday, active && styles.dateActiveText]}>
                {isToday ? '今天' : weekdayOf(date).replace('周', '')}
              </Text>
              <Text style={[styles.dateDay, active && styles.dateActiveText]}>
                {date.slice(8)}
              </Text>
              <Text style={[styles.dateCount, active && styles.dateActiveCount]}>
                {count > 0 ? `${count} 场` : '—'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.filterBlock}>
        <View style={styles.filterRow}>
          <Chip
            icon={<ChevronDown size={13} color={colors.textMuted} />}
            onPress={() => setFiltersOpen(true)}
          >
            {leagueFilterLabel}
          </Chip>
          <Chip
            selected={filters.onlyFollowed}
            onPress={() =>
              setFilters(current => ({ ...current, onlyFollowed: !current.onlyFollowed }))
            }
          >
            只看关注
          </Chip>
          {filtersDirty ? (
            <Pressable
              onPress={() =>
                setFilters(current => ({
                  ...current,
                  leagues: [...LEAGUE_ORDER],
                  onlyFollowed: false,
                }))
              }
              hitSlop={10}
            >
              <Text style={styles.reset}>重置</Text>
            </Pressable>
          ) : null}
        </View>
        {filters.query ? (
          <View style={styles.queryRow}>
            <Text style={styles.queryText} numberOfLines={1}>
              搜索：{filters.query}
            </Text>
            <Pressable
              hitSlop={8}
              onPress={() => setFilters(current => ({ ...current, query: '' }))}
              accessibilityLabel="清除搜索"
            >
              <X size={14} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.listWrap}>
        <SectionList<Match, DateSection>
          sections={sections}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled
          refreshing={false}
          onRefresh={refresh}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <View style={styles.dateHeader}>
              <Text style={styles.dateHeaderText}>{zhDate(section.date)}</Text>
              <Text style={styles.dateHeaderWeek}>{weekdayOf(section.date)}</Text>
              <Text style={styles.dateHeaderCount}>{section.count} 场</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.matchWrap}>
              <MatchRow
                match={item}
                now={now}
                prefs={prefs}
                onPress={() =>
                  router.push({ pathname: '/match/[id]', params: { id: item.id } })
                }
              />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon={<Search size={20} color={colors.textMuted} />}
              title="这一天没有比赛"
              description={
                filters.query
                  ? '当前搜索或筛选条件下没有匹配的场次。'
                  : '换个日期，或查看全季赛程。'
              }
              actionLabel="查看全部"
              onAction={() => {
                setSelectedDate('all');
                setFilters(DEFAULT_FILTERS());
              }}
            />
          }
        />
      </View>

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="筛选联赛">
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetHint}>选择要显示的联赛</Text>
          <View style={styles.sheetActions}>
            <Pressable
              onPress={() =>
                setFilters(current => ({ ...current, leagues: [...LEAGUE_ORDER] }))
              }
              hitSlop={10}
            >
              <Text style={styles.reset}>全选</Text>
            </Pressable>
            <Pressable
              onPress={() => setFilters(current => ({ ...current, leagues: [] }))}
              hitSlop={10}
            >
              <Text style={styles.reset}>清空</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.leagueChips}>
          {LEAGUE_ORDER.map(code => {
            const active = filters.leagues.includes(code);
            return (
              <Chip
                key={code}
                selected={active}
                icon={active ? <Check size={12} color={colors.accent} /> : undefined}
                onPress={() => toggleLeague(code)}
              >
                {leagueName(code)}
              </Chip>
            );
          })}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800', letterSpacing: 0.3 },
  subline: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 2 },
  sublineNote: { color: colors.textMuted },
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
  dateScroll: { flexGrow: 0, flexShrink: 0, height: 78 },
  dateStrip: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  dateCard: {
    width: 54,
    height: 66,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  allCard: { width: 58 },
  reset: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '600' },
  dateCardToday: { borderColor: colors.control },
  dateCardActive: { borderColor: colors.accent, backgroundColor: colors.goldSoft },
  dateWeekday: { color: colors.textFaint, fontSize: fontSize.xs },
  dateDay: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dateCount: { color: colors.textFaint, fontSize: fontSize.xxs },
  dateActiveText: { color: colors.accent },
  dateActiveCount: { color: colors.accent },
  filterBlock: { paddingTop: spacing.sm, gap: spacing.sm },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetHint: { color: colors.textMuted, fontSize: fontSize.sm },
  sheetActions: { flexDirection: 'row', gap: spacing.md },
  leagueChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  queryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  queryText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.xs },
  listWrap: { flex: 1, minHeight: 0, marginTop: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  dateHeaderText: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  dateHeaderWeek: { color: colors.textFaint, fontSize: fontSize.xs },
  dateHeaderCount: { marginLeft: 'auto', color: colors.textFaint, fontSize: fontSize.xs },
  matchWrap: {
    backgroundColor: colors.card,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.hairline,
  },
});
