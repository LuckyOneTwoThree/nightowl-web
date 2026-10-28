import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import rules from '../shared/server/rules.json';
import type { Match } from '@/types';

import { resolveLive } from './live.js';

export type LiveEvent = {
  clock: string;
  type: string;
  typeText: string;
  text: string;
  side: 'h' | 'a' | null;
};

export type LiveData = {
  ok: true;
  matchId: string;
  state: 'scheduled' | 'live' | 'halftime' | 'finished' | 'postponed';
  statusText: string;
  minuteLabel: string;
  score: { h: number | null; a: number | null };
  events: LiveEvent[];
  eventId?: string | null;
  source: string;
  updatedAt: string;
  warning?: string;
  cached?: boolean;
};

type LiveResult = LiveData | { ok: false; reason?: string; message?: string };

export function useLiveMatch(
  match: Match | null,
  enabled: boolean,
  intervalMs = 30_000
) {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const matchId = match?.id;
  const kickoff = match?.t;

  useEffect(() => {
    if (!enabled || !match) {
      setData(null);
      setError(null);
      setLastSuccessAt(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (AppState.currentState !== 'active') {
        timer = setTimeout(poll, 5000);
        return;
      }

      setLoading(true);
      try {
        const result = (await resolveLive(match, {
          rules,
          log: console,
        })) as LiveResult;

        if (cancelled) return;
        if (result?.ok) {
          setData(result);
          setError(null);
          setLastSuccessAt(Date.now());
        } else {
          setError(result?.reason || 'live-unavailable');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (intervalMs > 0) {
            timer = setTimeout(poll, intervalMs);
          }
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, kickoff, enabled, intervalMs]);

  return { data, error, loading, lastSuccessAt };
}
