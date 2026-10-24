/**
 * 生产构建的渲染冒烟门禁
 *
 * 背景：v0.1.25 的 MatchCanvas 漏解构一个 prop，构建与 Node 测试全过，
 * 但生产包首屏直接抛 ReferenceError，React 根节点卸载成黑屏。
 * 这个脚本用无头 Electron + 本地服务加载真实 dist，断言：
 *   · #root 有内容；
 *   · 没有 Uncaught / ReferenceError / TypeError；
 *   · 命令面板能打开并关闭；
 *   · 点击第一场比赛后应用仍存活；
 *   · 防剧透开启时完赛场次走「揭晓比分」路径不崩；
 *   · 失效深链 ?match=自动降级到今晚之选，不白屏（hooks 违规回归）。
 *
 * 运行：npm run build && npm run check:render
 * CI 在 Windows runner 上执行同一脚本。
 */

import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/index.js';
import { loadRules } from '../server/proxy.js';

app.disableHardwareAcceleration();

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
const PRELOAD = resolve(ROOT, 'electron/preload.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function waitLoad(win, url) {
  const loaded = new Promise(r => win.webContents.once('did-finish-load', r));
  return win.loadURL(url).then(() => loaded);
}

app.whenReady().then(async () => {
  if (!existsSync(resolve(DIST, 'index.html'))) {
    console.error('✗ dist/index.html 不存在，先执行 npm run build');
    app.exit(1);
    return;
  }

  const silent = { log: () => {}, warn: () => {}, error: () => {} };
  const server = createServer(loadRules(), silent, { backgroundSync: false });
  const port = await new Promise((res, rej) => {
    server.listen(0, '127.0.0.1', () => res(server.address().port));
    server.on('error', rej);
  });
  const base = `http://127.0.0.1:${port}`;

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#0b0e15',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`render-process-gone ${JSON.stringify(details)}`);
  });

  try {
    await waitLoad(win, `${base}/?view=tonight`);
    await win.webContents.executeJavaScript(`
      localStorage.setItem('onboardingDone','1');
      localStorage.setItem('nightowl:splash_shown','1');
      localStorage.setItem('followedTeams','["ARS"]');
      localStorage.setItem('spoilerFree','false');
      true
    `);
    await win.webContents.reload();
    await sleep(1800);

    const initial = await win.webContents.executeJavaScript(`
      (() => ({
        rootChildren: document.getElementById('root')?.children.length || 0,
        text: document.body.innerText.slice(0, 400)
      }))()
    `);
    ok('★ #root 已渲染', initial.rootChildren >= 1, JSON.stringify(initial));
    ok('★ 首屏含「今晚观赛」', initial.text.includes('今晚观赛'));
    ok(
      '★ 无运行时致命错误',
      !errors.some(m => /Uncaught|ReferenceError|TypeError|is not defined|Cannot read/i.test(m)),
      errors.join(' | ')
    );

    const searchClicked = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('button[aria-label="搜索"]');
        if (!el) return false;
        el.click();
        return true;
      })()
    `);
    await sleep(500);
    const paletteOpen = await win.webContents.executeJavaScript(
      `!!document.querySelector('[role="dialog"][aria-label="命令面板"]')`
    );
    ok('命令面板可打开', searchClicked && paletteOpen);

    await win.webContents.executeJavaScript(`
      document.querySelector('input[placeholder^="搜索球队、比赛或功能"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      true
    `);
    await sleep(300);
    const paletteClosed = await win.webContents.executeJavaScript(
      `!document.querySelector('[role="dialog"][aria-label="命令面板"]')`
    );
    ok('命令面板可关闭', paletteClosed);

    const rowClicked = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('main > section [role="button"]');
        if (!el) return false;
        el.click();
        return true;
      })()
    `);
    await sleep(900);
    const after = await win.webContents.executeJavaScript(`
      (() => ({
        rootChildren: document.getElementById('root')?.children.length || 0,
        text: document.body.innerText.slice(0, 300)
      }))()
    `);
    ok('点击比赛后应用仍存活', rowClicked && after.rootChildren >= 1, JSON.stringify(after));
    ok(
      '点击后无新增致命错误',
      !errors.some(m => /Uncaught|ReferenceError|TypeError|is not defined|Cannot read/i.test(m)),
      errors.join(' | ')
    );

    await waitLoad(win, `${base}/?view=tonight&match=PL-7-NFO-ARS`);
    await sleep(1800);

    // 生产 dist 下验证新功能：双方数据 Tab 必须渲染积分榜位置，且不横向溢出
    const statsClicked = await win.webContents.executeJavaScript(`
      (() => {
        const nodes = [...document.querySelectorAll('button, [role="tab"]')];
        const tab = nodes.find(n => (n.textContent || '').includes('双方数据'));
        if (!tab) return false;
        tab.click();
        return true;
      })()
    `);
    await sleep(500);
    const standings = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('#intel-panel');
        if (!panel) return { ok: false, overflow: true, text: '' };
        return {
          ok: panel.innerText.includes('积分榜位置'),
          overflow: panel.scrollWidth > panel.clientWidth + 1,
          text: panel.innerText.slice(0, 200)
        };
      })()
    `);
    ok('★ 双方数据渲染积分榜位置', statsClicked && standings.ok, JSON.stringify(standings));
    ok('★ 积分榜面板无横向溢出', statsClicked && !standings.overflow, JSON.stringify(standings));

    // 完整积分榜：从本场位置入口打开，PL 20 行；切 UCL 36 行；Escape 可关闭
    const fullOpen = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('#intel-panel');
        const btn = panel && [...panel.querySelectorAll('button')].find(b => (b.textContent || '').includes('查看完整积分榜'));
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(450);
    const fullPl = await win.webContents.executeJavaScript(`
      (() => {
        const modal = document.querySelector('[aria-labelledby="standings-title"]');
        if (!modal) return { open: false, rows: 0, overflow: true };
        const scroller = modal.querySelector('.overflow-auto');
        return {
          open: true,
          rows: modal.querySelectorAll('[data-team-id]').length,
          overflow: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : true
        };
      })()
    `);
    ok('★ 完整积分榜打开且英超 20 行', fullOpen && fullPl.open && fullPl.rows === 20, JSON.stringify(fullPl));
    ok('★ 完整积分榜无横向溢出', fullOpen && !fullPl.overflow, JSON.stringify(fullPl));

    const uclTabClicked = await win.webContents.executeJavaScript(`
      (() => {
        const modal = document.querySelector('[aria-labelledby="standings-title"]');
        if (!modal) return false;
        const tab = [...modal.querySelectorAll('[role="tab"]')].find(n => (n.textContent || '').includes('欧冠'));
        if (!tab) return false;
        tab.click();
        return true;
      })()
    `);
    await sleep(350);
    const fullUcl = await win.webContents.executeJavaScript(
      `document.querySelector('[aria-labelledby="standings-title"]')?.querySelectorAll('[data-team-id]').length || 0`
    );
    ok('★ 欧冠积分榜 36 行', uclTabClicked && fullUcl === 36, `实际 ${fullUcl}`);

    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
    );
    await sleep(300);
    const fullClosed = await win.webContents.executeJavaScript(
      `!document.querySelector('[aria-labelledby="standings-title"]')`
    );
    ok('完整积分榜可关闭', fullClosed);

    const topbarOpened = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('header button[aria-label="积分榜"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(400);
    const topbarModal = await win.webContents.executeJavaScript(`
      (() => {
        const modal = document.querySelector('[aria-labelledby="standings-title"]');
        return {
          open: !!modal,
          rows: modal ? modal.querySelectorAll('[data-team-id]').length : 0,
          text: modal ? modal.innerText.slice(0, 120) : ''
        };
      })()
    `);
    ok(
      '★ 顶栏积分榜入口打开当前联赛',
      topbarOpened && topbarModal.open && topbarModal.rows === 20 && topbarModal.text.includes('英超'),
      JSON.stringify(topbarModal)
    );
    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
    );
    await sleep(250);

    const detail = await win.webContents.executeJavaScript(`
      (() => {
        const root = document.getElementById('match-highlights');
        return {
          rootChildren: document.getElementById('root')?.children.length || 0,
          text: root?.innerText || '',
          links: root ? [...root.querySelectorAll('a')].map(a => ({
            label: (a.textContent || '').trim(),
            href: decodeURIComponent(a.getAttribute('href') || '')
          })) : []
        };
      })()
    `);
    const domestic = detail.links.filter(l => ['央视频', '咪咕视频', '爱奇艺体育', 'CCTV'].some(n => l.label.includes(n)));
    ok('★ 完赛详情渲染国内官方集锦入口', detail.rootChildren >= 1 && domestic.length >= 2, JSON.stringify(detail));
    ok(
      '★ 国内集锦链接带双方队名与“集锦”',
      domestic.length > 0 && domestic.every(l => l.href.includes('集锦') && l.href.includes('阿森纳')),
      JSON.stringify(detail.links)
    );
    ok('★ 完赛详情仍无致命错误',
      !errors.some(m => /Uncaught|ReferenceError|TypeError|is not defined|Cannot read/i.test(m)),
      errors.join(' | ')
    );

    /* ---------- 防剧透揭晓路径（spoilerFree=true）----------
       此前冒烟固定 spoilerFree=false，隐藏分支从未被真实渲染过。 */
    await win.webContents.executeJavaScript(`localStorage.setItem('spoilerFree','true'); true`);
    await waitLoad(win, `${base}/?view=tonight&match=PL-7-NFO-ARS`);
    await sleep(1600);
    const hiddenState = await win.webContents.executeJavaScript(`
      (() => {
        // 只查右栏舞台：左栏列表（补看行）的「揭晓」属于别的场次
        const right = document.querySelectorAll('main > section')[1] || document.body;
        return {
          revealBtn: [...right.querySelectorAll('button')].some(
            b => (b.textContent || '').trim() === '揭晓比分'
          )
        };
      })()
    `);
    ok('★ 防剧透开启时完赛场次提供「揭晓比分」入口', hiddenState.revealBtn, JSON.stringify(hiddenState));

    const revealClicked = await win.webContents.executeJavaScript(`
      (() => {
        const right = document.querySelectorAll('main > section')[1] || document.body;
        const btn = [...right.querySelectorAll('button')].find(
          b => (b.textContent || '').trim() === '揭晓比分'
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(600);
    const afterReveal = await win.webContents.executeJavaScript(
      `document.getElementById('root')?.children.length || 0`
    );
    ok('★ 揭晓后应用存活且无致命错误',
      revealClicked && afterReveal >= 1 &&
        !errors.some(m => /Uncaught|ReferenceError|TypeError|is not defined|Cannot read/i.test(m)),
      errors.join(' | ')
    );

    /* ---------- 失效深链自愈 ----------
       ?match=<不存在> → activeMatch null → 自动降级今晚之选（null→非 null）。
       UpcomingFixtures/SameNightPicks 曾在 useMemo 前 early-return，
       这条路径触发 "Rendered more hooks" 整页白屏（P0 hooks 修复的回归锚点）。 */
    await waitLoad(win, `${base}/?view=tonight&match=BADID-XX-YY-ZZ`);
    await sleep(1600);
    const healed = await win.webContents.executeJavaScript(`
      (() => ({
        rootChildren: document.getElementById('root')?.children.length || 0,
        matchParam: new URLSearchParams(location.search).get('match'),
        text: document.body.innerText.slice(0, 120)
      }))()
    `);
    ok('★ 失效深链不白屏（root 存活）', healed.rootChildren >= 1, JSON.stringify(healed));
    ok('★ 失效深链自愈到有效比赛', !!healed.matchParam && healed.matchParam !== 'BADID-XX-YY-ZZ', JSON.stringify(healed));
    ok('★ 失效深链路径无致命错误（含 hooks 违规回归）',
      !errors.some(m =>
        /Uncaught|ReferenceError|TypeError|is not defined|Cannot read|Rendered more hooks/i.test(m)
      ),
      errors.join(' | ')
    );
  } catch (err) {
    ok('渲染冒烟执行完成', false, String(err?.stack || err));
  } finally {
    try {
      win.destroy();
    } catch {}
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  }

  console.log('');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  app.exit(fail ? 1 : 0);
});
