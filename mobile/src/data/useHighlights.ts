import { useCallback, useEffect, useState } from 'react';

import rules from '../shared/server/rules.json';
import type { Match } from '@/types';

import { resolveHighlights } from './highlights.js';

export type HighlightVideo = {
  id: string;
  title: string;
  eventName: string;
  url: string;
  provider: string;
};

export type HighlightsData = {
  ok: boolean;
  videos: HighlightVideo[];
  reason?: string;
  cached?: boolean;
  fetchedAt?: string;
  source?: string;
};

export function useHighlights(match: Match | null, enabled: boolean) {
  const [data, setData] = useState<HighlightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matchId = match?.id;

  const load = useCallback(
    async (force = false) => {
      if (!match) return;
      setLoading(true);
      setError(null);
      try {
        const result = (await resolveHighlights(match, {
          rules,
          force,
        })) as HighlightsData;
        setData(result);
        if (!result?.ok) setError(result?.reason || 'highlights-unavailable');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [matchId, match?.l, match?.r, match?.t, match?.h, match?.a]
  );

  useEffect(() => {
    if (!enabled || !match) return;
    void load(false);
  }, [enabled, matchId, load]);

  return {
    data,
    loading,
    error,
    reload: () => load(true),
  };
}
