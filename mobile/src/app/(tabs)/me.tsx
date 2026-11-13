import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { Image } from 'expo-image';
import {
  Bell,
  ChevronRight,
  MoonStar,
  EyeOff,
  Info,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react-native';

import { FOLLOWABLE_LEAGUES, leagueName, teamName } from '@data/index.js';
import { bjClock, bjDate, hm } from '@core/format.js';
import watchSources from '../../shared/server/watch-sources.json';
import { freshnessOf } from '@/data/fixtures';
import { syncNow } from '@/data/sync/run';
import { queueWithMatches } from '@core/queue.js';
import { useWatchLaterStore } from '@/state/queue';
import { useMorningDigestStore } from '@/state/morningDigest';
import { useSyncState } from '@/data/sync/useSync';
import { animateLayout } from '@/lib/layoutAnimation';
import { openExternal } from '@/lib/openExternal';
import { useNow } from '@/lib/useNow';
import { useAppStore, useDataRev } from '@/state/app';
import {
  cancelAllMatchReminders,
  getNotificationPermissionStatus,
  type NotificationPermissionState,
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
import { colors, fontSize, radius, spacing, weight } from '@/ui/theme';
import { WEEKLY_BUDGET_OPTIONS as BUDGETS } from '@/ui/budgetOptions';
import { getFixtures } from '@data/index.js';

export default function MeScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const rev = useDataRev();
  const watchLaterItems = useWatchLaterStore(state => state.items);
  const removeWatchLater = useWatchLaterStore(state => state.remove);
  const markWatchLaterWatched = useWatchLaterStore(state => state.markWatched);
  const toggleWatchLater = useWatchLaterStore(state => state.toggle);
  const queueEntries = useMemo(
    () => queueWithMatches(watchLaterItems, getFixtures(), Date.now(), { includeWatched: true }),
    [watchLaterItems, rev]
  );
  const pendingQueueEntries = queueEntries.filter(entry => entry.item.status === 'pending');
  const watchedQueueEntries = queueEntries.filter(entry => entry.item.status === 'watched');
  const now = useNow(60_000);
  const requestMorningDigest = useMorningDigestStore(state => state.requestOpen);
  const source = useAppStore(state => state.source);
  const { syncing, syncError, lastCheckedAt } = useSyncState();
  const setPrefs = usePrefsStore(state => state.setPrefs);
  const toggleLeague = usePrefsStore(state => state.toggleLeague);
  const setBudget = usePrefsStore(state => state.setBudget);
  const restartOnboarding = usePrefsStore(state => state.restartOnboarding);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>('unavailable');
  const [showMore, setShowMore] = useState(false);
  const [quickPulling, setQuickPulling] = useState(false);

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
    setQuickPulling(true);
    try {
      await syncNow({ quick: true });
    } catch {
      // 错误由 syncError 展示
    } finally {
      setQuickPulling(false);
    }
  }, []);

  const adjustWake = (deltaMinutes: number) => {
    setPrefs({ sleepWakeTime: formatWakeMinutes(parseWakeMinutes(prefs.sleepWakeTime) + deltaMinutes) });
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

  return (
    <Screen scroll onRefresh={quickRefresh} refreshing={syncing || quickPulling}>
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
              {prefs.sleepEnabled
                ? ` · ${prefs.sleepWakeTime || '07:30'} 起${
                    prefs.sleepWeekendEnabled
                      ? ` / 周末 ${prefs.sleepWeekendWakeTime || '09:00'}`
                      : ''
                  }`
                : ''}
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
                void cancelAllMatchReminders();
                return;
              }
              if (!notificationsAvailable()) {
                setPrefs({ notifyBefore15: true });
                return;
              }
              void (async () => {
                const granted = await requestNotificationPermission();
                const status = await getNotificationPermissionStatus();
                setNotificationPermission(granted ? 'granted' : status);
                setPrefs({ notifyBefore15: granted });
                if (granted) {
                  await syncPrematchReminders(usePrefsStore.getState().prefs);
                }
              })();
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
              <Pressable
                onPress={() => {
                  void (async () => {
                    const granted = await requestNotificationPermission();
                    const status = await getNotificationPermissionStatus();
                    setNotificationPermission(granted ? 'granted' : status);
                    setPrefs({ notifyBefore15: granted });
                    if (granted) {
                      await syncPrematchReminders(usePrefsStore.getState().prefs);
                    }
                  })();
                }}
                hitSlop={16}
              >
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
        <SectionHeader title="个人睡眠" />
        <Card style={styles.cardGap}>
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
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="明早补看" actionLabel="看摘要" onAction={requestMorningDigest} />
        <Card style={styles.cardGap}>
          {queueEntries.length === 0 ? (
            <Text style={styles.emptyText}>还没有加入补看。可在比赛详情点「明早补看」。</Text>
          ) : (
            <>
              {pendingQueueEntries.length === 0 ? (
                <Text style={styles.emptyText}>待看已清空，已看过的场次仍在下面。</Text>
              ) : (
                pendingQueueEntries.map(({ item, match }) => (
                  <View key={item.id} style={styles.queueRow}>
                    <Pressable
                      onPress={() =>
                        match &&
                        router.push({ pathname: '/match/[id]', params: { id: match.id } })
                      }
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
                ))
              )}
              {watchedQueueEntries.length > 0 ? (
                <>
                  <Text style={styles.queueSectionLabel}>已看过 {watchedQueueEntries.length} 场</Text>
                  {watchedQueueEntries.map(({ item, match }) => (
                    <View key={item.id} style={styles.queueRow}>
                      <Pressable
                        onPress={() =>
                          match &&
                          router.push({ pathname: '/match/[id]', params: { id: match.id } })
                        }
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
                            ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)} · 已看过`
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
                  ))}
                </>
              ) : null}
            </>
          )}
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
                if (sourceItem.homeUrl) void openExternal(sourceItem.homeUrl, sourceItem.name);
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
  header: { paddingTop: spacing.xs },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: weight.title, letterSpacing: 0.3 },
  subline: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 2 },
  profile: { gap: spacing.md },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { color: colors.textFaint, fontSize: fontSize.xs },
  section: { gap: spacing.sm },
  cardGap: { gap: spacing.md },
  block: { gap: spacing.sm },
  blockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  blockTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.title },
  blockHint: { marginLeft: 'auto', color: colors.textFaint, fontSize: fontSize.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  queueSectionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: weight.label,
    marginTop: spacing.sm,
  },
  queueText: { flex: 1, gap: 2 },
  queueTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: weight.title },
  queueMeta: { color: colors.textFaint, fontSize: fontSize.xs },
  queueAction: { color: colors.accent, fontSize: fontSize.xs, fontWeight: weight.title },
  queueRemove: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: weight.title },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm },
  divider: { height: 1, backgroundColor: colors.hairline },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
  sleepStepText: { color: colors.textSecondary, fontSize: fontSize.lg, fontWeight: weight.title, lineHeight: 20 },
  sleepStepValue: {
    minWidth: 48,
    textAlign: 'center',
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
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
  permissionLink: { color: colors.accent, fontSize: fontSize.xs, fontWeight: weight.title },
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
  linkName: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.title },
  linkNote: { color: colors.textFaint, fontSize: fontSize.xs },
  aboutNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.card,
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
