/**
 * 预加载脚本 —— 渲染层与主进程之间的最小桥
 *
 * 只暴露窗口动作、外链、更新与通知等受控能力，不暴露任何 Node 能力：
 * contextIsolation 保持开启、nodeIntegration 保持关闭。
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
    /** 在系统默认浏览器中打开外部链接（央视频、咪咕等官方平台） */
    openExternal: url => ipcRenderer.send('win:open-external', url),
    /** 系统通知：赛前提醒 / 进球红牌 / 终场；主进程负责前台抑制与点击聚焦 */
    notify: payload => ipcRenderer.send('app:notify', payload),
    /** 订阅通知点击要聚焦的比赛，返回取消订阅函数 */
    onNotificationFocus: cb => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('notification:focus', handler);
      return () => ipcRenderer.removeListener('notification:focus', handler);
    },
    /** 检查桌面端版本更新 */
    checkForUpdates: () => ipcRenderer.send('updater:check'),
    /** 开始下载新版本 */
    downloadUpdate: () => ipcRenderer.send('updater:download'),
    /** 退出并安装更新 */
    quitAndInstall: () => ipcRenderer.send('updater:install'),
    /** 订阅自动更新生命周期事件，返回取消订阅函数 */
    onUpdaterEvent: cb => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('updater:event', handler);
      return () => ipcRenderer.removeListener('updater:event', handler);
    },
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
