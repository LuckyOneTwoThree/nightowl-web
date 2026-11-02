import { useEffect, useRef, useState } from 'react';

/**
 * 拉一份「带 ok 标志的 JSON」并给出四态：idle / loading / ready / empty / error
 *
 * 为什么需要它：赛后回顾（/api/recap）与官方集锦（/api/highlights）此前各写了一份
 * 逐字相同的取数逻辑 —— AbortController 取消、alive 标记防卸载后 setState、
 * `res.ok` 与业务 `ok` 两层判断、list 长度决定 ready/empty。两份实现只有
 * 「集锦多 350ms 防抖」这一处差异，却已经各自演化（一份忘了清 timer 就是内存泄漏）。
 *
 * 契约：
 *   · url 为 null 表示「不需要请求」（未开赛 / 防剧透未揭晓 / 组件卸载）→ idle
 *   · nonce 变化触发重新请求；调用方自己持有 nonce，用它做「重试 / 刷新」
 *   · listKey 指定用哪个数组字段判断空态（events / videos）；不传则 ok 即 ready
 *   · debounceMs > 0 时延后发起，并在 url 变化时取消上一个待发请求
 */
export function useRemoteJson({ url = null, listKey = null, nonce = 0, debounceMs = 0 } = {}) {
  const [status, setStatus] = useState('idle');
  const [data, setData] = useState(null);
  // listKey 只影响判定方式，不该触发重新请求：放进 ref 避免成为一个副作用依赖
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      setData(null);
      return undefined;
    }

    const ac = new AbortController();
    let alive = true;
    setStatus('loading');
    setData(null);

    const run = async () => {
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!alive) return;
        if (!json?.ok) {
          setStatus('error');
          return;
        }
        setData(json);
        const key = listKeyRef.current;
        const list = key ? json[key] : null;
        setStatus(key && (!Array.isArray(list) || list.length === 0) ? 'empty' : 'ready');
      } catch (err) {
        // 主动取消不是错误：切换场次时不该把界面闪成「加载失败」
        if (alive && err?.name !== 'AbortError') setStatus('error');
      }
    };

    const timer = debounceMs > 0 ? setTimeout(run, debounceMs) : null;
    if (!timer) run();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      ac.abort();
    };
  }, [url, nonce, debounceMs]);

  return { status, data };
}
