import { useCallback, useEffect, useRef, useState } from 'react';
import { setFixtures } from '../data/index.js';

/**
 * fixtures 热更新（dataRev / refreshData / 竞态保护 / 窗口聚焦校准）
 *
 * 从 App.jsx 抽出的第一层：只负责「从 /api/fixtures 拉最新数据替换内存快照」。
 * 有意**不包含 triggerSync** —— triggerSync 依赖 `useDataHealth` 的 refreshHealth，
 * 而 useDataHealth 又依赖本 hook 的 refreshData，形成循环；硬合到一个 hook 里
 * 只会把顺序耦合藏得更深。同步触发与轮询仍留在 App，按原顺序组装。
 *
 * 竞态保护（原有，原样保留）：refreshData 有 4 个并发来源（挂载 effect / focus 监听 /
 * triggerSync 的 409 延迟分支 / 设置抽屉按钮）。两层防线：in-flight 复用避免重复请求；
 * 序号保证只有最新一次的响应才会被应用（last-response-wins 会覆盖新数据）。
 */
export function useFixturesRefresh() {
  const [dataRev, setDataRev] = useState(0);
  const refreshInFlightRef = useRef(null);
  const refreshSeqRef = useRef(0);

  const refreshData = useCallback(async () => {
    // 已有相同拉取在进行：复用同一个 promise，不重复发请求
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    refreshSeqRef.current += 1;
    const seq = refreshSeqRef.current;
    const p = (async () => {
      try {
        const r = await fetch('/api/fixtures');
        if (!r.ok) return null;
        const j = await r.json();
        // 只接受最后一次发起的响应，避免旧响应覆盖新数据
        if (seq !== refreshSeqRef.current) return null;
        if (j?.fixtures?.length && setFixtures(j.fixtures)) {
          setDataRev(v => v + 1);
        }
        return j;
      } catch {
        /* 服务不可用（纯静态预览）时静默沿用内置快照，不打扰用户 */
      }
      return null;
    })();
    refreshInFlightRef.current = p;
    try {
      return await p;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, []);

  /** 外部已拿到新 fixtures（如同步响应）时递增 rev，让派生数据重算 */
  const bumpDataRev = useCallback(() => setDataRev(v => v + 1), []);

  // 页面重新聚焦时轻量校准一次
  useEffect(() => {
    const onFocus = () => refreshData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshData]);

  return { dataRev, refreshData, bumpDataRev };
}
