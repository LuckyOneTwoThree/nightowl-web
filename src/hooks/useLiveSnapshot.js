import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 进行中比赛的实时快照（比分 / 分钟数 / 关键事件）
 *
 * 从 PlayerStage 抽出的原因：这段逻辑有 16 行「同一件事的三个状态 + 竞态保护」，
 * 而组件本身已经有 16 个 useState —— 每多一个都让「这个组件到底管什么」更难回答。
 *
 * 三条纪律（都有过真实事故）：
 *   1. **只在进行中轮询**：服务端 20 秒缓存，前端 30 秒，不把上游打爆；
 *      终场/未开赛立即停表，否则关掉窗口前还在白白请求。
 *   2. **切场立即清空**：否则新场次接口返回前，画布会用上一场比分渲染新队名。
 *   3. **过期响应必须丢弃**：请求返回时如果已切到别的场次或已终场，直接扔掉 ——
 *      这是「A 场的比分串到 B 场」的唯一防线（前端没有请求排序保证）。
 *
 * 失败不弹错、不阻塞播放：本地分钟数仍是兜底，快照只是锦上添花。
 *
 * @param {object} opts
 * @param {string} opts.matchId 当前场次
 * @param {string} opts.state   'sched' | 'live' | 'finished' | 'pp' | 'ended_pending'
 * @param {number} [opts.intervalMs] 轮询间隔，默认 30 秒
 * @returns {{ snapshot: object|null, loading: boolean, refreshing: boolean, refresh: () => void }}
 */
export function useLiveSnapshot({ matchId = null, state = null, intervalMs = 30000 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 用 ref 保存「当前应该关心哪一场」，让 load 不必随 matchId 重建（interval 会被重置）
  const activeRef = useRef({ matchId, state });
  activeRef.current = { matchId, state };
  // 已有快照时不再显示骨架屏：手动刷新和轮询都不该让画面闪
  const hasDataRef = useRef(false);
  // 按场次与序号追踪在途请求：切场时不互相阻塞，同场手动刷新可抢占后台轮询
  const reqIdRef = useRef(0);
  const inFlightRef = useRef({ matchId: null, manual: false, reqId: 0, controller: null });

  const load = useCallback(async ({ manual = false } = {}) => {
    const { matchId: id, state: st } = activeRef.current;
    if (!id || st !== 'live') return;

    const cur = inFlightRef.current;
    if (cur.matchId === id) {
      if (!manual || cur.manual) return;
      // 同场轮询在途时点手动刷新：中止旧轮询，让 refresh=1 立即发出
      cur.controller?.abort();
    } else if (cur.matchId) {
      // 已切到新场次：中止上一场的在途请求，不能挡住当前场首屏拉取
      cur.controller?.abort();
    }

    const reqId = ++reqIdRef.current;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    inFlightRef.current = { matchId: id, manual, reqId, controller };

    if (!hasDataRef.current) setLoading(true);
    if (manual) setRefreshing(true);

    try {
      const res = await fetch(
        `/api/live?matchId=${encodeURIComponent(id)}${manual ? '&refresh=1' : ''}`,
        controller ? { signal: controller.signal } : undefined
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      // 过期响应：已切场、已终场或已被更新的请求接管就丢弃
      if (
        inFlightRef.current.reqId !== reqId ||
        activeRef.current.matchId !== id ||
        activeRef.current.state !== 'live'
      ) {
        return;
      }
      const next = json?.ok ? json : null;
      hasDataRef.current = !!next;
      setData(next);
    } catch (err) {
      if (err?.name === 'AbortError' || inFlightRef.current.reqId !== reqId) return;
      if (activeRef.current.matchId === id && activeRef.current.state === 'live') {
        hasDataRef.current = false;
        setData(null);
      }
    } finally {
      if (inFlightRef.current.reqId === reqId) {
        inFlightRef.current = { matchId: null, manual: false, reqId: 0, controller: null };
        if (activeRef.current.matchId === id) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    // 切场 / 状态变化：先清空，再决定要不要起表
    hasDataRef.current = false;
    setData(null);
    setLoading(false);
    setRefreshing(false);

    if (!matchId || state !== 'live') return undefined;
    load();
    const timer = setInterval(() => load(), intervalMs);
    return () => {
      clearInterval(timer);
      if (inFlightRef.current.matchId === matchId) {
        inFlightRef.current.controller?.abort();
        inFlightRef.current = { matchId: null, manual: false, reqId: 0, controller: null };
      }
    };
  }, [matchId, state, intervalMs, load]);

  const refresh = useCallback(() => load({ manual: true }), [load]);

  // 双保险：即使 hook 内部已按 matchId 清理，调用方仍按 id 过滤一次
  const snapshot = data && data.matchId === matchId ? data : null;

  return { snapshot, loading, refreshing, refresh };
}
