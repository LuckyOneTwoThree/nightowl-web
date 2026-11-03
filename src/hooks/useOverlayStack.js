import { useEffect, useRef, useState } from 'react';

/** 浮层栈的固定顺序（与渲染顺序无关，只用于稳定排序与 Esc 目标识别） */
const ORDER = ['settings', 'onboarding', 'update', 'standings', 'palette', 'morning'];

/**
 * 浮层栈：任一全屏浮层打开时背景 inert、Esc 只关最上层、打开顺序决定层级。
 *
 * 从 App.jsx 抽出。三条纪律（都有过真实事故）原样保留：
 *   1. 背景 inert：只靠遮罩挡鼠标，Tab 仍能跑进后面的列表；早晨摘要声明了
 *      aria-modal，漏收就会「弹窗开着还能 Tab 到背景」。
 *   2. 按**实际打开顺序**入栈，而不是固定优先级 —— 否则更新弹窗自动叠到积分榜上时，
 *      Esc 会先关积分榜。
 *   3. 新打开但 effect 还没同步的浮层要追加到末尾，否则首帧被 inert 掉、焦点进不去。
 *
 * @param {object} p
 * @param {Record<string, boolean>} p.flags 各浮层是否打开（settings/onboarding/update/standings/palette/morning）
 * @param {Record<string, Function>} p.closers 各浮层的关闭函数（同键名）
 * @param {boolean} [p.splashOpen] 开屏是否打开（只影响背景 inert，不参与栈）
 */
export function useOverlayStack({ flags, closers, splashOpen = false }) {
  const [overlayOrder, setOverlayOrder] = useState([]);
  const prevRef = useRef({});
  // closers 每次渲染是新对象；用 ref 持有最新值，避免 Esc 监听器每次渲染重挂
  const closersRef = useRef(closers);
  closersRef.current = closers;

  const openMap = {};
  for (const id of ORDER) openMap[id] = !!flags[id];
  const openOverlayIds = ORDER.filter(id => openMap[id]);
  const effectiveOverlayOrder = [
    ...overlayOrder.filter(id => openOverlayIds.includes(id)),
    ...openOverlayIds.filter(id => !overlayOrder.includes(id))
  ];
  const topOverlay = effectiveOverlayOrder[effectiveOverlayOrder.length - 1] || null;
  const overlayOpen = !!splashOpen || openOverlayIds.length > 0;
  const inertFor = id => (openOverlayIds.includes(id) && id !== topOverlay ? true : undefined);

  const signature = ORDER.map(id => (openMap[id] ? '1' : '0')).join('');

  useEffect(() => {
    const prev = prevRef.current;
    const next = openMap;
    setOverlayOrder(order => {
      const kept = order.filter(id => next[id]);
      const added = ORDER.filter(id => next[id] && !prev[id]);
      return added.length ? [...kept, ...added] : kept;
    });
    prevRef.current = next;
    // 只在「哪些浮层开/关」变化时更新栈顺序；openMap 每次渲染重建，不能用它做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (overlayOrder.length === 0) return undefined;
    const onEsc = e => {
      if (e.key !== 'Escape') return;
      const id = overlayOrder[overlayOrder.length - 1];
      closersRef.current?.[id]?.();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [overlayOrder]);

  return { overlayOpen, inertFor, topOverlay, effectiveOverlayOrder };
}
