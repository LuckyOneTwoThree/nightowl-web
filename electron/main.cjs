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

const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');

const PORT_CANDIDATES = [3100, 3101, 3102, 3103, 3104];
const HOST = '127.0.0.1';

let httpServer = null;
let appPort = PORT_CANDIDATES[0];
let mainWindow = null;

/**
 * 启动本地服务。端口被占（多半是已有实例）时 reject，由调用方提示
 *
 * Windows 特有坑：装过 WSL / Hyper-V / Docker 的机器，winnat 会保留大段端口
 * （`netsh interface ipv4 show excludedportrange protocol=tcp` 可查），
 * 恰好命中 3100 时 listen 直接 EACCES。故做端口序列回退，而不是让用户处理端口。
 */
async function startAppServer() {
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#0b0e13', // 与 UI 底色一致，避免启动白闪
    autoHideMenuBar: true,
    title: '夜猫看台',
    webPreferences: {
      // 渲染层是纯 Web（React + ArtPlayer），不需要任何 Node 能力
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在跑：直接退出（second-instance 事件在既有实例里聚焦窗口）
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
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

    const win = createWindow();
    await win.loadURL(`http://${HOST}:${appPort}/`);
  });

  app.on('window-all-closed', () => {
    if (httpServer) {
      try {
        httpServer.close();
      } catch {
        /* 已关闭则忽略 */
      }
      httpServer = null;
    }
    app.quit();
  });
}
