import { useId, useState } from 'react';
import { SectionLabel } from '../atoms.jsx';
import { IconChevronDown, IconChevronUp } from '../icons.jsx';

/**
 * 情报面板的内部基建
 *
 * 抽出来的原因：面板已经从「一个文件塞下所有分区」拆成
 * `IntelPanel`（容器）+ `intel/StatsSections`（数据视图）等多个文件，
 * 而 `PanelTab` / `Block` 是它们共用的排版原语 —— 留在容器里会形成循环依赖。
 */

export function PanelTab({ active, onClick, icon, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
        active
          ? 'border border-line-control bg-surface-raised font-semibold text-text-primary shadow-sm'
          : 'border border-transparent text-text-muted hover:border-line-hairline hover:bg-surface-raised hover:text-text-primary'
      }`}
    >
      {icon}
      <span className="ml-1.5">{children}</span>
    </button>
  );
}

/**
 * 分区：图标 + 标题在左，内容在下；靠 hairline 与留白分隔，不套盒子
 *
 * `fold` 提供时降级为**第三层抽屉**（见下方说明）：
 *   fold = { summary, defaultOpen? }
 *
 * 为什么要抽屉：面板此前把 8 个分区一次铺开 —— 睡眠代价、看点故事线、数据说明、
 * 赛季身份、指数归因全部同时可见。每块单独都成立，但同时出现等于没有主次：
 * 用户的视线在五个等权的标题之间来回跳，反而找不到「所以到底看不看」。
 * 现在只把**结论/驱动/代价/可信度**留在台面（第一层）、归因表作为唯一主图表（第二层），
 * 其余降为抽屉 —— 收起时用一行摘要交代里面有什么，需要深挖才展开。
 */
export function Block({ icon, title, right, children, fold = null }) {
  const [open, setOpen] = useState(fold ? !!fold.defaultOpen : true);
  const bodyId = useId();

  if (!fold) {
    return (
      <section>
        <SectionLabel right={right} className="mb-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-text-faint">{icon}</span>
            {title}
          </span>
        </SectionLabel>
        {children}
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          data-fold={title}
          className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 text-left text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <span className="shrink-0 text-text-faint">{icon}</span>
          <span className="shrink-0">{title}</span>
          {/* 收起时摘要必须出现：抽屉的代价是「用户不知道里面有没有东西」，
              一行摘要就是那个入口承诺 */}
          {!open && fold.summary && (
            <span className="min-w-0 truncate text-2xs font-normal text-text-faint">
              · {fold.summary}
            </span>
          )}
          <span className="shrink-0 text-text-faint">
            {open ? <IconChevronUp /> : <IconChevronDown />}
          </span>
        </button>
        {open ? right : null}
      </div>
      {open && (
        <div id={bodyId} className="mt-1.5">
          {children}
        </div>
      )}
    </section>
  );
}
