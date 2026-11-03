import { create } from 'zustand';

/**
 * 全局轻提示。
 *
 * 之前每个页面各自维护一个 `toast: string | null`，一律配一个绿色勾：
 * 「已加入明早补看」和「补看队列已满」长得一模一样，用户看不出哪句是失败。
 * 所以这里带上 kind，并且允许挂最多两个恢复动作 —— 光说失败没用，
 * 得让人当场能做点什么（重试 / 复制链接）。
 */
export type ToastKind = 'success' | 'info' | 'error';

export type ToastAction = {
  label: string;
  onPress: () => void;
  /** 主行动用强调色，次行动用普通文字色 */
  primary?: boolean;
};

export type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
  actions?: ToastAction[];
};

type ToastState = {
  current: ToastItem | null;
  show: (input: { kind?: ToastKind; message: string; actions?: ToastAction[] }) => void;
  /** 带 id 时只关掉对应那条 —— 旧提示的退场动画不能误伤新提示 */
  dismiss: (id?: number) => void;
};

let seq = 0;

export const useToastStore = create<ToastState>(set => ({
  current: null,
  show: input =>
    set({
      current: {
        id: (seq += 1),
        kind: input.kind ?? 'info',
        message: input.message,
        actions: input.actions,
      },
    }),
  dismiss: id =>
    set(state => (!id || state.current?.id === id ? { current: null } : state)),
}));

/** 组件外调用（网络 / 外链 / 剪贴板）；组件内可直接用 useToastStore */
export const toast = {
  success: (message: string) => useToastStore.getState().show({ kind: 'success', message }),
  info: (message: string) => useToastStore.getState().show({ kind: 'info', message }),
  error: (message: string, actions?: ToastAction[]) =>
    useToastStore.getState().show({ kind: 'error', message, actions }),
};
