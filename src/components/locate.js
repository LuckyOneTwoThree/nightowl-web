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

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });

  if (flashEl && flashEl !== el) flashEl.classList.remove('locate-focus-flash');
  el.classList.remove('locate-focus-flash');
  // 强制回流，让连续点击也能重新触发高亮
  void el.offsetWidth;
  el.classList.add('locate-focus-flash');
  window.clearTimeout(flashTimer);
  flashEl = el;
  flashTimer = window.setTimeout(() => {
    el.classList.remove('locate-focus-flash');
    if (flashEl === el) flashEl = null;
  }, 1100);

  if (focus && el.hasAttribute('tabindex') && el.getBoundingClientRect().height > 0) {
    el.focus({ preventScroll: true });
  }
}
