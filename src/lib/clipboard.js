/**
 * 复制文本。
 *
 * `navigator.clipboard` 在非安全上下文（本地 http、file://）不可用，
 * 而桌面端就是这两种情况都可能出现，所以保留 execCommand 回退。
 * 返回布尔值：调用方必须据此说「已复制」或「复制失败」，不能乐观提示。
 */
export async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走回退 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
