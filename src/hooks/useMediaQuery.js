import { useEffect, useState } from 'react';

/**
 * 订阅一个媒体查询（区间断点用）
 *
 * Tailwind 的 `xl` 只能表达「≥1280」，无法表达「1120–1279」，
 * 也无法让「折叠为 52px 竖轨」这种结构性变化只靠 class 完成 ——
 * 那里需要的是换一套 DOM，而不是换一套样式。
 *
 * 首帧取真实值，避免先渲染默认值再跳变。
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = event => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
