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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/index.js';
import { loadRules } from '../server/proxy.js';
import { ts as fixtureTs } from '../src/core/engine.js';

app.disableHardwareAcceleration();

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
const PRELOAD = resolve(ROOT, 'electron/preload.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 选择一个明确仍在未来的场次，避免赛后数据更新后把「指数」断言误判成完赛行。 */
const repoFixtures = JSON.parse(readFileSync(resolve(ROOT, 'src/data/fixtures.json'), 'utf8'));
const futureFixture = repoFixtures.find(
  m => m.st === 'sched' && !m.tbd && fixtureTs(m.t) > Date.now() + 2 * 3600000
);
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

    /* 「情报」是页内定位，不是弹窗。1440 下目标本来就完整可见，
       scrollIntoView 不会产生位移 —— 必须靠高亮 + 焦点给出反馈。 */
    const heroIntelClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent || '').trim() === '查看赛前情报'
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(180);
    const heroIntelFeedback = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.getElementById('intel-panel');
        return {
          hasFlash: panel?.classList.contains('locate-focus-flash') || false,
          focused: document.activeElement === panel
        };
      })()
    `);
    ok('★ 已选中 Hero 的主按钮可直达赛前情报（不再空动作）',
      heroIntelClicked && heroIntelFeedback.hasFlash && heroIntelFeedback.focused,
      JSON.stringify(heroIntelFeedback));
    await sleep(1100);

    const intelClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent || '').trim() === '情报'
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(180);
    const intelFeedback = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.getElementById('intel-panel');
        return {
          hasFlash: panel?.classList.contains('locate-focus-flash') || false,
          focused: document.activeElement === panel,
          scrollTop: document.querySelectorAll('main > section')[1]?.scrollTop ?? null
        };
      })()
    `);
    ok('★ 目标已在视口内时「情报」仍有高亮与焦点反馈',
      intelClicked && intelFeedback.hasFlash && intelFeedback.focused,
      JSON.stringify(intelFeedback));
    await sleep(1150);
    const intelFlashCleared = await win.webContents.executeJavaScript(
      `!document.getElementById('intel-panel')?.classList.contains('locate-focus-flash')`
    );
    ok('情报高亮自动收起', intelFlashCleared);

    const linesClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent || '').trim() === '查看线路'
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(180);
    const linesFeedback = await win.webContents.executeJavaScript(`
      (() => {
        const head = document.getElementById('match-lines');
        return {
          hasFlash: head?.classList.contains('locate-focus-flash') || false,
          focused: document.activeElement === head,
          scrollTop: document.querySelectorAll('main > section')[1]?.scrollTop ?? null
        };
      })()
    `);
    ok('★ 目标已在视口内时「查看线路」同样有高亮与焦点反馈',
      linesClicked && linesFeedback.hasFlash && linesFeedback.focused,
      JSON.stringify(linesFeedback));

    const searchClicked = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('button[aria-label="搜索"]');
        if (!el) return false;
        el.focus();
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
    const paletteFocusReturned = await win.webContents.executeJavaScript(
      `document.activeElement?.getAttribute('aria-label') === '搜索'`
    );
    ok('命令面板关闭后焦点回到搜索入口', paletteFocusReturned);

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

    // 验证情报面板第 3 个 Tab：关联赛程（合并双方后续赛程 + 同夜其他推荐）
    const relatedClicked = await win.webContents.executeJavaScript(`
      (() => {
        const nodes = [...document.querySelectorAll('button, [role="tab"]')];
        const tab = nodes.find(n => (n.textContent || '').includes('关联赛程'));
        if (!tab) return false;
        tab.click();
        return true;
      })()
    `);
    await sleep(400);
    const relatedState = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('#intel-panel');
        if (!panel) return { ok: false, overflow: true, text: '' };
        return {
          ok: panel.innerText.includes('双方后续赛程') && panel.innerText.includes('同夜其他推荐'),
          overflow: panel.scrollWidth > panel.clientWidth + 1,
          text: panel.innerText.slice(0, 200)
        };
      })()
    `);
    ok('★ 关联赛程 Tab 渲染双方后续赛程与同夜推荐', relatedClicked && relatedState.ok, JSON.stringify(relatedState));
    ok('★ 关联赛程面板无横向溢出', relatedClicked && !relatedState.overflow, JSON.stringify(relatedState));

    // 切回双方数据 Tab 以继续验证完整积分榜入口
    await win.webContents.executeJavaScript(`
      (() => {
        const nodes = [...document.querySelectorAll('button, [role="tab"]')];
        const tab = nodes.find(n => (n.textContent || '').includes('双方数据'));
        tab?.click();
        return true;
      })()
    `);
    await sleep(300);

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
        btn.focus();
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
    const standingsFocusReturned = await win.webContents.executeJavaScript(
      `document.activeElement?.getAttribute('aria-label') === '积分榜'`
    );
    ok('完整积分榜关闭后焦点回到顶栏入口', standingsFocusReturned);

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

    /* ---------- 最小窗口布局门禁 ----------
       1120×700 是应用声明的最小窗口；此前顶栏换行、今晚列表被 Hero/接下来挤到 21px。
       这里只断言像素级可用性，不依赖具体比赛数据：有列表时必须留下可滚动高度。 */
    win.setContentSize(1120, 700);
    await waitLoad(win, `${base}/?view=tonight`);
    await sleep(1600);
    const compact = await win.webContents.executeJavaScript(`
      (() => {
        const header = document.querySelector('header');
        const nav = [...document.querySelectorAll('nav[aria-label="视图切换"] button')];
        const navHeights = nav.map(b => Math.round(b.getBoundingClientRect().height));
        const left = document.querySelector('main > section');
        const candidates = [...(left?.querySelectorAll('.overflow-y-auto') || [])]
          .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 150 && el.scrollHeight > el.clientHeight + 20;
          })
          .map(el => ({ h: Math.round(el.getBoundingClientRect().height), sh: el.scrollHeight }));
        const visibleList = candidates.sort((a, b) => b.sh - a.sh)[0] || null;
        return {
          w: innerWidth, h: innerHeight,
          headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
          navHeights,
          list: visibleList,
          text: document.body.innerText.slice(0, 160)
        };
      })()
    `);
    ok('★ 1120 最小窗口顶栏不换行', compact.navHeights.length === 3 &&
      compact.navHeights.every(h => h <= 34), JSON.stringify(compact.navHeights));
    ok('★ 1120 最小窗口有可用列表高度',
      !compact.list || compact.list.h >= 80, JSON.stringify(compact.list));

    const railLines = await win.webContents.executeJavaScript(`
      (() => {
        const head = document.querySelector('#match-lines');
        const grid = head?.nextElementSibling;
        if (!grid) return null;
        const kids = [...grid.children].filter(el => el.tagName === 'BUTTON');
        const gr = grid.getBoundingClientRect();
        return {
          count: kids.length,
          gridW: Math.round(gr.width),
          firstW: kids[0] ? Math.round(kids[0].getBoundingClientRect().width) : 0
        };
      })()
    `);
    ok('★ 1120 单条线路占满行宽（不再只占半行）',
      !railLines || railLines.count !== 1 || railLines.firstW >= railLines.gridW - 24,
      JSON.stringify(railLines));

    /* ---------- 周视图日期口径 ----------
       owlDay 传入日期字符串而不是时间戳会得到 NaN；此前「本周精选」行因此显示 aN/NaN。 */
    await waitLoad(win, `${base}/?view=week`);
    await sleep(1400);
    const weekText = await win.webContents.executeJavaScript(
      `document.body.innerText.slice(0, 1600)`
    );
    ok('★ 周视图有本周精选', weekText.includes('本周精选'));
    ok('★ 周视图日期无 NaN（owlDay 字符串口径）',
      !/NaN|aN\/NaN/.test(weekText), weekText.slice(0, 240));

    /* ---------- 1366×768 视口与赛程筛选抽屉验证 ---------- */
    win.setContentSize(1366, 768);
    await waitLoad(win, `${base}/?view=schedule`);
    await sleep(1400);
    const filterBtnClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button[aria-expanded]')].find(
          b => (b.textContent || '').includes('筛选')
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(300);
    const scheduleFilterCheck = await win.webContents.executeJavaScript(`
      (() => {
        const region = document.querySelector('[role="region"][aria-label="赛程筛选面板"]');
        if (!region) return { opened: false, overflow: true, switches: [], text: '' };
        return {
          opened: true,
          overflow: region.scrollWidth > region.clientWidth + 1,
          switches: [...region.querySelectorAll('[role="switch"]')].map(s => ({
            label: s.getAttribute('aria-label'),
            checked: s.getAttribute('aria-checked'),
            disabled: s.disabled,
            describedBy: s.getAttribute('aria-describedby')
          })),
          text: region.innerText.slice(0, 400)
        };
      })()
    `);
    ok('★ 1366 视口赛程筛选抽屉可打开且不横向溢出',
      filterBtnClicked && scheduleFilterCheck.opened && !scheduleFilterCheck.overflow,
      JSON.stringify(scheduleFilterCheck));
    ok('★ 赛程筛选两个开关有可见标题、说明与无障碍关联',
      scheduleFilterCheck.switches.length === 2 &&
        scheduleFilterCheck.switches.every(s => s.label && s.describedBy) &&
        scheduleFilterCheck.text.includes('只看关注球队') &&
        scheduleFilterCheck.text.includes('防剧透模式'),
      JSON.stringify(scheduleFilterCheck));

    const spoilerBefore = await win.webContents.executeJavaScript(`
      (() => {
        const region = document.querySelector('[role="region"][aria-label="赛程筛选面板"]');
        const sw = [...(region?.querySelectorAll('[role="switch"]') || [])].find(
          s => s.getAttribute('aria-label') === '防剧透模式'
        );
        if (!sw) return null;
        const before = sw.getAttribute('aria-checked');
        sw.click();
        return before;
      })()
    `);
    await sleep(300);
    const spoilerAfter = await win.webContents.executeJavaScript(`
      (() => {
        const region = document.querySelector('[role="region"][aria-label="赛程筛选面板"]');
        const sw = [...(region?.querySelectorAll('[role="switch"]') || [])].find(
          s => s.getAttribute('aria-label') === '防剧透模式'
        );
        return {
          checked: sw?.getAttribute('aria-checked') ?? null,
          regionOpen: !!region,
          text: region?.innerText.slice(0, 200) || ''
        };
      })()
    `);
    ok('★ 赛程筛选开关点击后可见状态切换',
      spoilerBefore != null && spoilerAfter.checked !== spoilerBefore && spoilerAfter.regionOpen,
      JSON.stringify({ spoilerBefore, spoilerAfter }));

    const escapeDispatched = await win.webContents.executeJavaScript(`
      (() => {
        const region = document.querySelector('[role="region"][aria-label="赛程筛选面板"]');
        if (!region) return false;
        const target = region.contains(document.activeElement) ? document.activeElement : region;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      })()
    `);
    await sleep(300);
    const filterClosedByEsc = await win.webContents.executeJavaScript(`
      (() => ({
        closed: !document.querySelector('[role="region"][aria-label="赛程筛选面板"]'),
        triggerFocused: document.activeElement?.getAttribute('aria-expanded') === 'false'
      }))()
    `);
    ok('★ 赛程筛选面板按 Esc 关闭并归还焦点',
      escapeDispatched && filterClosedByEsc.closed && filterClosedByEsc.triggerFocused,
      JSON.stringify(filterClosedByEsc));

    // 全季 + 精确查询：任意日期都能稳定命中这一场未开赛，验证行右侧是指数而不是重复的「未开赛」
    await win.webContents.executeJavaScript(`
      (() => {
        const all = [...document.querySelectorAll('button[aria-pressed]')].find(
          b => (b.textContent || '').trim() === '全部'
        );
        all?.click();
        return !!all;
      })()
    `);
    await sleep(350);
    await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('input[placeholder^="搜索球队"]');
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(futureFixture?.id || 'SA-9-MIL-BOL')});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    await sleep(500);
    const scheduleRowIndex = await win.webContents.executeJavaScript(`
      (() => {
        const left = document.querySelector('main > section');
        const row = [...(left?.querySelectorAll('[role="button"]') || [])].find(
          n => (n.textContent || '').includes('指数')
        );
        return { found: !!row, text: row?.textContent || '' };
      })()
    `);
    ok('★ 赛程未开赛行显示夜猫指数而非重复「未开赛」',
      scheduleRowIndex.found &&
        scheduleRowIndex.text.includes('指数') &&
        !scheduleRowIndex.text.includes('未开赛'),
      JSON.stringify(scheduleRowIndex));

    /* ---------- 暗色唯一主题 ----------
       浅色主题已整体移除；旧版本可能残留 localStorage 的 light 偏好，必须被忽略。 */
    await win.webContents.executeJavaScript(
      `localStorage.setItem('nightowl:theme', 'light'); localStorage.setItem('theme', 'light'); true`
    );
    await waitLoad(win, `${base}/?view=tonight`);
    await sleep(1500);
    const darkOnly = await win.webContents.executeJavaScript(`
      (() => ({
        isDark: document.documentElement.classList.contains('dark'),
        hasLight: document.documentElement.classList.contains('light'),
        dataTheme: document.documentElement.getAttribute('data-theme'),
        rootChildren: document.getElementById('root')?.children.length || 0
      }))()
    `);
    ok('★ 暗色为唯一主题（残留 light 偏好被忽略）',
      darkOnly.isDark && !darkOnly.hasLight && darkOnly.dataTheme === 'dark' && darkOnly.rootChildren >= 1,
      JSON.stringify(darkOnly));

    await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent || '').includes('偏好与数据')
        );
        btn?.focus();
        btn?.click();
        return !!btn;
      })()
    `);
    await sleep(400);
    const settingsThemeRemoved = await win.webContents.executeJavaScript(`
      (() => {
        const aside = document.querySelector('aside');
        const text = aside?.innerText || '';
        return {
          open: !!aside,
          hasThemeSection: text.includes('界面主题') || text.includes('日间演播室'),
          hasFollowSection: text.includes('关注球队')
        };
      })()
    `);
    ok('★ 设置中不再出现浅色主题入口',
      settingsThemeRemoved.open && !settingsThemeRemoved.hasThemeSection && settingsThemeRemoved.hasFollowSection,
      JSON.stringify(settingsThemeRemoved));

    const resetClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('aside button')].find(
          b => (b.textContent || '').trim() === '恢复默认'
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(250);
    const resetPending = await win.webContents.executeJavaScript(`
      (() => ({
        confirming: (document.querySelector('aside')?.innerText || '').includes('恢复默认？'),
        teams: localStorage.getItem('followedTeams')
      }))()
    `);
    ok('★ 恢复默认先进入二次确认，不直接清空偏好',
      resetClicked && resetPending.confirming && resetPending.teams === '["ARS"]',
      JSON.stringify(resetPending));

    const resetCancelled = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('aside button')].find(
          b => (b.textContent || '').trim() === '取消'
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(250);
    const resetAfterCancel = await win.webContents.executeJavaScript(`
      (() => ({
        stillConfirming: (document.querySelector('aside')?.innerText || '').includes('恢复默认？'),
        teams: localStorage.getItem('followedTeams')
      }))()
    `);
    ok('取消恢复默认后偏好不变',
      resetCancelled && !resetAfterCancel.stillConfirming && resetAfterCancel.teams === '["ARS"]',
      JSON.stringify(resetAfterCancel));

    const updateOpened = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('aside button')].find(
          b => (b.textContent || '').trim() === '检查更新'
        );
        if (!btn) return false;
        btn.focus();
        btn.click();
        return true;
      })()
    `);
    await sleep(350);
    const updateStack = await win.webContents.executeJavaScript(`
      (() => {
        const modal = document.querySelector('[aria-label="版本更新"]');
        const aside = document.querySelector('aside');
        return {
          open: !!modal,
          lowerInert: !!aside?.parentElement?.hasAttribute('inert'),
          active: document.activeElement?.getAttribute('aria-label') || ''
        };
      })()
    `);
    ok('★ 更新弹窗打开时下层设置抽屉退出焦点（inert）',
      updateOpened && updateStack.open && updateStack.lowerInert && updateStack.active === '关闭',
      JSON.stringify(updateStack));

    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
    );
    await sleep(300);
    const updateClosed = await win.webContents.executeJavaScript(`
      (() => ({
        closed: !document.querySelector('[aria-label="版本更新"]'),
        focusBack: (document.activeElement?.textContent || '').includes('检查更新')
      }))()
    `);
    ok('更新弹窗关闭后焦点回到检查更新入口',
      updateClosed.closed && updateClosed.focusBack, JSON.stringify(updateClosed));

    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
    );
    await sleep(300);
    const settingsFocusReturned = await win.webContents.executeJavaScript(`
      document.activeElement?.textContent?.includes('偏好与数据') || false
    `);
    ok('设置关闭后焦点回到偏好入口', settingsFocusReturned);

    /* ---------- 首次启动：开屏与引导的焦点交接 ---------- */
    await win.webContents.executeJavaScript(`localStorage.clear(); true`);
    await waitLoad(win, `${base}/?view=tonight`);
    await sleep(500);
    const firstRun = await win.webContents.executeJavaScript(`
      (() => ({
        splash: !!document.querySelector('[aria-label="夜猫看台开屏画面"]'),
        onboarding: !!document.querySelector('[aria-labelledby="onboarding-title"]'),
        active: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 20)
      }))()
    `);
    ok('★ 首启开屏期间不挂载引导（避免焦点落在被遮挡输入）',
      firstRun.splash && !firstRun.onboarding, JSON.stringify(firstRun));
    await sleep(2600);
    const onboardingReady = await win.webContents.executeJavaScript(`
      (() => ({
        visible: !!document.querySelector('[aria-labelledby="onboarding-title"]'),
        step: document.querySelector('#onboarding-title')?.parentElement?.innerText || '',
        placeholder: document.activeElement?.placeholder || ''
      }))()
    `);
    ok('★ 开屏结束后引导第 1 步自动聚焦球队搜索',
      onboardingReady.visible &&
        onboardingReady.step.includes('第 1 / 2 步') &&
        onboardingReady.placeholder.includes('搜索 111 支球队'),
      JSON.stringify(onboardingReady));

    const onboardingNext = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent || '').trim().startsWith('下一步')
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(400);
    const onboardingStep2 = await win.webContents.executeJavaScript(`
      (() => ({
        step: document.querySelector('#onboarding-title')?.parentElement?.innerText || '',
        active: document.activeElement?.textContent?.trim() || ''
      }))()
    `);
    ok('★ 引导第 2 步聚焦第一个联赛选项',
      onboardingNext && onboardingStep2.step.includes('第 2 / 2 步') && onboardingStep2.active === '英超',
      JSON.stringify(onboardingStep2));

    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(400);
    const onboardingEscaped = await win.webContents.executeJavaScript(`
      (() => ({
        visible: !!document.querySelector('[aria-labelledby="onboarding-title"]'),
        done: localStorage.getItem('onboardingDone')
      }))()
    `);
    ok('★ 引导按 Esc 关闭时写入完成标记（下次启动不再重复）',
      !onboardingEscaped.visible && onboardingEscaped.done === '1',
      JSON.stringify(onboardingEscaped));

    await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent || '').includes('偏好与数据')
        );
        btn?.click();
        return !!btn;
      })()
    `);
    await sleep(400);
    const rerunClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('aside button')].find(
          b => (b.textContent || '').trim() === '重新引导'
        );
        btn?.click();
        return !!btn;
      })()
    `);
    await sleep(500);
    const onboardingRerun = await win.webContents.executeJavaScript(`
      (() => ({
        visible: !!document.querySelector('[aria-labelledby="onboarding-title"]'),
        step: document.querySelector('#onboarding-title')?.parentElement?.innerText || '',
        placeholder: document.activeElement?.placeholder || ''
      }))()
    `);
    ok('★ 重新引导回到第 1 步并恢复球队搜索焦点',
      rerunClicked && onboardingRerun.visible &&
        onboardingRerun.step.includes('第 1 / 2 步') &&
        onboardingRerun.placeholder.includes('搜索 111 支球队'),
      JSON.stringify(onboardingRerun));
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
