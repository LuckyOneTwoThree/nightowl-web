import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, Search, X } from 'lucide-react-native';

import { LEAGUE_ORDER, leagueColor, leagueName, teams } from '@data/index.js';

import { Crest } from '@/ui/Crest';
import { colors, fontSize, radius, spacing } from '@/ui/theme';

type Props = {
  selected: string[];
  onChange: (ids: string[]) => void;
  autoFocus?: boolean;
};

const TABS = ['ALL', ...LEAGUE_ORDER];
const TEAM_BY_ID = new Map(teams.map(team => [team.id, team]));

export function TeamPicker({ selected, onChange, autoFocus = false }: Props) {
  const [league, setLeague] = useState('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter(team => {
      if (league !== 'ALL' && team.league !== league) return false;
      if (!q) return true;
      return (
        team.zh.toLowerCase().includes(q) ||
        team.en.toLowerCase().includes(q) ||
        team.id.toLowerCase().includes(q)
      );
    });
  }, [league, query]);

  const toggle = (id: string) => {
    onChange(
      selected.includes(id) ? selected.filter(team => team !== id) : [...selected, id]
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.searchWrap}>
        <Search size={16} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          placeholder={`搜索 ${teams.length} 支球队（中文 / 英文 / 缩写）`}
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={14} accessibilityLabel="清空搜索">
            <X size={16} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map(code => {
          const active = league === code;
          return (
            <Pressable
              key={code}
              onPress={() => setLeague(code)}
              hitSlop={7}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[
                styles.tab,
                active && styles.activeTab,
              ]}
            >
              <Text style={[styles.tabText, active && styles.activeTabText]}>
                {code === 'ALL' ? '全部' : leagueName(code)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.summaryRow}>
        <Text style={styles.summary}>
          已选 {selected.length} 支
          {selected.length === 0 ? ' · 不设主队也能用' : ''}
        </Text>
        {selected.length > 0 ? (
          <Pressable onPress={() => onChange([])} hitSlop={12} style={styles.clearHit}>
            <Text style={styles.clear}>清空</Text>
          </Pressable>
        ) : null}
      </View>

      {selected.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.selectedScroll}
          contentContainerStyle={styles.selectedRow}
        >
          {selected.map(id => {
            const team = TEAM_BY_ID.get(id);
            return (
              <Pressable
                key={id}
                onPress={() => toggle(id)}
                hitSlop={8}
                style={({ pressed }) => [styles.selectedChip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`取消关注 ${team?.zh || id}`}
              >
                <Crest id={id} size={16} />
                <Text style={styles.selectedName} numberOfLines={1}>
                  {team?.zh || id}
                </Text>
                <X size={12} color={colors.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={team => team.id}
        numColumns={3}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>没有找到球队</Text>
          </View>
        }
        ListFooterComponent={
          filtered.length > 0 ? (
            <Text style={styles.listFooter}>
              共 {filtered.length} 支球队 · 点击切换关注
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => {
          const active = selected.includes(item.id);
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              style={({ pressed }) => [
                styles.team,
                active && styles.activeTeam,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.crestWrap}>
                <Crest id={item.id} size={42} />
                {active ? (
                  <View style={styles.check}>
                    <Check size={10} color={colors.accentInk} strokeWidth={3} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.teamName} numberOfLines={1}>
                {item.zh}
              </Text>
              <View style={styles.teamMeta}>
                <View style={[styles.leagueDot, { backgroundColor: leagueColor(item.league) }]} />
                <Text style={styles.teamId}>{item.id}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.sm },
  searchWrap: {
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
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    paddingVertical: 0,
  },
  tabsScroll: { flexGrow: 0, flexShrink: 0, height: 36 },
  tabs: { gap: spacing.sm, paddingVertical: 2, alignItems: 'center' },
  tab: {
    height: 30,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: { borderColor: colors.accent, backgroundColor: colors.goldSoft },
  tabText: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '600' },
  activeTabText: { color: colors.accent },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  summary: { color: colors.textFaint, fontSize: fontSize.xs },
  selectedScroll: { flexGrow: 0, flexShrink: 0, height: 30 },
  selectedRow: { gap: spacing.sm, alignItems: 'center' },
  selectedChip: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.raised,
    paddingHorizontal: spacing.sm + 2,
  },
  selectedName: { color: colors.textSecondary, fontSize: fontSize.xs, maxWidth: 90 },
  clearHit: { minHeight: 32, justifyContent: 'center' },
  clear: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '600' },
  list: { flex: 1, minHeight: 0 },
  grid: { paddingBottom: spacing.xxl, gap: spacing.sm },
  row: { gap: spacing.sm },
  team: {
    flex: 1,
    minHeight: 106,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    gap: 5,
  },
  activeTeam: { borderColor: colors.accent, backgroundColor: colors.goldSoft },
  pressed: { opacity: 0.8 },
  crestWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.card,
  },
  teamName: { color: colors.text, fontSize: fontSize.xs, fontWeight: '600', maxWidth: '96%' },
  teamMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leagueDot: { width: 5, height: 5, borderRadius: radius.full },
  teamId: { color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  empty: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm },
  listFooter: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
