import { useEffect, useRef } from 'react';

/**
 * 对话框焦点：打开时把焦点送进去，关闭时还回原处。
 *
 * 背景 `inert` 只挡住 Tab，不会主动把焦点送进对话框 —— 不送的话，用户按 Tab 会停在
 * 文档最后一个可聚焦元素上，看着像「弹窗没响应」。关闭后若不归还，焦点掉回 body，
 * 键盘用户每次关弹窗都要从头 Tab 一遍。
 *
 * 归还时跳过两种情况，与 App 既有口径一致：
 *   · 原元素已经不在文档里（列表重排、视图切换）；
 *   · 原元素现在处于 inert 子树内（被另一层浮层挡住，聚焦它没有意义）。
 */
export function useDialogFocus(open, initialRef) {
  const returnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    returnRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    // 有些弹窗的首个控件自带 autoFocus（首次引导里的搜索框），此时 initialRef 为空，
    // 不抢焦点，让输入框自己拿。
    initialRef?.current?.focus?.();
    return () => {
      const el = returnRef.current;
      returnRef.current = null;
      if (!el?.isConnected) return;
      if (el.closest?.('[inert]')) return;
      el.focus?.();
    };
  }, [open, initialRef]);
}
