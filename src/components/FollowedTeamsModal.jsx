import { useDialogFocus } from '../hooks/useDialogFocus.js';
import { Button, Chip, Meta } from './atoms.jsx';
import { IconClose } from './icons.jsx';
import TeamPicker from './TeamPicker.jsx';

/**
 * 关注球队管理模态弹窗
 *
 * 将原本在「我的看台」内联向下展开（且撑爆右栏）的球队选择器收口到独立居中的宽屏模态框，
 * 并作为全站（顶栏主队入口 / 我的看台 / 设置抽屉）的统一主队管理弹窗。
 */
export default function FollowedTeamsModal({
  open,
  selected = [],
  onChange,
  onClose,
  returnFocusEl = null
}) {
  useDialogFocus(open, null, returnFocusEl);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="followed-teams-modal-title"
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-hairline bg-surface-panel shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="followed-teams-modal-title" className="text-base font-semibold text-text-primary">
                管理关注球队
              </h2>
              <Chip tone={selected.length > 0 ? 'accent' : 'neutral'}>
                已关注 {selected.length} 支
              </Chip>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              主客队任一方命中即进入「今晚之选」高优排序，并在本周熬夜预算内优先保留。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selected.length > 0 && (
              <Button variant="text" size="xs" onClick={() => onChange?.([])}>
                清空全部
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭关注球队窗口"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
            >
              <IconClose />
            </button>
          </div>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <TeamPicker
            selected={selected}
            onChange={onChange}
            gridClass="grid-cols-4 sm:grid-cols-6"
            listClass="max-h-[42vh]"
            autoFocus
          />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line-hairline bg-surface-card/45 px-5 py-3">
          <Meta>
            {selected.length > 0
              ? `已选择 ${selected.length} 支主队，改动立即生效并自动保存`
              : '提示：至少选择 1 支主队可获得更精准的看球决策'}
          </Meta>
          <Button variant="primary" size="sm" onClick={onClose}>
            完成
          </Button>
        </footer>
      </section>
    </div>
  );
}
