/**
 * 语义化版本比较（共享纯函数）
 *
 * 为什么独立成模块：更新检查有两处调用方 —— App.jsx（Web 环境静默探测 GitHub API）
 * 与 UpdateModal.jsx（展示层判断）。此前两处各写一份实现，改一处漏一处就会让
 * 「顶栏说有新版本 / 弹窗说已是最新」这类自相矛盾重现（本项目真出现过类似现象）。
 * 判据只能有一份。
 */

/** a > b 返回正数、相等返回 0、a < b 返回负数（逐段数字比较，忽略预发布标记） */
export function compareSemver(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 线上版本是否真的比本地新 —— 「发现新版本」的唯一判据 */
export function isNewerVersion(latest, current) {
  return compareSemver(latest, current) > 0;
}
