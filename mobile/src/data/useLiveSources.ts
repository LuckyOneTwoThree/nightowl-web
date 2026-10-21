import { useCallback, useEffect, useState } from 'react';

import type { Match } from '@/types';

import { getLiveSourcesForMatch } from './scraper.js';

export type StreamLine = {
  id: string;
  name: string;
  rawName?: string;
  url: string;
  kind: string;
  isDirect: boolean;
};

export type LiveSourcesData = {
  ok: boolean;
  lines: StreamLine[];
  matched: boolean;
  gameTitle?: string | null;
  statusText?: string | null;
  isLive?: boolean;
  scrapeError?: string | null;
  matchAmbiguous?: boolean;
  matchCandidates?: number;
};

export function useLiveSources(match: Match | null, enabled: boolean) {
  const [data, setData] = useState<LiveSourcesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matchId = match?.id;

  const load = useCallback(
    async (force = false) => {
      if (!match) return;
      setLoading(true);
      setError(null);
      try {
        const result = (await getLiveSourcesForMatch({
          matchId: match.id,
          h: match.h,
          a: match.a,
          date: match.t.slice(0, 10),
          t: match.t,
          force,
        })) as LiveSourcesData;
        setData(result);
        if (result?.scrapeError) setError(result.scrapeError);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [matchId, match?.h, match?.a, match?.t]
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
