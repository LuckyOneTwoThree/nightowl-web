/**
 * Electron 主进程 —— 夜猫看台桌面版（P5-T5-1 最小外壳）
 *
 * 架构约定（PRD P5）：
 *   · 主进程**同进程托管本地服务**，窗口加载 http://127.0.0.1:3100
 *     —— 直接复用 Web 版的 server/，零分叉（服务无任何第三方依赖，打包简单）
 *   · 服务只绑 127.0.0.1（server 内部有硬校验，PRD §1.3）
 *   · 单实例锁：重复启动时聚焦已有窗口，而不是开出第二个实例抢端口
 *   · 窗口全关 = 退出应用，并释放端口
 *
 * 为什么主进程用 CJS：
 *   项目 "type":"module"，server/ 是 ESM。实测本机 Electron 33 的 ESM 主进程
 *   在 `import { app } from 'electron'` 一步就崩（cjsPreparseModuleExports），
 *   而 CJS 主进程 + 动态 import() 复用 ESM 服务链是标准姿势，最稳。
 *   注意 .cjs 后缀是必须的 —— 否则会被 "type":"module" 当成 ESM。
 */

const { app, BrowserWindow, dialog, ipcMain, shell, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PORT_CANDIDATES = [3100, 3101, 3102, 3103, 3104];
const HOST = '127.0.0.1';

let httpServer = null;
let appPort = PORT_CANDIDATES[0];
let mainWindow = null;
let tray = null;
/** 真正退出（托盘菜单「退出」/ 系统关机）时为 true，用于放行 close 事件 */
let isQuitting = false;

/**
 * 桌面外壳自身的设置（与渲染层 localStorage 里的偏好分开）
 *
 * 为什么要单独存一份：
 *   这些开关必须在**窗口还没创建、渲染层还没加载**时就能生效 ——
 *   开机自启要不要静默启动、点关闭按钮要不要只是隐藏，都是主进程在窗口生命周期
 *   事件里当场判断的，等不到一次 IPC 往返。
 *
 * 落点：userData/desktop-settings.json（与保鲜数据同目录，卸载时一并清理）
 */
const DESKTOP_DEFAULTS = { closeToTray: false, launchAtLogin: false };
let desktopSettings = { ...DESKTOP_DEFAULTS };

function desktopSettingsPath() {
  try {
    return path.join(app.getPath('userData'), 'desktop-settings.json');
  } catch {
    return null;
  }
}

function loadDesktopSettings() {
  const file = desktopSettingsPath();
  if (!file) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    desktopSettings = {
      closeToTray: raw?.closeToTray === true,
      launchAtLogin: raw?.launchAtLogin === true
    };
  } catch {
    // 首次运行没有文件、或文件损坏 → 用默认值，不阻断启动
    desktopSettings = { ...DESKTOP_DEFAULTS };
  }
}

function saveDesktopSettings(next) {
  desktopSettings = { ...desktopSettings, ...next };
  const file = desktopSettingsPath();
  if (!file) return desktopSettings;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 原子写：写一半崩溃不会留下半截 JSON
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(desktopSettings, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn('[main] 桌面设置写入失败:', err?.message || err);
  }
  return desktopSettings;
}

/**
 * 开机自启
 *
 * macOS 用 openAsHidden（登录时不弹窗口）；Windows 用 --hidden 参数，
 * 由启动参数决定是否显示主窗口 —— 两个平台没有统一 API，必须分开处理。
 * 失败不回滚设置：系统可能拒绝（沙箱 / 企业策略），下次打开设置页会看到真实状态。
 */
function applyLaunchAtLogin(enabled) {
  try {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true });
    } else if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
    }
  } catch (err) {
    console.warn('[main] 开机自启设置失败:', err?.message || err);
  }
}

/** 本次启动是否应该静默（自启时不抢焦点，只常驻托盘） */
function isHiddenStart() {
  if (process.argv.includes('--hidden')) return true;
  try {
    if (process.platform === 'darwin' && app.getLoginItemSettings?.().wasOpenedAtLogin) return true;
  } catch {
    /* 忽略：拿不到就按正常启动 */
  }
  return false;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}


/**
 * 启动本地服务。端口被占（多半是已有实例）时 reject，由调用方提示
 *
 * Windows 特有坑：装过 WSL / Hyper-V / Docker 的机器，winnat 会保留大段端口
 * （`netsh interface ipv4 show excludedportrange protocol=tcp` 可查），
 * 恰好命中 3100 时 listen 直接 EACCES。故做端口序列回退，而不是让用户处理端口。
 */
async function startAppServer() {
  // 把可写的数据目录交给服务端：安装目录（Program Files）只读，
  // 保鲜同步必须写到 userData，否则「刚结束的比赛永远显示待录比分」。
  // 必须在 import server 之前设置 —— 数据落点在模块加载时就解析。
  try {
    process.env.NIGHTOWL_USER_DATA = app.getPath('userData');
  } catch (err) {
    console.warn('[main] 无法取得 userData 路径，保鲜将只能预览：', err?.message || err);
  }

  // server 是 ESM（项目 type:module），CJS 里用动态 import 复用。
  // 注意：createServer 在 server/index.js，loadRules 在 server/proxy.js —— 分开导入
  const [{ createServer }, { loadRules }] = await Promise.all([
    import('../server/index.js'),
    import('../server/proxy.js')
  ]);
  const rules = loadRules();
  const errors = [];
  for (const port of PORT_CANDIDATES) {
    const server = createServer(rules);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, resolve);
      });
      appPort = port;
      return server;
    } catch (err) {
      errors.push(`${port} → ${err.code || err.message}`);
      try {
        server.close();
      } catch {
        /* 未监听成功则忽略 */
      }
    }
  }
  throw new Error(`以下端口全部无法监听：${errors.join('；')}`);
}

function createWindow({ hidden = false } = {}) {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#0b0e13', // 与 UI 底色一致，避免启动白闪
    // 先不显示，loadURL 完成后再 show：首帧即完整界面，不会看到白底空窗
    show: false,
    // 无边框窗口：外圈系统边框与标题栏去掉，由渲染层自绘（VS Code / Discord 同款做法）
    // macOS 用 hiddenInset 保留交通灯（红黄绿），Windows/Linux 完全自绘
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    title: '夜猫看台',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      // 渲染层是纯 Web（React + ArtPlayer），不需要任何 Node 能力
      preload: path.join(__dirname, 'preload.cjs'), // 只暴露固定的窗口/托盘/通知动作
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  /**
   * 关闭按钮的两种语义
   *
   *   closeToTray = false（默认）：直接关窗 → window-all-closed → 释放端口并退出
   *   closeToTray = true        ：只隐藏窗口，托盘常驻，已授权的通知继续发出
   *
   * 真正退出（托盘菜单 / before-quit）时 isQuitting 为 true，必须放行，
   * 否则「退出」按钮也会变成「隐藏」，用户只能去活动监视器杀进程。
   */
  mainWindow.on('close', event => {
    if (isQuitting) return;
    if (desktopSettings.closeToTray && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // 隐藏态启动（自启）时不抢焦点，等用户从托盘唤出
  mainWindow.once('ready-to-show', () => {
    if (!hidden) showMainWindow();
  });
  // 最大化状态变化 → 通知渲染层切换按钮图标
  const pushMaximized = () => {
    mainWindow?.webContents.send('win:maximized', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', pushMaximized);
  mainWindow.on('unmaximize', pushMaximized);

  // 拦截所有新窗口请求（如 target="_blank" 或 window.open）：
  // 严禁打开内部无地址栏、无登录态的 Electron 裸窗口，一律直接唤起用户的系统默认浏览器（Chrome / Safari / Edge 等）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 拦截主窗口非本地服务的页面跳转，防止桌面应用内部被意外导航到外部网站
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // ⚠️ 不能用 url.startsWith(appOrigin)：userinfo 欺骗
    // （http://127.0.0.1:3100@evil.com/）与后缀域名（http://127.0.0.1:3100.evil.com/）
    // 都能通过前缀匹配，却会把外部站点加载进无地址栏的应用窗口。按 origin 严格比对。
    const appOrigin = `http://${HOST}:${appPort}`;
    let targetOrigin = null;
    try {
      targetOrigin = new URL(url).origin;
    } catch {
      targetOrigin = null; // 非法 URL 一律拦截
    }
    if (targetOrigin !== appOrigin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  /**
   * 内容安全策略（深度复审 P2）
   *
   * 窗口是 frame:false 自绘标题栏、无地址栏，一旦未来出现任何注入点，钓鱼会非常逼真，
   * 而 CSP 是零成本兜底。渲染层目前注入面极小（无 dangerouslySetInnerHTML / innerHTML /
   * iframe，React 默认转义），但防御不能依赖「现在没有」。
   *
   * 策略说明：
   *   · script-src 'self' —— 构建产物是 Vite 标准外部模块，无内联脚本
   *   · style-src 需 'unsafe-inline' —— 组件大量使用 style={{}} 内联样式（React 行为，
   *     非用户输入），不放行会整体破坏布局；内联样式不是脚本执行通道
   *   · media-src blob: —— hls.js 通过 MediaSource 给 video 喂 blob: 流
   *   · connect-src 只放行自身 + GitHub Releases API（网页端更新检测）
   *
   * 窗口加载的永远是本地服务的 dist 构建产物（electron:dev 与打包版同源），
   * 故无条件生效；Vite 开发服务器只在浏览器里单独跑，不受此 CSP 影响。
   */
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            "media-src 'self' blob:",
            "connect-src 'self' https://api.github.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'"
          ].join('; ')
        ]
      }
    });
  });

  return mainWindow;
}

/* ---------------- 托盘 ---------------- */

/**
 * 托盘图标
 *
 * 复用 build/icon.png（打包产物里已包含）。macOS 菜单栏按 18px 渲染，
 * 其余平台给 16–18px 也就够了；取不到图标时**不阻断启动**，只是没有托盘。
 */
function trayImage() {
  try {
    const iconPath = path.join(__dirname, '../build/icon.png');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return null;
    return image.resize({ width: 18, height: 18 });
  } catch {
    return null;
  }
}

function createTray() {
  if (tray) return tray;
  const image = trayImage();
  if (!image) {
    console.warn('[main] 托盘图标不可用，跳过托盘创建');
    return null;
  }
  try {
    tray = new Tray(image);
    tray.setToolTip('夜猫看台');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开应用', click: showMainWindow },
        { label: '今晚之选', click: () => navigateTo('tonight') },
        { label: '本周规划', click: () => navigateTo('week') },
        { type: 'separator' },
        {
          label: '退出夜猫看台',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ])
    );
    // Windows / Linux 习惯：单击图标直接打开；macOS 单击弹菜单，保持系统一致
    if (process.platform !== 'darwin') tray.on('click', showMainWindow);
    return tray;
  } catch (err) {
    console.warn('[main] 托盘创建失败（系统限制），退回普通窗口:', err?.message || err);
    tray = null;
    return null;
  }
}

/** 托盘菜单里的导航：先亮窗口，再让渲染层切视图 */
function navigateTo(view) {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:navigate', { view });
}

/**
 * 托盘上的倒计时文本（分钟粒度）
 *
 * 由渲染层算好传上来 —— 算法与数据都在渲染层，主进程不重复一份赛程逻辑。
 * macOS 菜单栏可以带一行文字，Windows 只有 tooltip，两个都设上。
 */
function setTrayTitle(text) {
  if (!tray) return;
  const t = String(text || '').trim().slice(0, 48);
  try {
    tray.setToolTip(t || '夜猫看台');
    if (process.platform === 'darwin') tray.setTitle(t ? ` ${t}` : '');
  } catch {
    /* 托盘已被销毁：忽略 */
  }
}

ipcMain.handle('desktop:settings:get', () => ({ ...desktopSettings, platform: process.platform }));
ipcMain.handle('desktop:settings:set', (_event, patch) => {
  const next = {};
  if (typeof patch?.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
  if (typeof patch?.launchAtLogin === 'boolean') next.launchAtLogin = patch.launchAtLogin;
  const saved = saveDesktopSettings(next);
  if (typeof next.launchAtLogin === 'boolean') applyLaunchAtLogin(next.launchAtLogin);
  return { ...saved, platform: process.platform };
});
ipcMain.on('desktop:tray:title', (_event, text) => setTrayTitle(text));

/* 自绘标题栏的窗口动作（渲染层 → 主进程） */
ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow?.close());
ipcMain.handle('win:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    // 没有默认浏览器、被系统策略拦截：结果退回渲染层，由它给出「重试 / 复制链接」
    return false;
  }
});

/**
 * 系统通知（赛前 / 进球红牌 / 终场）
 *
 * 渲染层只传文案和 matchId；是否在前台抑制由主进程判断 ——
 * 用户正在看应用时，进球提醒只会打断，不应再弹一次系统通知。
 */
ipcMain.on('app:notify', (_event, payload) => {
  try {
    if (!Notification.isSupported() || !mainWindow || mainWindow.isDestroyed()) return;

    const title = String(payload?.title || '').trim().slice(0, 120);
    const body = String(payload?.body || '').trim().slice(0, 300);
    if (!title) return;

    const focused = mainWindow.isFocused() && !mainWindow.isMinimized();
    if (payload?.silentWhenFocused && focused) return;

    const matchId = typeof payload?.matchId === 'string' ? payload.matchId.slice(0, 120) : null;
    const kind = typeof payload?.kind === 'string' ? payload.kind.slice(0, 32) : null;

    const notice = new Notification({
      title,
      body,
      icon: path.join(__dirname, '../build/icon.png'),
      silent: false
    });

    notice.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('notification:focus', { matchId, kind });
    });

    notice.show();
  } catch (err) {
    console.warn('[main] 系统通知发送失败:', err?.message || err);
  }
});

/* ---------------- 自动更新守护（electron-updater） ---------------- */
let autoUpdater = null;
// 是否已有更新下载完成。electron-updater v6 在无已下载更新时调 quitAndInstall
// 只会记一条日志然后直接返回（不退出），渲染层表现为「点了安装没反应」。
// 用它门控安装入口，状态漂移时改为重新检测并给用户可见反馈。
let updateDownloaded = false;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('[main] 加载 electron-updater 提示:', err?.message || err);
}

function setupAutoUpdater(win) {
  if (!autoUpdater) return;

  // 尊重用户自决权：发现更新先弹窗提示日志，用户确认后再下载
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const sendUpdate = (status, payload = {}) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:event', { status, ...payload });
    }
  };

  autoUpdater.on('checking-for-update', () => {
    // 开始新一轮检测，上一轮的「已下载」状态作废
    updateDownloaded = false;
    sendUpdate('checking');
  });

  autoUpdater.on('update-available', info => {
    sendUpdate('available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || '',
      files: info.files || []
    });

    // 发现更新时，如果窗口不在前台或已最小化，发出系统级提醒
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported() && mainWindow && (!mainWindow.isFocused() || mainWindow.isMinimized())) {
        const notice = new Notification({
          title: '夜猫看台 · 发现新版本',
          body: `v${info.version} 已发布，点击查看更新详情`,
          icon: path.join(__dirname, '../build/icon.png'),
          silent: false
        });
        notice.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('updater:event', {
              status: 'available',
              version: info.version,
              focusModal: true
            });
          }
        });
        notice.show();
      }
    } catch (err) {
      console.warn('[main] 发现更新通知发送失败:', err?.message || err);
    }
  });

  autoUpdater.on('update-not-available', info => {
    sendUpdate('not-available', {
      version: info?.version || app.getVersion()
    });
  });

  autoUpdater.on('error', err => {
    sendUpdate('error', {
      message: err?.message || '检查或下载更新遇到网络异常'
    });
  });

  autoUpdater.on('download-progress', progressObj => {
    // ⚠️ 进度必须包在 progress 里：渲染层读的是 updateState.progress.percent。
    // 此前发的是平铺字段（percent 直接在顶层），progress 恒为 undefined，
    // 于是进度条永远停在 0% —— 用户看到的就是「下载没有进度提示」。
    sendUpdate('downloading', {
      progress: {
        percent: Math.round(progressObj.percent || 0),
        bytesPerSecond: progressObj.bytesPerSecond || 0,
        transferred: progressObj.transferred || 0,
        total: progressObj.total || 0
      }
    });
  });

  autoUpdater.on('update-downloaded', info => {
    updateDownloaded = true;
    sendUpdate('downloaded', { version: info.version });

    // 下载完成时补一条系统级通知：用户此刻很可能已切到别的窗口，
    // 只有应用内弹窗会被完全错过 —— 更新就绪这种事必须让人知道。
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const notice = new Notification({
          title: '夜猫看台 · 更新已就绪',
          body: `v${info.version} 已下载完成，点此回到应用完成安装`,
          icon: path.join(__dirname, '../build/icon.png'),
          silent: false
        });
        notice.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            // 让渲染层把更新弹窗弹出来（用户点通知即是明确的安装意图）
            mainWindow.webContents.send('updater:event', {
              status: 'downloaded',
              version: info.version,
              focusModal: true
            });
          }
        });
        notice.show();
      }
    } catch (err) {
      // 通知不可用（如系统关闭了通知权限）不能影响更新本身
      console.warn('[main] 更新就绪通知发送失败:', err?.message || err);
    }
  });
}

let lastUpdateCheckTime = 0;
function triggerUpdateCheck(silent = true) {
  if (!app.isPackaged || !autoUpdater) return;
  lastUpdateCheckTime = Date.now();
  autoUpdater.checkForUpdates().catch(err => {
    if (!silent && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:event', {
        status: 'error',
        message: err?.message || '检查更新失败，请稍后重试'
      });
    }
  });
}

ipcMain.on('updater:check', () => {
  if (!app.isPackaged) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:event', {
        status: 'not-available',
        version: app.getVersion(),
        isDev: true,
        message: '当前处于开发调试环境，自动更新将在打包生产版本后生效'
      });
    }
    return;
  }
  triggerUpdateCheck(false);
});

ipcMain.on('updater:download', () => {
  if (!app.isPackaged || !autoUpdater) return;
  autoUpdater.downloadUpdate().catch(err => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:event', {
        status: 'error',
        message: err?.message || '下载更新失败，可前往 GitHub 手动下载'
      });
    }
  });
});

ipcMain.on('updater:install', () => {
  if (!app.isPackaged || !autoUpdater) return;
  if (!updateDownloaded) {
    // 状态漂移（渲染层以为已就绪、主进程其实没有）：直接装会无反应。
    // 改为重新检测并告知渲染层，让按钮不再「点了没动静」。
    console.warn('[main] updater:install 被调用但没有已下载的更新，改为重新检测');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:event', {
        status: 'checking',
        message: '更新尚未下载完成，正在重新检测'
      });
    }
    triggerUpdateCheck(false);
    return;
  }
  autoUpdater.quitAndInstall(false, true);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在跑：直接退出（second-instance 事件在既有实例里聚焦窗口）
  app.quit();
} else {
  // 桌面设置必须在窗口创建前读出来：关闭行为与自启都在生命周期事件里当场判断
  loadDesktopSettings();

  app.on('second-instance', () => {
    // 从托盘隐藏后再次启动，也要把窗口叫回来
    showMainWindow();
  });

  app.on('before-quit', () => {
    // 放行 close 事件：否则 closeToTray 会把「退出」变成「隐藏」
    isQuitting = true;
  });

  app.whenReady().then(async () => {
    try {
      httpServer = await startAppServer();
    } catch (err) {
      // 显示完整堆栈：远程排障时，「无法找到 xxx」到底发生在哪一层
      // （动态 import / loadRules / listen），只有 stack 能说清
      dialog.showErrorBox(
        '夜猫看台 · 本地服务启动失败',
        `无法在 ${HOST}:${appPort} 启动本地服务。\n` +
          `常见原因：端口被占用或被 Windows 保留；杀毒软件隔离了 server/ 下的脚本文件。\n\n` +
          `${err?.message || err}\n\n${err?.stack || ''}`
      );
      app.exit(1);
      return;
    }

    const hiddenStart = isHiddenStart();
    const win = createWindow({ hidden: hiddenStart });
    setupAutoUpdater(win);
    await win.loadURL(`http://${HOST}:${appPort}/`);

    // 托盘常驻：即使窗口隐藏，通知与菜单仍然可达（FR-08 的核心）
    createTray();
    // 隐藏启动时不要抢焦点，直接把窗口留在后台
    if (!hiddenStart) win.show();

    // 启动 2 秒后静默检测一次更新（首屏渲染完毕即检，告别长时间盲区）
    setTimeout(() => {
      triggerUpdateCheck(true);
    }, 2000);

    // 后台每 45 分钟自动轮询一次更新
    setInterval(() => {
      triggerUpdateCheck(true);
    }, 45 * 60 * 1000);

    // 窗口重新切回前台时，若距上次检测超过 30 分钟则静默补检
    win.on('focus', () => {
      if (Date.now() - lastUpdateCheckTime > 30 * 60 * 1000) {
        triggerUpdateCheck(true);
      }
    });
  });

  app.on('window-all-closed', () => {
    // 托盘常驻模式下窗口只是被隐藏，走到这里说明用户真的关掉了窗口
    // （closeToTray 关闭，或托盘不可用时的降级），按原逻辑退出并释放端口。
    if (desktopSettings.closeToTray && tray && !isQuitting) return;
    if (httpServer) {
      try {
        httpServer.close();
      } catch {
        /* 已关闭则忽略 */
      }
      httpServer = null;
    }
    if (tray) {
      try {
        tray.destroy();
      } catch {
        /* 忽略 */
      }
      tray = null;
    }
    app.quit();
  });
}
