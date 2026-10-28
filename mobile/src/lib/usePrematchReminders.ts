import { useEffect } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { nightOf } from '@core/engine.js';

import { usePrefs } from '@/state/prefs';
import { useDataRev } from '@/state/app';
import { useNow } from '@/lib/useNow';

import { notificationsAvailable, syncPrematchReminders } from './reminders';

type NotificationResponseLike = {
  notification: {
    request: {
      identifier: string;
      content: { data?: Record<string, unknown> };
    };
  };
};

export function usePrematchReminders() {
  const prefs = usePrefs();
  const rev = useDataRev();
  const now = useNow(60_000);
  const night = nightOf(now);
  const teamsKey = prefs.followedTeams.join(',');
  const leaguesKey = prefs.followedLeagues.join(',');

  useEffect(() => {
    if (!notificationsAvailable()) return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void syncPrematchReminders(prefs);
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [teamsKey, leaguesKey, prefs.notifyBefore15, rev, night]);

  // 跨夜/回前台：hero 可能已经换人，必须重算提醒。不能只依赖 rev（没有新补丁时 rev 不变）。
  useEffect(() => {
    if (!notificationsAvailable()) return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void syncPrematchReminders(prefs);
    });
    return () => subscription.remove();
  }, [teamsKey, leaguesKey, prefs.notifyBefore15]);

  useEffect(() => {
    if (!notificationsAvailable()) return undefined;

    let disposed = false;
    let subscription: { remove: () => void } | null = null;
    const handled = new Set<string>();

    const openMatch = (response: NotificationResponseLike | null) => {
      if (!response) return;
      const request = response.notification.request;
      if (handled.has(request.identifier)) return;
      handled.add(request.identifier);
      const matchId = request.content.data?.matchId;
      if (typeof matchId === 'string') {
        router.push({ pathname: '/match/[id]', params: { id: matchId } });
      }
    };

    import('expo-notifications')
      .then(Notifications => {
        if (disposed) return;
        subscription = Notifications.addNotificationResponseReceivedListener(response =>
          openMatch(response as unknown as NotificationResponseLike)
        );
        Notifications.getLastNotificationResponseAsync()
          .then(response =>
            openMatch(response as unknown as NotificationResponseLike | null)
          )
          .catch(() => {});
      })
      .catch(() => {});

    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, []);
}
