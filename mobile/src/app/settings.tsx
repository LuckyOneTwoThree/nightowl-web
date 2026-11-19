import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Info,
  MoonStar,
  Radio,
  RotateCcw,
  UsersRound,
} from 'lucide-react-native';

import { FOLLOWABLE_LEAGUES, getFixtures, leagueName, teamName } from '@data/index.js';
import { bjClock, bjDate } from '@core/format.js';
import { freshnessOf } from '@/data/fixtures';
import { syncNow } from '@/data/sync/run';
import { useSyncState } from '@/data/sync/useSync';
import { useAppStore, useDataRev } from '@/state/app';
import { useNow } from '@/lib/useNow';
import {
  cancelPrematchReminders,
  getNotificationPermissionStatus,
  type NotificationPermissionState,
  notificationsAvailable,
  requestNotificationPermission,
  scheduleTestNotification,
  syncPrematchReminders,
} from '@/lib/reminders';
import { usePrefs, usePrefsStore } from '@/state/prefs';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { Fold } from '@/ui/Fold';
import { Screen } from '@/ui/Screen';
import { colors, fontSize, radius, spacing, weight } from '@/ui/theme';
import { WEEKLY_BUDGET_OPTIONS as BUDGETS } from '@/ui/budgetOptions';

/**
 * 设置页。
 *
 * 「我的」只保留身份、明早补看、战报与数据状态；所有一次性配置集中到这里，
 * 每组默认收起并用一行摘要说明当前值 —— 一屏能看完所有分组，而不是一屏只看得到两组开关。
 */
export default function SettingsScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const rev = useDataRev();
  const now = useNow(60_000);
  const source = useAppStore(state => state.source);
  const setPrefs = usePrefsStore(state => state.setPrefs);
  const toggleLeague = usePrefsStore(state => state.toggleLeague);
  const setBudget = usePrefsStore(state => state.setBudget);
  const restartOnboarding = usePrefsStore(state => state.restartOnboarding);
  const { syncing, syncError, lastCheckedAt } = useSyncState();
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>('unavailable');

  useEffect(() => {
    if (!notificationsAvailable()) return undefined;
    let cancelled = false;
    const check = () => {
      void getNotificationPermissionStatus().then(status => {
        if (!cancelled) {
          setNotificationPermission(status);
        }
      });
    };
    check();
    // 从系统设置授权后返回，权限事实已经变化；只在挂载时查一次会一直停在旧的「被拒绝」。
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rev 是数据修订触发器；body 读模块级 fixtures
  const freshness = useMemo(
    () => freshnessOf(getFixtures(), now, source),
    [now, source, rev]
  );
  const pendingSplit = useMemo(() => {
    const stale = Number(freshness.stalePendingCount || 0);
    return { stale, recent: Math.max(0, freshness.pendingCount - stale) };
  }, [freshness]);

  const runSync = async () => {
    try {
      await syncNow();
    } catch {
      // 错误由 syncError 展示
    }
  };

  const requestNotification = async () => {
    const granted = await requestNotificationPermission();
    const status = await getNotificationPermissionStatus();
    setNotificationPermission(granted ? 'granted' : status);
    setPrefs({ notifyBefore15: granted });
    if (granted) {
      await syncPrematchReminders(usePrefsStore.getState().prefs);
    }
  };

  const adjustWake = (deltaMinutes: number) => {
    setPrefs({
      sleepWakeTime: formatWakeMinutes(parseWakeMinutes(prefs.sleepWakeTime) + deltaMinutes),
    });
  };
  const adjustWeekendWake = (deltaMinutes: number) => {
    setPrefs({
      sleepWeekendWakeTime: formatWakeMinutes(
        parseWakeMinutes(prefs.sleepWeekendWakeTime || '09:00') + deltaMinutes
      ),
    });
  };
  const adjustMinSleep = (deltaHours: number) => {
    const current = Number(prefs.sleepMinHours);
    const base = Number.isFinite(current) ? current : 7;
    const next = Math.min(10, Math.max(4, base + deltaHours));
    setPrefs({ sleepMinHours: Math.round(next * 2) / 2 });
  };

  const version = Constants.expoConfig?.version ?? '0.1.0';
  const followedTeamNames = prefs.followedTeams.map(id => ({ id, name: teamName(id) }));
  const visibleTeamNames = followedTeamNames.slice(0, 12);
  const hiddenTeamCount = Math.max(0, followedTeamNames.length - visibleTeamNames.length);
  const sourceLabel = source === 'stored' ? '本地同步数据' : '内置快照';
  const sleepSummary = prefs.sleepEnabled
    ? `${prefs.sleepWakeTime || '07:30'} 起${
        prefs.sleepWeekendEnabled
          ? ` / 周末 ${prefs.sleepWeekendWakeTime || '09:00'}`
          : ''
      } · 最低 ${Number(prefs.sleepMinHours ?? 7).toFixed(1)}h`
    : '未开启 · 默认关闭';

  return (
    <Screen scroll edges={['top', 'bottom']}>
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
          <Text style={styles.title}>设置</Text>
          <Text style={styles.subline}>偏好、提醒与数据服务</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <Fold
        size="base"
        title="关注偏好"
        summary={`${prefs.followedTeams.length} 支球队 · ${prefs.followedLeagues.length} 个联赛 · 每周 ${prefs.weeklyBudget}h`}
      >
        <Pressable
          onPress={() => router.push('/team-picker')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="管理关注球队"
        >
          <View style={styles.settingIcon}>
            <UsersRound size={16} color={colors.textMuted} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>管理关注球队</Text>
            <Text style={styles.settingHint}>
              已关注 {prefs.followedTeams.length} 支 · 点此增删
            </Text>
          </View>
          <ChevronRight size={16} color={colors.textFaint} />
        </Pressable>

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
              <Chip onPress={() => router.push('/team-picker')}>+{hiddenTeamCount} 支</Chip>
            ) : null}
          </View>
        ) : (
          <Text style={styles.emptyText}>还没有关注球队，点上方「管理关注球队」添加。</Text>
        )}

        <View style={styles.divider} />

        <View style={styles.block}>
          <Text style={styles.groupLabel}>关注联赛</Text>
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
          <Text style={styles.groupLabel}>每周睡眠预算</Text>
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
      </Fold>

      <Fold
        size="base"
        title="观赛规则"
        summary={`防剧透${prefs.spoilerFree ? '开' : '关'} · 赛前提醒${
          prefs.notifyBefore15 ? '开' : '关'
        } · 进球提醒${prefs.notifyLiveEvents ? '开' : '关'}`}
      >
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
              void cancelPrematchReminders();
              return;
            }
            if (!notificationsAvailable()) {
              setPrefs({ notifyBefore15: true });
              return;
            }
            void requestNotification();
          }}
        />
        {prefs.notifyBefore15 && notificationPermission === 'denied' ? (
          <View style={styles.permissionRow}>
            <Text style={styles.permissionWarning}>通知权限被拒绝，赛前提醒不会触发。</Text>
            <Pressable onPress={() => void Linking.openSettings()} hitSlop={16}>
              <Text style={styles.permissionLink}>去设置</Text>
            </Pressable>
          </View>
        ) : prefs.notifyBefore15 && notificationPermission === 'undetermined' ? (
          <View style={styles.permissionRow}>
            <Text style={styles.permissionWarning}>尚未授予系统通知权限，赛前提醒暂未生效。</Text>
            <Pressable onPress={() => void requestNotification()} hitSlop={16}>
              <Text style={styles.permissionLink}>去授权</Text>
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
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="测试通知"
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
        <Text style={styles.hint}>
          能力边界：手机端可设开球前 15 分钟与下半场 60&apos; 本地切入唤醒；实时悬念雷达受
          Android Doze 后台调度限制，仅桌面端常驻可用。
        </Text>
      </Fold>

      <Fold size="base" title="个人睡眠" summary={sleepSummary}>
        <SettingSwitch
          icon={<MoonStar size={16} color={colors.textMuted} />}
          label="启用睡眠账本"
          hint="按你的起床时间估算看完比赛后的剩余睡眠；默认关闭"
          value={prefs.sleepEnabled}
          onValueChange={value => setPrefs({ sleepEnabled: value })}
        />
        {prefs.sleepEnabled ? (
          <>
            <View style={styles.divider} />
            <SleepStepper
              label="起床时间"
              hint="按你的日常作息计算，不是设备时区"
              value={prefs.sleepWakeTime || '07:30'}
              onMinus={() => adjustWake(-30)}
              onPlus={() => adjustWake(30)}
            />
            <View style={styles.divider} />
            <SleepStepper
              label="最低睡眠"
              hint="低于这条线会在推荐与详情中明确提示"
              value={`${Number(prefs.sleepMinHours ?? 7).toFixed(1)}h`}
              onMinus={() => adjustMinSleep(-0.5)}
              onPlus={() => adjustMinSleep(0.5)}
            />
            <View style={styles.divider} />
            <SettingSwitch
              icon={<MoonStar size={16} color={colors.textMuted} />}
              label="周五 / 周六夜（次日周末）晚起"
              hint="次日不早起时按周末起床时间算睡眠底线"
              value={Boolean(prefs.sleepWeekendEnabled)}
              onValueChange={value => setPrefs({ sleepWeekendEnabled: value })}
            />
            {prefs.sleepWeekendEnabled ? (
              <>
                <View style={styles.divider} />
                <SleepStepper
                  label="周末起床时间"
                  hint="仅用于周五夜与周六夜的睡眠底线和止损提醒"
                  value={prefs.sleepWeekendWakeTime || '09:00'}
                  onMinus={() => adjustWeekendWake(-30)}
                  onPlus={() => adjustWeekendWake(30)}
                />
              </>
            ) : null}
          </>
        ) : null}
      </Fold>

      <Fold
        size="base"
        title="数据与服务"
        summary={`${sourceLabel} · 待录 ${freshness.pendingCount} 场`}
      >
        <InfoRow label="数据来源" value={sourceLabel} />
        <InfoRow
          label="上次检查"
          value={
            lastCheckedAt
              ? `${bjDate(lastCheckedAt)} ${bjClock(lastCheckedAt, false)}`
              : '尚未同步'
          }
        />
        <InfoRow label="待录比分" value={`${pendingSplit.recent} 场`} />
        {pendingSplit.stale > 0 ? (
          <InfoRow label="上游未提供" value={`${pendingSplit.stale} 场`} />
        ) : null}
        <InfoRow label="进行中" value={`${freshness.liveCount} 场`} />
        <InfoRow
          label="最近比分"
          value={
            freshness.lastScoreAt ? bjDate(Date.parse(freshness.lastScoreAt)) : '暂无'
          }
        />
        {syncError ? <Text style={styles.error}>{syncError}</Text> : null}
        <Button
          label={syncing ? '正在同步…' : '立即同步'}
          variant="secondary"
          loading={syncing}
          onPress={() => void runSync()}
          style={styles.syncButton}
        />
        <Text style={styles.hint}>
          应用启动、回前台与下拉刷新会自动同步；移动端没有后台定时任务。
        </Text>
      </Fold>

      <Fold size="base" title="关于与帮助" summary={`v${version} · 与桌面端共用同一份 core`}>
        <InfoRow label="版本" value={version} />
        <InfoRow label="算法" value="与桌面端共用同一份 core" />
        <InfoRow label="数据" value="ESPN / openfootball / TheSportsDB" />
        <Pressable
          onPress={() => {
            restartOnboarding();
            router.push('/onboarding');
          }}
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="重新运行引导"
        >
          <View style={styles.settingIcon}>
            <RotateCcw size={16} color={colors.textMuted} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>重新运行引导</Text>
            <Text style={styles.settingHint}>重新选择关注球队与作息</Text>
          </View>
          <ChevronRight size={16} color={colors.textFaint} />
        </Pressable>
        <View style={styles.aboutNote}>
          <Info size={14} color={colors.textFaint} />
          <Text style={styles.aboutText}>
            比赛数据、球队名称与队徽版权归各自权利人所有。本项目仅用于个人学习与技术研究。
          </Text>
        </View>
      </Fold>
    </Screen>
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

function parseWakeMinutes(value: string): number {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 7 * 60 + 30;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : 7 * 60 + 30;
}

function formatWakeMinutes(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function SleepStepper({
  label,
  hint,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  hint: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={styles.sleepRow}>
      <View style={styles.sleepLabelBlock}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingHint}>{hint}</Text>
      </View>
      <View style={styles.sleepStepper}>
        <Pressable
          onPress={onMinus}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${label}减少`}
          style={({ pressed }) => [styles.sleepStepButton, pressed && styles.pressed]}
        >
          <Text style={styles.sleepStepText}>−</Text>
        </Pressable>
        <Text style={styles.sleepStepValue}>{value}</Text>
        <Pressable
          onPress={onPlus}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${label}增加`}
          style={({ pressed }) => [styles.sleepStepButton, pressed && styles.pressed]}
        >
          <Text style={styles.sleepStepText}>+</Text>
        </Pressable>
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
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
  headerText: { flex: 1, gap: 1 },
  headerSpacer: { width: 38, height: 38 },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: weight.title },
  subline: { color: colors.textFaint, fontSize: fontSize.xs },
  block: { gap: spacing.sm },
  groupLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: weight.label },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm },
  divider: { height: 1, backgroundColor: colors.hairline },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.control,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.title },
  settingHint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 16 },
  sleepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  sleepLabelBlock: { flex: 1, gap: 2 },
  sleepStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sleepStepButton: {
    width: 32,
    minHeight: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  sleepStepText: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: weight.title,
    lineHeight: 20,
  },
  sleepStepValue: {
    minWidth: 48,
    textAlign: 'center',
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  infoLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  infoValue: {
    maxWidth: '62%',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  error: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 17 },
  syncButton: { minHeight: 44 },
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
  permissionLink: { color: colors.accent, fontSize: fontSize.xs, fontWeight: weight.title },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  aboutNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: colors.panel,
    padding: spacing.md,
  },
  aboutText: { flex: 1, color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  pressed: { opacity: 0.75 },
});
