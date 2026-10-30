import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getMorningDigest } from '@core/morning.js';
import type { WatchLaterItem } from '@/state/queue';

const KEY = 'nightowl:morningDigest:v1';

type Prefs = {
  sleepEnabled: boolean;
  sleepWakeTime: string;
};

export function useMorningDigest(
  items: WatchLaterItem[],
  fixtures: any[],
  now: number,
  prefs: Prefs,
  enabled = true
) {
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then(raw => {
        if (!alive || !raw) return;
        const saved = JSON.parse(raw) as { night?: string };
        if (typeof saved?.night === 'string') setDismissed(saved.night);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const autoDigest = useMemo(
    () => getMorningDigest(items, fixtures, now, prefs.sleepWakeTime),
    [items, fixtures, now, prefs.sleepWakeTime]
  );
  const allDigest = useMemo(
    () => getMorningDigest(items, fixtures, now, prefs.sleepWakeTime, { force: true }),
    [items, fixtures, now, prefs.sleepWakeTime]
  );

  useEffect(() => {
    if (!enabled || !loaded || !prefs.sleepEnabled || visible) return;
    if (!autoDigest.canShow || dismissed === autoDigest.night) return;
    setVisible(true);
  }, [enabled, loaded, prefs.sleepEnabled, visible, autoDigest, dismissed]);

  const close = useCallback(() => {
    const night = allDigest.night;
    setVisible(false);
    setDismissed(night);
    dismissedRef.current = night;
    void AsyncStorage.setItem(KEY, JSON.stringify({ night })).catch(() => {});
  }, [allDigest.night]);

  return {
    visible,
    items: allDigest.items,
    open: () => setVisible(true),
    close,
  };
}
