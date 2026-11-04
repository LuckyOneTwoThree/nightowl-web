import { useCallback, useEffect, useRef, useState } from 'react';
import { bjClock } from '../core/format.js';
import { requestScoreSync, SYNC_STATUS_BUSY } from '../api/score-sync.js';

/**
 * 数据健康与同步结果的唯一入口
 *
 * App 里原本有 10 类职责，其中「数据是不是新的」这一类占了：
 * 3 个 state + 2 个 ref + 一个自适应轮询 effect + 一套状态文案 + 单场重查 + 计划有变。
 * 抽出来后 App 只负责把 dataHealth 传给顶栏、把 scheduleChanges 传给提示条。
 *
 * 两条口径写在这里，避免各处再算一遍：
 *   1. 顶栏文案按「谁更需要用户行动」排序：正在同步 > 同步失败 > 待录 > 上游缺分 > 数据落后；
 *      「上游缺分」不能说成「待录」——那会让用户以为应用在等一个永远不会来的结果。
 *   2. 发现后台写入新赛果（lastSync.at 变化）只在真的有补丁时重载 fixtures；
 *      空跑一趟的自检不重载，否则每 30 分钟白刷一次全量数据。
 *
 * @param {object} opts
 * @param {() => Promise<any>} opts.refreshData 重新拉取 fixtures（App 提供，自带竞态保护）
 */
export function useDataHealth({ refreshData }) {
  const [dataHealth, setDataHealth] = useState(null);
  const [scheduleChanges, setScheduleChanges] = useState(null);
  const [dismissedChangesAt, setDismissedChangesAt] = useState(() => {
    try {
      const v = Number(sessionStorage.getItem('nightowl:changes_dismissed'));
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  });
  const [recheckingMatchId, setRecheckingMatchId] = useState(null);
  const [recheckMsg, setRecheckMsg] = useState(null);
  const lastHealthAtRef = useRef(null);

  /** 低频数据状态：发现后台写入新赛果时只重载 fixtures；失败/陈旧则显示提示 */
  const refreshHealth = useCallback(async () => {
    try {
      const r = await fetch('/api/scores/status');
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const at = j?.lastSync?.at || null;
      if (at && at !== lastHealthAtRef.current) {
        lastHealthAtRef.current = at;
        // 无补丁的自检只更新时间，不重载整份 fixtures。
        if (Number(j?.lastSync?.patches || 0) > 0) refreshData();
      }
      const errors = Number(j?.lastSync?.errors || 0);
      const writtenOk = j?.lastSync?.written?.ok !== false;
      // 有补丁落盘就不算「同步失败」——把「已更新 3 场」和「2 个来源没响应」
      // 压成红色的「同步失败」，会让用户以为数据没动，而服务端其实已经写盘。
      const changed = Number(j?.lastSync?.written?.changed || 0);
      const pending = Number(j?.freshness?.pendingCount || 0);
      const stalePending = Number(j?.freshness?.stalePendingCount || 0);
      const recentPending = Math.max(0, pending - stalePending);
      const stale = Number(j?.freshness?.staleHours || 0);
      let state = 'ok';
      let label = '数据未检查';
      if (j?.syncing) {
        // 后台保鲜会持续几十秒（openfootball 兜底较慢）；期间明确告知用户，
        // 完成后下一次短轮询会检测到 lastSync 变化并热更新 fixtures。
        state = 'ok';
        label = '正在更新比分…';
      } else if (j?.lastSync && !writtenOk) {
        state = 'error';
        label = '同步写盘失败';
      } else if (j?.lastSync && errors > 0 && changed === 0) {
        state = 'error';
        label = `同步失败 · ${errors} 个来源`;
      } else if (j?.lastSync && errors > 0) {
        // 部分来源失败但补丁已落盘：降级为提示，不报错。
        state = 'warn';
        label = `已更新 ${changed} 场 · ${errors} 个来源未响应`;
      } else if (recentPending > 0) {
        state = 'warn';
        label = `待录 ${recentPending} 场`;
      } else if (stalePending > 0) {
        // 超过 24h 仍无比分：上游没有该场或改期未被识别。
        // 继续显示「待录」会让用户以为应用一直在等一个永远不会来的结果。
        state = 'warn';
        label = `上游缺分 ${stalePending} 场`;
      } else if (stale >= 24 && pending > 0) {
        // 「落后」必须同时满足「有待录场次」和「赛果超过一天没更新」。
        // 只看 staleHours 会把休赛日（没有新赛果是正常的）误报成数据过期。
        state = 'warn';
        label = `数据落后 ${Math.floor(stale / 24)} 天`;
      } else if (at) {
        const t = Date.parse(at);
        label = `数据 ${Number.isFinite(t) ? bjClock(t, false) : '已更新'}`;
      } else {
        state = 'unknown';
      }
      // checks：待录场次的「最后检查时间」，供单场数据说明使用
      setDataHealth({ state, label, checks: j?.checks || {} });
      setScheduleChanges(j?.changes?.items?.length ? j.changes : null);
      return { syncing: !!j?.syncing };
    } catch {
      setDataHealth({ state: 'error', label: '本地服务未连接', checks: {} });
      return { syncing: false };
    }
  }, [refreshData]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      const info = await refreshHealth();
      if (!alive) return;
      // 后台同步期间缩短到 3 秒；完成后 status 的 lastSync.at 会变化，
      // refreshHealth 内部触发热更新，不必等 120 秒的常规轮询。
      timer = setTimeout(tick, info?.syncing ? 3000 : 120000);
    };
    timer = setTimeout(tick, 4000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [refreshHealth]);

  /** 关闭提示：按「本轮同步时间」记在 sessionStorage —— 同一轮只提示一次 */
  const dismissScheduleChanges = useCallback(() => {
    const at = scheduleChanges?.at || 0;
    setDismissedChangesAt(at);
    try {
      sessionStorage.setItem('nightowl:changes_dismissed', String(at));
    } catch {
      /* 忽略 */
    }
  }, [scheduleChanges]);

  /**
   * 单场重查（FR-06）
   *
   * 只查这一场所在的联赛与日期，不惊动整轮保鲜 —— 用户在「数据说明」里点一下，
   * 几秒内就能知道是「上游没给」还是「刚才没同步到」。
   */
  const recheckMatch = useCallback(
    async matchId => {
      if (!matchId || recheckingMatchId) return null;
      setRecheckingMatchId(matchId);
      try {
        const outcome = await requestScoreSync({ apply: true, matchId });
        // 服务端已写入；这里统一重读一次 fixtures，不额外维护「用 payload 还是重取」两条路径
        if (outcome.ok) await refreshData();
        await refreshHealth();

        // 单场重查的结果必须说清楚：用户点了按钮，不能只有"转一圈又回到原样"。
        // 语义按"这一场查过没有"来写，不用整轮同步的口径（openfootball 未响应
        // 不该被读成"同步失败"，ESPN 那一路可能已经查全了）。
        const changed = Number(outcome.payload?.summary?.written?.changed || 0);
        const text =
          outcome.status === SYNC_STATUS_BUSY
            ? '已有同步在进行中，稍后自动更新'
            : outcome.status === 'updated'
              ? `已更新 ${changed} 场比分`
              : outcome.status === 'partial_failure'
                ? `已更新 ${changed} 场（部分来源未响应）`
                : outcome.status === 'up_to_date'
                  ? '本场已查，暂无新比分'
                  : outcome.payload?.summary?.written?.ok === false
                    ? outcome.payload.summary.written.reason || '写盘失败'
                    : '本场已查，来源暂未响应';
        setRecheckMsg({ matchId, ok: outcome.ok, degraded: !!outcome.degraded, text });
        return outcome;
      } finally {
        setRecheckingMatchId(null);
      }
    },
    [recheckingMatchId, refreshData, refreshHealth]
  );

  return {
    dataHealth,
    scheduleChanges,
    dismissedChangesAt,
    dismissScheduleChanges,
    refreshHealth,
    recheckMatch,
    recheckingMatchId,
    recheckMsg
  };
}
