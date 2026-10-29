import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import StandingsPanel from '@/components/StandingsPanel';
import { STANDINGS_LEAGUES } from '@core/standings.js';
import { colors, fontSize, radius, spacing } from '@/ui/theme';

/**
 * 比赛详情进入的独立积分榜页。
 *
 * 赛程页的「赛程 | 积分榜」是原地模式切换，不经过本路由；
 * 这里保留返回按钮，因为它的上下文是从某场比赛退回来。
 */
export default function StandingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ league?: string; matchId?: string }>();

  const rawLeague = Array.isArray(params.league) ? params.league[0] : params.league;
  const rawMatchId = Array.isArray(params.matchId) ? params.matchId[0] : params.matchId;
  const league = STANDINGS_LEAGUES.includes(rawLeague || '') ? rawLeague! : 'PL';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerButton}
          hitSlop={4}
          accessibilityLabel="返回"
        >
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>积分榜</Text>
          <Text style={styles.subline}>本地已同步赛果 · 同分简化排序</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <StandingsPanel
        initialLeague={league}
        matchId={rawMatchId || null}
        onLeagueChange={next => router.setParams({ league: next })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
  headerText: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  subline: { color: colors.textMuted, fontSize: fontSize.xs },
});
