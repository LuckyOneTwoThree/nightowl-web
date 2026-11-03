import { copyText } from './clipboard.js';
import { toast } from './toast.js';

/**
 * 打开外部链接，失败必须给出口。
 *
 * 桌面端有两条路：Electron 桥（主进程 shell.openExternal）与浏览器 window.open。
 * 前者以前是 `ipcRenderer.send` —— 发完就没了，打不开也不知道；后者被拦截时返回 null。
 * 两种失败都在这里收成同一句提示：重试，或者把链接复制走自己贴到浏览器。
 */
async function tryOpen(url) {
  if (!url) return false;
  if (window.desktop?.openExternal) {
    try {
      const result = await window.desktop.openExternal(url);
      // 老版本 preload 用的是 send，返回 undefined —— 不能当成失败
      return result !== false;
    } catch {
      return false;
    }
  }
  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    return !!win;
  } catch {
    return false;
  }
}

export async function openExternal(url, label = '外部链接') {
  const ok = await tryOpen(url);
  if (!ok) {
    toast.error(`打不开「${label}」`, [
      { label: '重试', primary: true, onClick: () => void openExternal(url, label) },
      { label: '复制链接', onClick: () => void copyLink(url) }
    ]);
  }
  return ok;
}

export async function copyLink(url) {
  const ok = await copyText(url);
  if (ok) toast.success('链接已复制，可粘到浏览器打开');
  else toast.error('复制失败，请手动复制链接');
  return ok;
}
