import { useEffect, useState } from 'react';

import { loadStoredFixtures } from '@/data/fixtures';
import { usePrefsHydrated } from '@/state/prefs';

export function useBootstrap(): boolean {
  const hydrated = usePrefsHydrated();
  const [fixturesReady, setFixturesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadStoredFixtures().finally(() => {
      if (!cancelled) setFixturesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return hydrated && fixturesReady;
}
