import { useSyncExternalStore } from 'react';

import { dismissToast, getToast, subscribeToast } from '../lib/toast.js';
import { IconCheck, IconClose, IconInfo, IconWarn } from './icons.jsx';

/**
 * 桌面全局提示条。
 *
 * 位置固定在底部居中：浮层（设置抽屉、更新弹窗、早晨摘要）都在上半屏或右侧，
 * 底部不会挡住它们；层级放在 modal 之上、splash 之下（见 tailwind zIndex.toast）。
 */
const TONE = {
  success: {
    box: 'border-accent/35 bg-surface-raised text-accent',
    Icon: IconCheck
  },
  error: {
    box: 'border-danger/40 bg-surface-raised text-danger',
    Icon: IconWarn
  },
  info: {
    box: 'border-line-control bg-surface-raised text-text-secondary',
    Icon: IconInfo
  }
};

export function ToastHost() {
  const item = useSyncExternalStore(subscribeToast, getToast);

  if (!item) return null;
  const tone = TONE[item.kind] || TONE.info;
  const Icon = tone.Icon;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-toast flex justify-center px-4">
      <div
        role={item.kind === 'error' ? 'alert' : 'status'}
        aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
        className={`pointer-events-auto flex min-w-0 max-w-md items-start gap-2 rounded-xl border px-3 py-2 text-xs shadow-pop ${tone.box}`}
      >
        <Icon size={13} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 leading-relaxed break-words">{item.message}</span>
        {(item.actions || []).map(action => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              dismissToast(item.id);
              action.onClick?.();
            }}
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-press focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
              action.primary ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => dismissToast(item.id)}
          aria-label="关闭提示"
          className="shrink-0 rounded-md p-1 text-text-faint transition-colors hover:bg-surface-press hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <IconClose size={12} />
        </button>
      </div>
    </div>
  );
}
