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

async function runReminderSync(prefs: Prefs): Promise<ReminderResult> {
  if (!notificationsAvailable()) return { ok: false, reason: 'notifications-disabled' };

  try {
    const Notifications = await import('expo-notifications');
    await configure(Notifications);

    if (!prefs.notifyBefore15) {
      const existing = await Notifications.getAllScheduledNotificationsAsync();
      for (const item of existing) {
        const kind = item.content.data?.kind;
        if (kind === 'prematch' || kind === 'manual') {
          await Notifications.cancelScheduledNotificationAsync(item.identifier);
        }
      }
      return { ok: true, scheduled: 0 };
    }

    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'permission-denied' };

    const now = Date.now();
    const candidates = new Map<string, Match>();

    const hero = computeTonight(now, prefs).hero;
    if (hero?.m) candidates.set(hero.m.id, hero.m);

    const followed = new Set(prefs.followedTeams);
    for (const match of getFixtures() as Match[]) {
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

    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const manualMatchIds = new Set(
      existing
        .filter(item => item.content.data?.kind === 'manual')
        .map(item => item.content.data?.matchId)
        .filter((id): id is string => typeof id === 'string')
    );
    for (const item of existing) {
      if (item.content.data?.kind === 'prematch') {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }

    let scheduled = 0;
    for (const match of list) {
      // 手动提醒优先：不要再用自动提醒覆盖/重复同一场。
      if (manualMatchIds.has(match.id)) continue;
      const when = new Date(ts(match.t) - LEAD_MS);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `赛前 15 分钟提醒 · ${teamName(match.h)} vs ${teamName(match.a)}`,
          body: `${hm(match.t)} · ${leagueName(match.l)}${
            match.r ? ` 第 ${match.r} 轮` : ''
          }`,
          data: { matchId: match.id, kind: 'prematch' },
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
  try {
    const Notifications = await import('expo-notifications');
    await configure(Notifications);
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    const when = new Date(ts(match.t) - LEAD_MS);
    if (when.getTime() <= Date.now()) return false;

    // 幂等：同一场已经排过自动/手动提醒时，不重复追加。
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const already = existing.some(item => {
      const data = item.content.data || {};
      return data.matchId === match.id && (data.kind === 'prematch' || data.kind === 'manual');
    });
    if (already) return true;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `赛前 15 分钟提醒 · ${teamName(match.h)} vs ${teamName(match.a)}`,
        body: `${hm(match.t)} · ${leagueName(match.l)}${match.r ? ` 第 ${match.r} 轮` : ''}`,
        data: { matchId: match.id, kind: 'manual' },
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
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    return existing.some(item => {
      const data = item.content.data || {};
      return data.matchId === matchId && (data.kind === 'prematch' || data.kind === 'manual');
    });
  } catch {
    return false;
  }
}

export function syncPrematchReminders(prefs: Prefs): Promise<ReminderResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runReminderSync(prefs).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}
