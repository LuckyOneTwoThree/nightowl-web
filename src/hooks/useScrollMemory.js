import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * 视图内滚动位置记忆（按 key 分桶）
 *
 * 问题：左栏三个视图共用同一块位置，但各自是独立组件。切到「本周规划」再切回「今晚观赛」，
 * 列表会跳回顶部 —— 用户刚翻到今晚第 12 场，切走看一眼周计划，回来就得重新找。
 * 顶栏视图切换不该是「丢失上下文」的操作。
 *
 * 为什么不用 sessionStorage：这些位置随窗口尺寸与数据刷新而失效，跨会话恢复反而会
 * 把人带到一个空位置；内存 Map 的生命周期（本次会话）刚好够用，也不产生 IO。
 *
 * ⚠️ 已知边界：本 hook 只适用于**原生滚动容器**。`ScheduleView` 用的是 virtua 虚拟列表，
 * 它在挂载后按测量结果重算可视区，直接写 scrollTop 会被纠正回去，因此没接这个 hook。
 */

/** key → scrollTop；模块级，页面刷新即清空 */
const memory = new Map();

export function useScrollMemory(key) {
  const ref = useRef(null);
  const touched = useRef(false);

  // 挂载后恢复（切视图会把容器 unmount/remount，滚动位置本来会丢）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const saved = memory.get(key);
    if (!saved) return undefined;

    el.scrollTop = saved;
    /* 首帧内容高度可能还没定稿（队徽图片、自托管字体仍在加载），
       scrollTop 会被截断到当时可滚范围内。下一帧补一次；
       如果用户在这一帧里已经自己滚过，就不动他。 */
    const raf = requestAnimationFrame(() => {
      if (!touched.current) el.scrollTop = saved;
    });
    return () => cancelAnimationFrame(raf);
  }, [key]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let lastTop = null;

    const onScroll = () => {
      touched.current = true;
      lastTop = el.scrollTop;
      memory.set(key, lastTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      el.removeEventListener('scroll', onScroll);
      /* 卸载时节点可能已经脱离文档（此时 scrollTop 读出来是 0），
         所以优先用最后一次真实读到的值，别把已记住的位置覆盖成顶部。 */
      if (lastTop != null) memory.set(key, lastTop);
    };
  }, [key]);

  return ref;
}
