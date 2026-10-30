import { useCallback, useEffect, useRef, useState } from 'react';

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
  const dataMatchRef = useRef<string | null>(null);
  // 请求序号：切场/关闭后旧请求仍可能返回，必须让它无法覆盖新比赛的结果。
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!match) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
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
        if (requestIdRef.current !== requestId) return;
        setData(result);
        if (result?.scrapeError) setError(result.scrapeError);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [matchId, match?.h, match?.a, match?.t]
  );

  useEffect(() => {
    if (!enabled || !match) {
      // 关闭面板/切场时作废在途请求，并把旧线路从状态里摘掉。
      requestIdRef.current += 1;
      dataMatchRef.current = null;
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    requestIdRef.current += 1;
    dataMatchRef.current = matchId ?? null;
    setData(null);
    setError(null);
    void load(false);
  }, [enabled, matchId, load]);

  return {
    // 切场后的首帧不把上一场的线路交给新比赛。
    data: dataMatchRef.current === matchId ? data : null,
    loading,
    error,
    reload: () => load(true),
  };
}
