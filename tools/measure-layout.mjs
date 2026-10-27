/**
 * 布局测量：验证「macOS hiddenInset vs Windows frame:false」内容区口径
 * 与 1440/1366/1120 三档下的左栏列表高度。只测量，不改产品代码。
 */
import electron from 'electron';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/index.js';
import { loadRules } from '../server/proxy.js';

const { app, BrowserWindow } = electron;

app.disableHardwareAcceleration();
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
const PRELOAD = resolve(ROOT, 'electron/preload.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const isMac = process.platform === 'darwin';
const frames = [
  { label: isMac ? 'macOS hiddenInset' : 'platform', opts: isMac ? { titleBarStyle: 'hiddenInset' } : { frame: false } },
  { label: 'frame:false(=Windows)', opts: { frame: false } },
];
const sizes = [[1440, 900], [1366, 768], [1120, 700]];

app.whenReady().then(async () => {
  if (!existsSync(resolve(DIST, 'index.html'))) { console.error('no dist'); app.exit(1); return; }
  const silent = { log: () => {}, warn: () => {}, error: () => {} };
  const server = createServer(loadRules(), silent, { backgroundSync: false });
  const port = await new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
  const base = `http://127.0.0.1:${port}`;

  for (const f of frames) {
    let win = null;
    try {
      console.log(`>> 开窗 ${f.label}`);
      win = new BrowserWindow({
        width: 1440, height: 900, show: false, paintWhenInitiallyHidden: true,
        backgroundColor: '#0b0e15',
        ...f.opts,
        webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
      });
      await win.loadURL(base).catch(e => console.log('  loadURL:', e.message));
      await sleep(1500);
    } catch (e) { console.log('  !! 开窗失败:', e.message); }
    for (const [w, h] of sizes) {
      try {
        console.log(`>> 测量 ${f.label} ${w}×${h}`);
        win.setBounds({ width: w, height: h });
        await sleep(200);
        await win.webContents.executeJavaScript(`localStorage.setItem('onboardingDone','1');localStorage.setItem('followedTeams','["ARS"]');localStorage.setItem('spoilerFree','false');`).catch(() => {});
        await win.loadURL(base).catch(e => console.log('  reload:', e.message));
        await sleep(2000);
        const m = await win.webContents.executeJavaScript(`(() => {
          const q = (s) => document.querySelector(s);
          const header = q('header') || q('body > div > header');
          const list = [...document.querySelectorAll('div')].filter(d => {
            const r = d.getBoundingClientRect();
            return r.width > 200 && r.height < 600 && d.scrollHeight > d.clientHeight + 150 && d.className && /scrollbar/.test(String(d.className));
          }).map(d => ({ h: Math.round(d.getBoundingClientRect().height), sh: d.scrollHeight, cls: String(d.className).slice(0, 55) }));
          return {
            innerH: window.innerHeight, innerW: window.innerWidth,
            docH: document.documentElement.clientHeight,
            headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
            scrollables: list.slice(0, 5)
          };
        })()`);
        console.log(`[${f.label}] ${w}×${h}  innerH=${m.innerH} docH=${m.docH} header=${m.headerH}`);
        m.scrollables.forEach(s => console.log(`    滚动容器 h=${s.h} scrollH=${s.sh}  ${s.cls}`));
      } catch (e) {
        console.log('  !! 失败:', e.message);
      }
      await sleep(200);
    }
    if (win && !win.isDestroyed()) win.destroy();
    await sleep(300);
  }
  console.log('>> 全部测完');
  server.close();
  app.exit(0);
}).catch(e => { console.error('FATAL', e); app.exit(1); });

app.on('window-all-closed', (e) => {});
process.on('unhandledRejection', (e) => console.log('unhandledRejection:', e && e.message));
