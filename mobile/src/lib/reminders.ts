import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getFixtures, leagueName, teamName } from '@data/index.js';
import { computeTonight } from '@core/owl.js';
import { ts } from '@core/engine.js';
import { hm } from '@core/format.js';

import type { Prefs } from '@/state/prefs';
import type { Match } from '@/types';

const CHANNEL_ID = 'prematch';
const LEAD_MS = 15 * 60 * 1000;
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 30;

type NotificationsModule = typeof import('expo-notifications');
let handlerConfigured = false;
let syncInFlight: Promise<ReminderResult> | null = null;
let queuedPrefs: Prefs | null = null;

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export type ReminderResult = {
  ok: boolean;
  scheduled?: number;
  reason?: string;
};

export function notificationsAvailable(): boolean {
  const buildEnabled =
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_NOTIFICATIONS_ENABLED === '1';
  return buildEnabled && Constants.executionEnvironment !== 'storeClient';
}

async function configure(Notifications: NotificationsModule) {
  if (!handlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    handlerConfigured = true;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '赛前提醒',
      description: '开球前 15 分钟提醒，不包含比分',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#F5B942',
    });
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  if (!notificationsAvailable()) return 'unavailable';
  try {
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (current.status === 'undetermined' || (current.status !== 'denied' && current.canAskAgain)) {
      return 'undetermined';
    }
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  try {
    const Notifications = await import('expo-notifications');
    await configure(Notifications);
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

export async function cancelAllMatchReminders(): Promise<void> {
  if (!notificationsAvailable()) return;
  try {
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of existing) {
      const kind = item.content.data?.kind;
      if (kind === 'prematch' || kind === 'manual') {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
  } catch {
    // 忽略清理失败
  }
}

export async function cancelMatchReminder(matchId: string): Promise<boolean> {
  if (!notificationsAvailable() || !matchId) return false;
  try {
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of existing) {
      const data = item.content.data || {};
      if (data.matchId === matchId && (data.kind === 'prematch' || data.kind === 'manual')) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function runReminderSync(prefs: Prefs): Promise<ReminderResult> {
  if (!notificationsAvailable()) return { ok: false, reason: 'notifications-disabled' };

  try {
    const Notifications = await import('expo-notifications');
    await configure(Notifications);

    const now = Date.now();
    const fixtures = getFixtures() as Match[];
    const fixtureMap = new Map<string, Match>(fixtures.map(m => [m.id, m]));
    const existing = await Notifications.getAllScheduledNotificationsAsync();

    // 无论全局自动提醒开关是否开启，都先对已有的单场手动提醒做改期/失效校准：
    // 1. 比赛已完赛 / 延期 / 变更为 TBD -> 取消旧提醒
    // 2. 比赛改期（kickoff !== match.t） -> 取消旧提醒并按新开球时间重排
    const manualMatchIds = new Set<string>();
    for (const item of existing) {
      const data = item.content.data || {};
      if (data.kind !== 'manual') continue;
      const matchId = typeof data.matchId === 'string' ? data.matchId : '';
      const currentMatch = matchId ? fixtureMap.get(matchId) : undefined;
      if (!currentMatch || currentMatch.st !== 'sched' || currentMatch.tbd) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
        continue;
      }
      const nextWhenMs = ts(currentMatch.t) - LEAD_MS;
      if (!Number.isFinite(nextWhenMs) || nextWhenMs <= now) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
        continue;
      }
      if (data.kickoff !== currentMatch.t) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `赛前 15 分钟提醒 · ${teamName(currentMatch.h)} vs ${teamName(currentMatch.a)}`,
            body: `${hm(currentMatch.t)} · ${leagueName(currentMatch.l)}${
              currentMatch.r ? ` 第 ${currentMatch.r} 轮` : ''
            }`,
            data: { matchId: currentMatch.id, kind: 'manual', kickoff: currentMatch.t },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(nextWhenMs),
            channelId: CHANNEL_ID,
          },
        });
      }
      manualMatchIds.add(currentMatch.id);
    }

    if (!prefs.notifyBefore15) {
      for (const item of existing) {
        const kind = item.content.data?.kind;
        if (kind === 'prematch') {
          await Notifications.cancelScheduledNotificationAsync(item.identifier);
        }
      }
      return { ok: true, scheduled: 0 };
    }

    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'permission-denied' };

    const candidates = new Map<string, Match>();

    const hero = computeTonight(now, prefs).hero;
    if (hero?.m && hero.m.st === 'sched' && !hero.m.tbd) {
      candidates.set(hero.m.id, hero.m);
    }

    const followed = new Set(prefs.followedTeams);
    for (const match of fixtures) {
      if (match.st !== 'sched' || match.tbd) continue;
      const kickoff = ts(match.t);
      if (!Number.isFinite(kickoff)) continue;
      if (kickoff <= now || kickoff > now + HORIZON_MS) continue;
      if (!followed.has(match.h) && !followed.has(match.a)) continue;
      candidates.set(match.id, match);
    }

    const list = [...candidates.values()]
      .filter(match => ts(match.t) - LEAD_MS > now)
      .sort((a, b) => ts(a.t) - ts(b.t))
      .slice(0, MAX_REMINDERS);

    for (const item of existing) {
      if (item.content.data?.kind === 'prematch') {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }

    let scheduled = 0;
    for (const match of list) {
      // 手动提醒优先：已对齐到最新开球时间的手动提醒不再重复排程。
      if (manualMatchIds.has(match.id)) continue;
      const when = new Date(ts(match.t) - LEAD_MS);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `赛前 15 分钟提醒 · ${teamName(match.h)} vs ${teamName(match.a)}`,
          body: `${hm(match.t)} · ${leagueName(match.l)}${
            match.r ? ` 第 ${match.r} 轮` : ''
          }`,
          data: { matchId: match.id, kind: 'prematch', kickoff: match.t },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
          channelId: CHANNEL_ID,
        },
      });
      scheduled += 1;
    }

    return { ok: true, scheduled };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function scheduleTestNotification(
  matchId = 'PL-1-ARS-COV'
): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  try {
    const Notifications = await import('expo-notifications');
    await configure(Notifications);
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '测试通知 · 夜猫看台',
        body: '10 秒后触发，点击可回到比赛详情',
        data: { matchId, kind: 'test' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 10,
        channelId: CHANNEL_ID,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleMatchReminder(match: Match): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  if (!match || match.tbd || match.st !== 'sched') return false;
  try {
    const Notifications = await import('expo-notifications');
    await configure(Notifications);
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    const when = new Date(ts(match.t) - LEAD_MS);
    if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) return false;

    // 幂等且跟随改期：同一场若已有提醒但开球时间已变，先清掉旧提醒再按新时间重排。
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    let alreadyUpToDate = false;
    for (const item of existing) {
      const data = item.content.data || {};
      if (data.matchId === match.id && (data.kind === 'prematch' || data.kind === 'manual')) {
        if (data.kickoff === match.t) {
          alreadyUpToDate = true;
        } else {
          await Notifications.cancelScheduledNotificationAsync(item.identifier);
        }
      }
    }
    if (alreadyUpToDate) return true;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `赛前 15 分钟提醒 · ${teamName(match.h)} vs ${teamName(match.a)}`,
        body: `${hm(match.t)} · ${leagueName(match.l)}${match.r ? ` 第 ${match.r} 轮` : ''}`,
        data: { matchId: match.id, kind: 'manual', kickoff: match.t },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: CHANNEL_ID,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function hasScheduledMatchReminder(matchId: string): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  try {
    const match = (getFixtures() as Match[]).find(item => item.id === matchId);
    if (!match || match.tbd || match.st !== 'sched') return false;
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    return existing.some(item => {
      const data = item.content.data || {};
      return (
        data.matchId === matchId &&
        (data.kind === 'prematch' || data.kind === 'manual') &&
        (!data.kickoff || data.kickoff === match.t)
      );
    });
  } catch {
    return false;
  }
}

export function syncPrematchReminders(prefs: Prefs): Promise<ReminderResult> {
  if (syncInFlight) {
    queuedPrefs = prefs;
    return syncInFlight;
  }
  const runNext = (currentPrefs: Prefs): Promise<ReminderResult> =>
    runReminderSync(currentPrefs).then(result => {
      if (queuedPrefs) {
        const nextPrefs = queuedPrefs;
        queuedPrefs = null;
        return runNext(nextPrefs);
      }
      return result;
    });
  syncInFlight = runNext(prefs).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}
