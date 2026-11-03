/**
 * 页内定位（情报 / 线路 / 回顾 / 集锦）
 *
 * 这些入口是锚点而非弹窗。目标本来就在视口内时 scrollIntoView 不会产生位移，
 * 用户会得到「点了没反应」的假死感；因此无论是否发生滚动，都补一次短暂高亮，
 * 目标带 tabindex 时把焦点一并交过去。高亮用静态 class + 定时移除，
 * 不依赖 animation，prefers-reduced-motion 下同样有效。
 */
let flashTimer = 0;
let flashEl = null;

export function locateSection(id, { focus = false } = {}) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;

  // 目标可能被折叠（例如无视频流时的 52px 侧轨），先在同步帧里让容器展开，
  // 再重新取一次节点 —— 否则高亮和焦点会落在马上要消失的节点上。
  window.dispatchEvent(new CustomEvent('nightowl:locate', { detail: { id } }));
  const target = document.getElementById(id) || el;

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });

  if (flashEl && flashEl !== target) flashEl.classList.remove('locate-focus-flash');
  target.classList.remove('locate-focus-flash');
  // 强制回流，让连续点击也能重新触发高亮
  void target.offsetWidth;
  target.classList.add('locate-focus-flash');
  window.clearTimeout(flashTimer);
  flashEl = target;
  flashTimer = window.setTimeout(() => {
    target.classList.remove('locate-focus-flash');
    if (flashEl === target) flashEl = null;
  }, 1100);

  if (focus && target.hasAttribute('tabindex') && target.getBoundingClientRect().height > 0) {
    target.focus({ preventScroll: true });
  }
}
