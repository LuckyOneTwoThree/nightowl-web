import { SectionLabel } from '../atoms.jsx';

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

/** 分区：图标 + 标题在左，内容在下；靠 hairline 与留白分隔，不套盒子 */
export function Block({ icon, title, right, children }) {
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
