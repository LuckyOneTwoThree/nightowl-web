/**
 * 预加载脚本 —— 渲染层与主进程之间的最小桥
 *
 * 只暴露三个窗口动作（最小化 / 最大化切换 / 关闭）与平台标识，
 * 不暴露任何 Node 能力：contextIsolation 保持开启、nodeIntegration 保持关闭。
 * 自绘标题栏需要它，但安全边界不能因此放松。
 */

const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('desktop', {
    isDesktop: true,
    platform: process.platform, // 'darwin' | 'win32' | 'linux'
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    /** 订阅最大化状态变化（自绘按钮据此切换图标），返回取消订阅函数 */
    onMaximizeChange: cb => {
      const handler = (_e, isMaximized) => cb(isMaximized);
      ipcRenderer.on('win:maximized', handler);
      return () => ipcRenderer.removeListener('win:maximized', handler);
    }
  });
} catch (err) {
  // 预加载失败不应让窗口白屏：渲染层会按「非桌面环境」降级（不显示自绘按钮）
  console.error('[preload] 暴露桌面 API 失败:', err?.message || err);
}
