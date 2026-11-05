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

  /**
   * 高亮与焦点放到下一个宏任务里做。
   *
   * 点击这些入口往往同时改 state（选中比赛、展开折叠区），同步执行时拿到的可能
   * 是马上要被替换掉的节点。React 18 的状态更新是微任务，宏任务必然落在提交之后，
   * 此时重新 getElementById 拿到的才是最终节点。
   *
   * 为什么不用 requestAnimationFrame：隐藏窗口（CI 的 check:render 就是）不跑 rAF，
   * 反馈会彻底消失，且这种消失只会出现在 CI 里、本地看不见。
   */
  const applyFeedback = () => {
    const node = document.getElementById(id);
    if (!node) return;
    if (flashEl && flashEl !== node) flashEl.classList.remove('locate-focus-flash');
    node.classList.remove('locate-focus-flash');
    // 强制回流，让连续点击也能重新触发高亮
    void node.offsetWidth;
    node.classList.add('locate-focus-flash');
    window.clearTimeout(flashTimer);
    flashEl = node;
    flashTimer = window.setTimeout(() => {
      node.classList.remove('locate-focus-flash');
      if (flashEl === node) flashEl = null;
    }, 1100);

    if (focus && node.hasAttribute('tabindex') && node.getBoundingClientRect().height > 0) {
      node.focus({ preventScroll: true });
    }
  };
  window.setTimeout(applyFeedback, 0);
}
