import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { ChevronRight, Settings2 } from 'lucide-react-native';

import { getFixtures, leagueName, teamName } from '@data/index.js';
import { bjClock, bjDate, hm } from '@core/format.js';
import { queueWithMatches } from '@core/queue.js';
import watchSources from '../../shared/server/watch-sources.json';
import { freshnessOf } from '@/data/fixtures';
import { syncNow } from '@/data/sync/run';
import { useSyncState } from '@/data/sync/useSync';
import { openExternal } from '@/lib/openExternal';
import { useNow } from '@/lib/useNow';
import { useAppStore, useDataRev } from '@/state/app';
import { useDiaryStore } from '@/state/diary';
import { useMorningDigestStore } from '@/state/morningDigest';
import { usePrefs } from '@/state/prefs';
import { useWatchLaterStore } from '@/state/queue';
import { SeasonReportModal } from '@/components/SeasonReportModal';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Fold } from '@/ui/Fold';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { Sheet } from '@/ui/Sheet';
import { colors, fontSize, radius, spacing, weight } from '@/ui/theme';

/**
 * 「我的」= 个人中心，不再承载设置。
 *
 * 身份、明早补看、战报与数据状态留在首屏；关注偏好、观赛规则、睡眠、数据详情
 * 全部收进 /settings。补看列表只预览两条，完整管理在底部抽屉里 —— 页面高度
 * 不再随关注球队数量和补看场次无限增长。
 */
export default function MeScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const rev = useDataRev();
  const watchLaterItems = useWatchLaterStore(state => state.items);
  const removeWatchLater = useWatchLaterStore(state => state.remove);
  const markWatchLaterWatched = useWatchLaterStore(state => state.markWatched);
  const toggleWatchLater = useWatchLaterStore(state => state.toggle);
  const now = useNow(60_000);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rev 是数据修订触发器；body 读模块级 fixtures
  const queueEntries = useMemo(
    () => queueWithMatches(watchLaterItems, getFixtures(), now, { includeWatched: true }),
    [watchLaterItems, rev, now]
  );
  const pendingQueueEntries = queueEntries.filter(entry => entry.item.status === 'pending');
  const watchedQueueEntries = queueEntries.filter(entry => entry.item.status === 'watched');
  const previewEntries = pendingQueueEntries.slice(0, 2);
  const requestMorningDigest = useMorningDigestStore(state => state.requestOpen);
  const source = useAppStore(state => state.source);
  const { syncing, syncError, lastCheckedAt } = useSyncState();
  const [quickPulling, setQuickPulling] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [seasonReportOpen, setSeasonReportOpen] = useState(false);
  const diary = useDiaryStore(state => state.diary);
  const revealedMap = useAppStore(state => state.revealedIds);
  const revealedList = useMemo(
    () => Object.keys(revealedMap || {}).filter(k => revealedMap[k]),
    [revealedMap]
  );
  const diaryCount = Object.keys(diary.entries || {}).length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: rev 是数据修订触发器；body 读模块级 fixtures
  const freshness = useMemo(
    () => freshnessOf(getFixtures(), now, source),
    [now, source, rev]
  );

  const runSync = useCallback(async () => {
    try {
      await syncNow();
    } catch {
      // 错误由 syncError 展示
    }
  }, []);

  // 下拉只快检；完整同步仍然只由「立即同步」按钮触发。
  const quickRefresh = useCallback(async () => {
    setQuickPulling(true);
    try {
      await syncNow({ quick: true });
    } catch {
      // 错误由 syncError 展示
    } finally {
      setQuickPulling(false);
    }
  }, []);

  const version = Constants.expoConfig?.version ?? '0.1.0';
  const sourceLabel = source === 'stored' ? '本地同步数据' : '内置快照';
  const officialSources = watchSources.official || [];
  const openSettings = () => router.push('/settings' as Href);
  const openMatch = (id: string) =>
    router.push({ pathname: '/match/[id]', params: { id } });

  return (
    <Screen scroll onRefresh={quickRefresh} refreshing={syncing || quickPulling}>
      <View style={styles.header}>
        <Text style={styles.title}>我的</Text>
        <Pressable
          onPress={openSettings}
          hitSlop={4}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="设置"
        >
          <Settings2 size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="明早补看"
          count={pendingQueueEntries.length}
          actionLabel="看摘要"
          onAction={requestMorningDigest}
        />
        <Card style={styles.cardGap}>
          {queueEntries.length === 0 ? (
            <Text style={styles.emptyText}>还没有加入补看。可在比赛详情点「明早补看」。</Text>
          ) : (
            <>
              {previewEntries.length === 0 ? (
                <Text style={styles.emptyText}>待看已清空，已看过的场次可在下方查看。</Text>
              ) : (
                previewEntries.map(({ item, match }, index) => (
                  <View key={item.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <Pressable
                      onPress={() => match && openMatch(match.id)}
                      disabled={!match}
                      hitSlop={{ top: 8, bottom: 8 }}
                      accessibilityRole={match ? 'button' : undefined}
                      accessibilityLabel={
                        match ? `查看 ${teamName(match.h)} 对 ${teamName(match.a)}` : undefined
                      }
                      style={({ pressed }) => [styles.queueRow, pressed && styles.pressed]}
                    >
                      <View style={styles.queueText}>
                        <Text style={styles.queueTitle} numberOfLines={1}>
                          {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                        </Text>
                        <Text style={styles.queueMeta}>
                          {match
                            ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)}`
                            : item.id}
                        </Text>
                      </View>
                      <ChevronRight size={14} color={colors.textFaint} />
                    </Pressable>
                  </View>
                ))
              )}
              {watchedQueueEntries.length > 0 ? (
                <Text style={styles.queueFootnote}>
                  已看过 {watchedQueueEntries.length} 场
                </Text>
              ) : null}
              {pendingQueueEntries.length > previewEntries.length ||
              watchedQueueEntries.length > 0 ? (
                <Pressable
                  onPress={() => setQueueOpen(true)}
                  style={({ pressed }) => [styles.allRow, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`查看全部 ${queueEntries.length} 场补看`}
                >
                  <Text style={styles.allText}>查看全部 {queueEntries.length} 场</Text>
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
              ) : null}
            </>
          )}
        </Card>
      </View>

      <Card style={styles.profile}>
        <Image
          source={require('../../../assets/brand/logo.png')}
          style={styles.logo}
          contentFit="cover"
          accessibilityLabel="夜猫看台"
        />
        <View style={styles.profileText}>
          <Text style={styles.profileName}>夜猫看台</Text>
          <Text style={styles.profileSub}>
            {prefs.followedTeams.length} 支球队 · {prefs.followedLeagues.length} 个联赛 · 每周{' '}
            {prefs.weeklyBudget}h
          </Text>
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader title="战报与连接" />
        <Card style={styles.cardGap}>
          <Pressable
            onPress={() => setSeasonReportOpen(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkName}>我的熬夜赛季账单</Text>
              <Text style={styles.linkNote}>
                已盖章 {diaryCount} 场 · 本地战报卡片与文本分享（防剧透隔离已开启）
              </Text>
            </View>
            <ChevronRight size={16} color={colors.textFaint} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/pair' as Href)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, styles.linkRowLast, pressed && styles.pressed]}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkName}>局域网同步与被窝接力</Text>
              <Text style={styles.linkNote}>
                同一 Wi-Fi 下扫码或输入 6 位口令，与桌面端双向合并偏好与账本
              </Text>
            </View>
            <ChevronRight size={16} color={colors.textFaint} />
          </Pressable>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="数据与服务" actionLabel="详情" onAction={openSettings} />
        <Card style={styles.cardGap}>
          <View style={styles.dataRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: syncError ? colors.danger : colors.success },
              ]}
            />
            <Text style={styles.dataText} numberOfLines={1}>
              {sourceLabel} · 上次检查{' '}
              {lastCheckedAt
                ? `${bjDate(lastCheckedAt)} ${bjClock(lastCheckedAt, false)}`
                : '尚未同步'}
            </Text>
          </View>
          <Text style={styles.dataMeta}>
            待录 {freshness.pendingCount} 场 · 进行中 {freshness.liveCount} 场
          </Text>
          {syncError ? <Text style={styles.error}>{syncError}</Text> : null}
          <Button
            label={syncing ? '正在同步…' : '立即同步'}
            variant="secondary"
            loading={syncing}
            onPress={runSync}
            style={styles.syncButton}
          />
        </Card>
      </View>

      <Fold
        title="官方平台"
        summary={`${officialSources.length} 个官方入口 · 不代理视频`}
      >
        {officialSources.map((sourceItem, index) => (
          <View key={sourceItem.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <Pressable
              onPress={() => {
                if (sourceItem.homeUrl) {
                  void openExternal(sourceItem.homeUrl, sourceItem.name);
                }
              }}
              style={({ pressed }) => [
                styles.linkRow,
                index === officialSources.length - 1 && styles.linkRowLast,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <View style={styles.linkText}>
                <Text style={styles.linkName}>{sourceItem.name}</Text>
                <Text style={styles.linkNote} numberOfLines={1}>
                  {sourceItem.note || '官方平台入口'}
                </Text>
              </View>
              <ChevronRight size={16} color={colors.textFaint} />
            </Pressable>
          </View>
        ))}
        <Text style={styles.hint}>
          App 不代理、不下载任何视频；直播与回放入口由官方平台提供。
        </Text>
      </Fold>

      <Text style={styles.footer}>夜猫看台 · Android 移动端 · v{version}</Text>

      <Sheet
        visible={queueOpen}
        onClose={() => setQueueOpen(false)}
        title="明早补看"
        scroll
      >
        {queueEntries.length === 0 ? (
          <Text style={styles.emptyText}>还没有加入补看。可在比赛详情点「明早补看」。</Text>
        ) : (
          <>
            {pendingQueueEntries.length === 0 ? (
              <Text style={styles.emptyText}>待看已清空，已看过的场次仍在下面。</Text>
            ) : (
              pendingQueueEntries.map(({ item, match }, index) => (
                <View key={item.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.sheetRow}>
                    <Pressable
                      onPress={() => {
                        if (!match) return;
                        setQueueOpen(false);
                        openMatch(match.id);
                      }}
                      disabled={!match}
                      hitSlop={{ top: 10, bottom: 10 }}
                      accessibilityRole={match ? 'button' : undefined}
                      accessibilityLabel={
                        match ? `查看 ${teamName(match.h)} 对 ${teamName(match.a)}` : undefined
                      }
                      style={({ pressed }) => [styles.queueText, pressed && styles.pressed]}
                    >
                      <Text style={styles.queueTitle} numberOfLines={1}>
                        {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                      </Text>
                      <Text style={styles.queueMeta}>
                        {match
                          ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)}`
                          : item.id}
                      </Text>
                    </Pressable>
                    {match ? (
                      <Pressable
                        onPress={() => markWatchLaterWatched(item.id)}
                        hitSlop={16}
                        accessibilityRole="button"
                        accessibilityLabel="标记已看"
                      >
                        <Text style={styles.queueAction}>已看</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => removeWatchLater(item.id)}
                      hitSlop={16}
                      accessibilityRole="button"
                      accessibilityLabel="移除补看"
                    >
                      <Text style={styles.queueRemove}>移除</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
            {watchedQueueEntries.length > 0 ? (
              <>
                <Text style={styles.queueSectionLabel}>
                  已看过 {watchedQueueEntries.length} 场
                </Text>
                {watchedQueueEntries.map(({ item, match }, index) => (
                  <View key={item.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.sheetRow}>
                      <Pressable
                        onPress={() => {
                          if (!match) return;
                          setQueueOpen(false);
                          openMatch(match.id);
                        }}
                        disabled={!match}
                        hitSlop={{ top: 10, bottom: 10 }}
                        accessibilityRole={match ? 'button' : undefined}
                        accessibilityLabel={
                          match
                            ? `查看 ${teamName(match.h)} 对 ${teamName(match.a)}`
                            : undefined
                        }
                        style={({ pressed }) => [styles.queueText, pressed && styles.pressed]}
                      >
                        <Text style={styles.queueTitle} numberOfLines={1}>
                          {match
                            ? `${teamName(match.h)} vs ${teamName(match.a)}`
                            : '比赛数据已移除'}
                        </Text>
                        <Text style={styles.queueMeta}>
                          {match
                            ? `${leagueName(match.l)} · ${
                                match.tbd ? '时间待定' : hm(match.t)
                              } · 已看过`
                            : `${item.id} · 已看过`}
                        </Text>
                      </Pressable>
                      {match ? (
                        <Pressable
                          onPress={() => toggleWatchLater(match)}
                          hitSlop={16}
                          accessibilityRole="button"
                          accessibilityLabel="恢复为待补看"
                        >
                          <Text style={styles.queueAction}>重新补看</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() => removeWatchLater(item.id)}
                        hitSlop={16}
                        accessibilityRole="button"
                        accessibilityLabel="移除补看"
                      >
                        <Text style={styles.queueRemove}>移除</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </>
        )}
      </Sheet>

      <SeasonReportModal
        open={seasonReportOpen}
        diary={diary}
        prefs={prefs}
        revealedIds={revealedList}
        onClose={() => setSeasonReportOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
    minHeight: 44,
  },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: weight.title, letterSpacing: 0.3 },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(245,185,66,0.25)',
  },
  profileText: { flex: 1, gap: 2 },
  profileName: { color: colors.text, fontSize: fontSize.lg, fontWeight: weight.title },
  profileSub: { color: colors.textMuted, fontSize: fontSize.sm },
  section: { gap: spacing.sm },
  cardGap: { gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.hairline },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  queueText: { flex: 1, gap: 2 },
  queueTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: weight.title },
  queueMeta: { color: colors.textFaint, fontSize: fontSize.xs },
  queueAction: { color: colors.accent, fontSize: fontSize.xs, fontWeight: weight.title, flexShrink: 0 },
  queueRemove: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: weight.title, flexShrink: 0 },
  queueFootnote: { color: colors.textFaint, fontSize: fontSize.xs },
  queueSectionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: weight.label,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  allText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: weight.label },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm },
  dataRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 6, height: 6, borderRadius: radius.pill },
  dataText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm },
  dataMeta: { color: colors.textFaint, fontSize: fontSize.xs },
  error: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 17 },
  syncButton: { minHeight: 44 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  linkRowLast: { borderBottomWidth: 0 },
  linkText: { flex: 1, gap: 1 },
  linkName: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.title },
  linkNote: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 16 },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  footer: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    textAlign: 'center',
    paddingTop: spacing.sm,
  },
  pressed: { opacity: 0.75 },
});
