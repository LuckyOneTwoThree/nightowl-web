import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import {
  Bell,
  ChevronRight,
  EyeOff,
  Info,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react-native';

import { FOLLOWABLE_LEAGUES, leagueName, teamName } from '@data/index.js';
import { bjClock, bjDate } from '@core/format.js';
import watchSources from '../../shared/server/watch-sources.json';
import { freshnessOf } from '@/data/fixtures';
import { syncNow } from '@/data/sync/run';
import { useSyncState } from '@/data/sync/useSync';
import { animateLayout } from '@/lib/layoutAnimation';
import { useNow } from '@/lib/useNow';
import { useAppStore, useDataRev } from '@/state/app';
import {
  notificationsAvailable,
  requestNotificationPermission,
  scheduleTestNotification,
  syncPrematchReminders,
} from '@/lib/reminders';
import { usePrefs, usePrefsStore } from '@/state/prefs';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import { getFixtures } from '@data/index.js';

const BUDGETS = [0, 1, 2, 3, 4, 5, 6, 8];

export default function MeScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const rev = useDataRev();
  const now = useNow(60_000);
  const source = useAppStore(state => state.source);
  const { syncing, quickSyncing, syncError, lastCheckedAt } = useSyncState();
  const setPrefs = usePrefsStore(state => state.setPrefs);
  const toggleLeague = usePrefsStore(state => state.toggleLeague);
  const setBudget = usePrefsStore(state => state.setBudget);
  const restartOnboarding = usePrefsStore(state => state.restartOnboarding);
  const [notificationPermission, setNotificationPermission] = useState<
    'unknown' | 'granted' | 'denied'
  >('unknown');
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!notificationsAvailable()) return undefined;
    let cancelled = false;
    import('expo-notifications')
      .then(N => N.getPermissionsAsync())
      .then(permission => {
        if (!cancelled) {
          setNotificationPermission(permission.granted ? 'granted' : 'denied');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const freshness = useMemo(
    () => freshnessOf(getFixtures(), now, source),
    [now, source, rev]
  );
  const pendingSplit = useMemo(() => {
    const stale = Number(freshness.stalePendingCount || 0);
    return { stale, recent: Math.max(0, freshness.pendingCount - stale) };
  }, [freshness]);

  const runSync = useCallback(async () => {
    try {
      await syncNow();
    } catch {
      // 错误由 syncError 展示
    }
  }, []);

  // 下拉只快检；完整同步仍然只由「立即同步」按钮触发。
  const quickRefresh = useCallback(async () => {
    try {
      await syncNow({ quick: true });
    } catch {
      // 错误由 syncError 展示
    }
  }, []);

  const version = Constants.expoConfig?.version ?? '0.1.0';
  const followedTeamNames = prefs.followedTeams.map(id => ({ id, name: teamName(id) }));
  const visibleTeamNames = followedTeamNames.slice(0, 12);
  const hiddenTeamCount = Math.max(0, followedTeamNames.length - visibleTeamNames.length);

  return (
    <Screen scroll onRefresh={quickRefresh} refreshing={syncing || quickSyncing}>
      <View style={styles.header}>
        <Text style={styles.title}>我的</Text>
        <Text style={styles.subline}>个人观赛档案与数据服务</Text>
      </View>

      <Card style={styles.profile}>
        <View style={styles.profileTop}>
          <Image
            source={require('../../../assets/brand/logo.png')}
            style={styles.logo}
            contentFit="cover"
            accessibilityLabel="夜猫看台"
          />
          <View style={styles.profileText}>
            <Text style={styles.profileName}>夜猫看台</Text>
            <Text style={styles.profileSub}>
              关注 {prefs.followedTeams.length} 支球队 · 每周 {prefs.weeklyBudget}h
            </Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <Stat label="关注球队" value={String(prefs.followedTeams.length)} />
          <Stat label="关注联赛" value={String(prefs.followedLeagues.length)} />
          <Stat label="每周预算" value={`${prefs.weeklyBudget}h`} />
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader
          title="关注偏好"
          actionLabel="管理球队"
          onAction={() => router.push('/team-picker')}
        />
        <Card style={styles.cardGap}>
          <View style={styles.block}>
            <View style={styles.blockTitleRow}>
              <UsersRound size={15} color={colors.textMuted} />
              <Text style={styles.blockTitle}>关注球队</Text>
            </View>
            {followedTeamNames.length > 0 ? (
              <View style={styles.chips}>
                {visibleTeamNames.map(team => (
                  <Chip
                    key={team.id}
                    icon={<Crest id={team.id} size={14} />}
                    onPress={() =>
                      router.push({ pathname: '/team/[id]', params: { id: team.id } })
                    }
                  >
                    {team.name}
                  </Chip>
                ))}
                {hiddenTeamCount > 0 ? (
                  <Chip onPress={() => router.push('/team-picker')}>
                    +{hiddenTeamCount} 支
                  </Chip>
                ) : null}
              </View>
            ) : (
              <Text style={styles.emptyText}>还没有关注球队，点右上角管理添加。</Text>
            )}
          </View>

          <View style={styles.divider} />

          <View style={styles.block}>
            <View style={styles.blockTitleRow}>
              <SlidersHorizontal size={15} color={colors.textMuted} />
              <Text style={styles.blockTitle}>关注联赛</Text>
              <Text style={styles.blockHint}>+8 指数</Text>
            </View>
            <View style={styles.chips}>
              {FOLLOWABLE_LEAGUES.map(code => (
                <Chip
                  key={code}
                  selected={prefs.followedLeagues.includes(code)}
                  onPress={() => toggleLeague(code)}
                >
                  {leagueName(code)}
                </Chip>
              ))}
            </View>
            <Text style={styles.hint}>
              全选 6 个联赛时 +8 加成为 0；建议只选真正会熬夜看的 2–4 个。
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.block}>
            <View style={styles.blockTitleRow}>
              <Bell size={15} color={colors.textMuted} />
              <Text style={styles.blockTitle}>每周睡眠预算</Text>
            </View>
            <View style={styles.chips}>
              {BUDGETS.map(hours => (
                <Chip
                  key={hours}
                  selected={prefs.weeklyBudget === hours}
                  onPress={() => setBudget(hours)}
                >
                  {hours}h
                </Chip>
              ))}
            </View>
            <Text style={styles.hint}>背包最多 5 场；零成本 S0 场次不占额度。</Text>
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="观赛规则" />
        <Card style={styles.cardGap}>
          <SettingSwitch
            icon={<EyeOff size={16} color={colors.textMuted} />}
            label="防剧透"
            hint="已结束比分默认隐藏，点开才揭晓"
            value={prefs.spoilerFree}
            onValueChange={value => setPrefs({ spoilerFree: value })}
          />
          <View style={styles.divider} />
          <SettingSwitch
            icon={<Bell size={16} color={colors.textMuted} />}
            label="赛前 15 分钟提醒"
            hint="安装版生效；首次开启会请求系统通知权限"
            value={prefs.notifyBefore15}
            onValueChange={value => {
              if (!value) {
                setPrefs({ notifyBefore15: false });
                return;
              }
              if (!notificationsAvailable()) {
                setPrefs({ notifyBefore15: true });
                return;
              }
              void (async () => {
                const granted = await requestNotificationPermission();
                setNotificationPermission(granted ? 'granted' : 'denied');
                setPrefs({ notifyBefore15: granted });
                if (granted) {
                  await syncPrematchReminders(usePrefsStore.getState().prefs);
                }
              })();
            }}
          />
          {notificationPermission === 'denied' ? (
            <View style={styles.permissionRow}>
              <Text style={styles.permissionWarning}>通知权限被拒绝，赛前提醒不会触发。</Text>
              <Pressable onPress={() => void Linking.openSettings()} hitSlop={8}>
                <Text style={styles.permissionLink}>去设置</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.divider} />
          <SettingSwitch
            icon={<Radio size={16} color={colors.textMuted} />}
            label="进球 / 红牌提醒"
            hint="仅应用在前台时生效；后台推送需要服务端"
            value={prefs.notifyLiveEvents}
            onValueChange={value => setPrefs({ notifyLiveEvents: value })}
          />
          {notificationsAvailable() ? (
            <>
              <View style={styles.divider} />
              <Pressable
                onPress={() => {
                  void (async () => {
                    const ok = await scheduleTestNotification();
                    Alert.alert(
                      ok ? '测试通知已排程' : '未能排程',
                      ok
                        ? '10 秒后应收到通知；点击通知会回到比赛详情。'
                        : '请先在系统设置中允许夜猫看台发送通知。'
                    );
                  })();
                }}
                style={({ pressed }) => [styles.testRow, pressed && styles.pressed]}
              >
                <View style={styles.settingIcon}>
                  <Bell size={16} color={colors.textMuted} />
                </View>
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>测试通知（10 秒）</Text>
                  <Text style={styles.settingHint}>验证通知权限、渠道与深链是否正常</Text>
                </View>
                <ChevronRight size={16} color={colors.textFaint} />
              </Pressable>
            </>
          ) : null}
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="数据与服务" />
        <Card style={styles.cardGap}>
          <InfoRow
            label="数据来源"
            value={source === 'stored' ? '本地同步数据' : '内置快照'}
          />
          <InfoRow
            label="上次检查"
            value={
              lastCheckedAt
                ? `${bjDate(lastCheckedAt)} ${bjClock(lastCheckedAt, false)}`
                : '尚未同步'
            }
          />
          <InfoRow label="待录比分" value={`${pendingSplit.recent} 场`} />
          {pendingSplit.stale > 0 && (
            <InfoRow label="上游未提供" value={`${pendingSplit.stale} 场`} />
          )}
          <InfoRow label="进行中" value={`${freshness.liveCount} 场`} />
          <InfoRow
            label="最近比分"
            value={
              freshness.lastScoreAt
                ? bjDate(Date.parse(freshness.lastScoreAt))
                : '暂无'
            }
          />
          {syncError ? <Text style={styles.error}>{syncError}</Text> : null}
          <Button
            label={syncing ? '正在同步…' : '立即同步'}
            variant="secondary"
            loading={syncing}
            onPress={runSync}
            style={styles.syncButton}
          />
          <Text style={styles.hint}>
            应用启动、回前台与下拉刷新会自动同步；移动端没有后台定时任务。
          </Text>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="更多"
          actionLabel={showMore ? '收起' : '展开'}
          onAction={() => {
            animateLayout();
            setShowMore(value => !value);
          }}
        />
        {showMore ? (
          <>
      <View style={styles.section}>
        <SectionHeader title="官方平台" />
        <Card style={styles.cardGap}>
          {(watchSources.official || []).map(sourceItem => (
            <Pressable
              key={sourceItem.id}
              onPress={() => {
                if (sourceItem.homeUrl) void Linking.openURL(sourceItem.homeUrl);
              }}
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            >
              <View style={styles.linkText}>
                <Text style={styles.linkName}>{sourceItem.name}</Text>
                <Text style={styles.linkNote} numberOfLines={1}>
                  {sourceItem.note || '官方平台入口'}
                </Text>
              </View>
              <ChevronRight size={16} color={colors.textFaint} />
            </Pressable>
          ))}
          <Text style={styles.hint}>
            App 不代理、不下载任何视频；直播与回放入口由官方平台提供。
          </Text>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="关于" />
        <Card style={styles.cardGap}>
          <InfoRow label="版本" value={version} />
          <InfoRow label="算法" value="与桌面端共用同一份 core" />
          <InfoRow label="数据" value="ESPN / openfootball / TheSportsDB" />
          <Pressable
            onPress={() => {
              restartOnboarding();
              router.push('/onboarding');
            }}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <View style={styles.linkInline}>
              <RotateCcw size={16} color={colors.textMuted} />
              <Text style={styles.linkName}>重新运行引导</Text>
            </View>
            <ChevronRight size={16} color={colors.textFaint} />
          </Pressable>
          <View style={styles.aboutNote}>
            <Info size={14} color={colors.textFaint} />
            <Text style={styles.aboutText}>
              比赛数据、球队名称与队徽版权归各自权利人所有。本项目仅用于个人学习与技术研究。
            </Text>
          </View>
        </Card>
      </View>

          </>
        ) : null}
      </View>

      <Text style={styles.footer}>夜猫看台 · Android 移动端 · v{version}</Text>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function SettingSwitch({
  icon,
  label,
  hint,
  value,
  onValueChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIcon}>{icon}</View>
      <View style={styles.settingText}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.control, true: colors.accent }}
        thumbColor={value ? colors.accentInk : colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xs },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800', letterSpacing: 0.3 },
  subline: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 2 },
  profile: { gap: spacing.md },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(245,185,66,0.25)',
  },
  profileText: { flex: 1, gap: 2 },
  profileName: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  profileSub: { color: colors.textMuted, fontSize: fontSize.sm },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statLabel: { color: colors.textFaint, fontSize: fontSize.xs },
  section: { gap: spacing.sm },
  cardGap: { gap: spacing.md },
  block: { gap: spacing.sm },
  blockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  blockTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  blockHint: { marginLeft: 'auto', color: colors.textFaint, fontSize: fontSize.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm },
  divider: { height: 1, backgroundColor: colors.hairline },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  settingHint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  infoValue: {
    maxWidth: '62%',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  error: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 17 },
  syncButton: { height: 44 },
  testRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  permissionWarning: {
    flex: 1,
    color: colors.warn,
    fontSize: fontSize.xs,
    lineHeight: 17,
  },
  permissionButton: { minHeight: 32, justifyContent: 'center' },
  permissionLink: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  linkText: { flex: 1, gap: 1 },
  linkInline: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  linkName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  linkNote: { color: colors.textFaint, fontSize: fontSize.xs },
  aboutNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    padding: spacing.md,
  },
  aboutText: { flex: 1, color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  footer: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    textAlign: 'center',
    paddingTop: spacing.sm,
  },
  pressed: { opacity: 0.75 },
});
