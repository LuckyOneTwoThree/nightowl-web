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
import { morningDigestNight } from '../src/core/morning.js';

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

    /* 决策条（P1-1）：全屏唯一结论条，四段齐全且不重复出现。 */
    const strip = await win.webContents.executeJavaScript(`
      (() => {
        const nodes = [...document.querySelectorAll('[aria-label="今晚决策结论"]')];
        const el = nodes[0];
        const hasHero = !!document.querySelector('[data-hero-index]');
        if (!el) return { count: 0, hasHero };
        const labels = [...el.querySelectorAll('span')].map(s => (s.textContent || '').trim());
        return {
          count: nodes.length,
          hasHero,
          text: el.innerText.replace(/\\n/g, ' | '),
          hasFour: ['结论', '结束', '睡眠代价', '同夜替代'].every(k => labels.includes(k))
        };
      })()
    `);
    // Hero 是否存在取决于当晚是否有可推荐场次（数据相关），无 hero 时不做形态断言。
    ok(
      '★ 决策条四段齐全',
      strip.hasHero ? strip.count > 0 && strip.hasFour : true,
      JSON.stringify(strip)
    );
    ok('★ 决策条同屏只出现一次', strip.count <= 1, `${strip.count}`);

    /* 指数弱化：全站只有 Hero 卡与情报面板头部允许用强调色。
       列表行 / 同开球逐条 / 备选场次的指数一律走 IndexTag（次级文字色）——
       一屏几十个金色数字会让「今晚之选」失去唯一性。 */
    const indexTone = await win.webContents.executeJavaScript(`
      (() => {
        const nodes = [...document.querySelectorAll('[title^="夜猫指数"]')];
        const probe = document.createElement('span');
        probe.className = 'text-text-muted';
        document.body.appendChild(probe);
        const mutedRgb = getComputedStyle(probe).color;
        probe.remove();
        const bad = nodes.filter(n => getComputedStyle(n).color !== mutedRgb);
        return { count: nodes.length, bad: bad.length, mutedRgb, sample: bad[0] ? getComputedStyle(bad[0]).color : null };
      })()
    `);
    ok(
      '★ 列表行指数不用强调色',
      indexTone.count >= 1 && indexTone.bad === 0,
      `弱化 ${indexTone.count} 处，异常 ${indexTone.bad} 处（${indexTone.sample} ≠ ${indexTone.mutedRgb}）`
    );

    /* 同开球面板（P1-3）：默认只留一行摘要，展开才逐条铺开。
       否则欧冠整轮 7 场同开时会吃掉近 500px，把 Hero 和赛程列表一起挤死。 */
    const kickoffPanel = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('[aria-label="同开球对比"]');
        if (!panel) return { exists: false };
        const btn = panel.querySelector('button[aria-expanded]');
        return {
          exists: true,
          h: Math.round(panel.getBoundingClientRect().height),
          expanded: btn ? btn.getAttribute('aria-expanded') : null
        };
      })()
    `);
    ok(
      '★ 同开球默认收起为一行摘要',
      !kickoffPanel.exists ||
        (kickoffPanel.h <= 80 && kickoffPanel.expanded === 'false'),
      JSON.stringify(kickoffPanel)
    );

    const kickoffOpen = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('[aria-label="同开球对比"]');
        const btn = panel?.querySelector('button[aria-expanded="false"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(240);
    const kickoffAfter = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('[aria-label="同开球对比"]');
        if (!panel) return null;
        return {
          h: Math.round(panel.getBoundingClientRect().height),
          expanded: panel.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') ?? null
        };
      })()
    `);
    ok(
      '★ 展开后同开球逐条可比',
      !kickoffOpen || (kickoffAfter.h > 42 && kickoffAfter.expanded === 'true'),
      JSON.stringify(kickoffAfter)
    );

    // 收回来，避免影响后续左栏高度相关的断言
    await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('[aria-label="同开球对比"] button[aria-expanded="true"]');
        if (btn) btn.click();
        return true;
      })()
    `);
    await sleep(160);

    /* 侧轨折叠（P1-2）：无视频流时收成 52px 状态轨，展开回到 315px，焦点双向归还。 */
    const railState = await win.webContents.executeJavaScript(`
      (() => {
        const head = document.getElementById('match-lines');
        const rail = head?.parentElement;
        const expand = rail?.querySelector('button[aria-label="展开线路与官方平台"]');
        return {
          hasRail: !!rail,
          width: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
          hasExpand: !!expand,
          expandedAttr: expand ? expand.getAttribute('aria-expanded') : null
        };
      })()
    `);
    ok(
      '★ 无视频流时侧轨收成 52px 且标注 aria-expanded=false',
      !railState.hasRail ||
        (railState.width <= 60 && railState.hasExpand && railState.expandedAttr === 'false'),
      JSON.stringify(railState)
    );

    const railExpandClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('button[aria-label="展开线路与官方平台"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(240);
    const railExpanded = await win.webContents.executeJavaScript(`
      (() => {
        const head = document.getElementById('match-lines');
        const rail = head?.parentElement;
        return {
          width: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
          focused: document.activeElement === head,
          hasCollapse: !!document.querySelector('button[aria-label="收起线路侧栏"]')
        };
      })()
    `);
    ok(
      '★ 展开侧轨恢复 315px 并把焦点交给线路区',
      !railExpandClicked ||
        (railExpanded.width >= 300 && railExpanded.focused && railExpanded.hasCollapse),
      JSON.stringify(railExpanded)
    );

    const railCollapseClicked = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('button[aria-label="收起线路侧栏"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(240);
    const railBack = await win.webContents.executeJavaScript(`
      (() => {
        const head = document.getElementById('match-lines');
        const rail = head?.parentElement;
        const btn = document.querySelector('button[aria-label="展开线路与官方平台"]');
        return {
          width: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
          focusBack: !!btn && document.activeElement === btn
        };
      })()
    `);
    ok(
      '★ 收起后焦点归还展开按钮',
      !railCollapseClicked || (railBack.width <= 60 && railBack.focusBack),
      JSON.stringify(railBack)
    );

    /* 「情报」是页内定位，不是弹窗。1440 下目标本来就完整可见，
       scrollIntoView 不会产生位移 —— 必须靠高亮 + 焦点给出反馈。 */
    const heroAction = await win.webContents.executeJavaScript(`
      (() => {
        const hero = document.querySelector('main > section');
        const buttons = [...(hero?.querySelectorAll('button') || [])];
        const btn = buttons.find(b =>
          ['查看赛前情报', '查看直播线路', '查看赛后回顾', '进入直播间'].includes(
            (b.textContent || '').trim()
          )
        );
        if (!btn) return { clicked: false, target: null };
        const text = (btn.textContent || '').trim();
        const target = text.includes('情报')
          ? 'intel-panel'
          : text.includes('线路')
            ? 'match-lines'
            : 'match-recap';
        btn.click();
        return { clicked: true, target };
      })()
    `);
    await sleep(180);
    const heroActionFeedback = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.getElementById(${JSON.stringify(heroAction.target)});
        return {
          hasFlash: el?.classList.contains('locate-focus-flash') || false,
          focused: document.activeElement === el
        };
      })()
    `);
    ok('★ 已选中 Hero 的主按钮可直达当前状态对应区块',
      heroAction.clicked && heroActionFeedback.hasFlash && heroActionFeedback.focused,
      JSON.stringify({ action: heroAction, feedback: heroActionFeedback }));
    await sleep(1100);

    // 固定切到未来场次：当前时刻 Hero 可能正好是直播场，直播态没有“情报/查看线路”入口。
    await waitLoad(win, `${base}/?view=tonight&match=${futureFixture.id}`);
    await sleep(1400);

    const queueAddClicked = await win.webContents.executeJavaScript(`
      (() => {
        // 必须点「当前选中场」的入口（情报面板）。Hero 也有补看按钮，
        // 但它代表的是今晚之选，不是 ?match= 指定的那场。
        const btn =
          document.querySelector('#intel-panel [data-watch-later-action="toggle"]') ||
          [...document.querySelectorAll('[data-watch-later-action="toggle"]')].find(
            b => !b.closest('article')
          );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    await sleep(300);
    const queueAddState = await win.webContents.executeJavaScript(`
      (() => {
        const saved = JSON.parse(localStorage.getItem('nightowl:watchLater:v1') || '[]');
        return {
          button: [...document.querySelectorAll('button')].some(
            b => (b.textContent || '').trim() === '已入补看 · 取消'
          ),
          savedIds: saved.map(item => item.id),
          hasScore: [...document.querySelectorAll('button')].some(
            b => (b.textContent || '').includes('比分')
          )
        };
      })()
    `);
    ok('★ 比赛详情可加入补看并本地持久化',
      queueAddClicked && queueAddState.button && queueAddState.savedIds.includes(futureFixture.id),
      JSON.stringify(queueAddState));

    /* 情报面板三级披露（P1-4）：第一层结论级信息 + 第二层唯一主图表，
       其余分区默认收起为抽屉。此前面板把 8 个分区一次铺开，五块等权 = 没有主次。 */
    const tiered = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.getElementById('intel-panel');
        if (!panel) return { exists: false };
        const folds = [...panel.querySelectorAll('[data-fold]')];
        const text = panel.innerText;
        return {
          exists: true,
          foldCount: folds.length,
          allClosed: folds.every(b => b.getAttribute('aria-expanded') === 'false'),
          // 第一层四件：为什么看这场 / 数据可信度 必须常驻；结论在 Hero 场次被去重
          hasWhy: text.includes('为什么看这场'),
          hasTrust: text.includes('数据可信度'),
          hasVerdict: text.includes('结论'),
          hasChart: text.includes('指数归因'),
          foldTitles: folds.map(b => b.getAttribute('data-fold'))
        };
      })()
    `);
    ok(
      '★ 情报面板首屏只留结论级信息',
      tiered.exists && tiered.hasWhy && tiered.hasTrust && tiered.hasChart,
      JSON.stringify(tiered)
    );
    ok(
      '★ 面板次级分区默认收起（第三层抽屉）',
      tiered.foldCount >= 1 && tiered.allClosed,
      JSON.stringify(tiered.foldTitles)
    );

    // 点击与读取必须分成两次执行：React 的 setState 在下一帧才生效，
    // 同一次 executeJavaScript 里点完立刻读，只会读到折叠前的 DOM。
    const foldBefore = await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.getElementById('intel-panel');
        const btn = panel.querySelector('[data-fold]');
        if (!btn) return { ok: false };
        const bodyId = btn.getAttribute('aria-controls');
        const before = (document.getElementById(bodyId)?.innerText || '').trim().length;
        btn.click();
        return { ok: true, before, bodyId };
      })()
    `);
    await sleep(200);
    const foldExpanded = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.getElementById('intel-panel').querySelector('[data-fold]');
        const bodyId = btn.getAttribute('aria-controls');
        return {
          open: btn.getAttribute('aria-expanded'),
          after: (document.getElementById(bodyId)?.innerText || '').trim().length
        };
      })()
    `);
    ok(
      '★ 抽屉展开后才出现正文',
      foldBefore.ok && foldExpanded.open === 'true' && foldBefore.before === 0 && foldExpanded.after > 0,
      JSON.stringify({ ...foldBefore, ...foldExpanded })
    );

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

    /* ---------- 列表行「揭晓」回归 ----------
       MatchRow 里的揭晓按钮曾把 ScoreText 的无参回调当成事件对象，
       点击即抛 e.stopPropagation is not a function，比分永远不揭开。
       这里必须点左栏列表的「揭晓」（右栏舞台是另一条路径）。 */
    await waitLoad(win, `${base}/?view=schedule`);
    await sleep(1400);
    await win.webContents.executeJavaScript(`
      (() => {
        // 先滚回列表顶部：Windows 隐藏窗口下 VList 可能保留上一视图的滚动位置
        document.querySelectorAll('main > section *').forEach(el => {
          if (el.scrollHeight > el.clientHeight) el.scrollTop = 0;
        });
        const all = [...document.querySelectorAll('main > section button')].find(
          b => (b.textContent || '').trim() === '全部' && b.hasAttribute('aria-pressed')
        );
        all?.click();
        return !!all;
      })()
    `);
    // 全季列表在慢 runner 上可能 >1s 才渲染；轮询到「揭晓」出现为止，最多 5s
    let listRevealBefore = { found: false };
    for (let i = 0; i < 20; i++) {
      listRevealBefore = await win.webContents.executeJavaScript(`
        (() => {
          const rows = [...document.querySelectorAll('main > section [role="button"]')];
          const row = rows.find(r =>
            [...r.querySelectorAll('button')].some(b => (b.textContent || '').trim() === '揭晓')
          );
          if (!row) return { found: false };
          row.setAttribute('data-reveal-test', '1');
          const btn = [...row.querySelectorAll('button')].find(
            b => (b.textContent || '').trim() === '揭晓'
          );
          btn.click();
          return { found: true, text: row.textContent.slice(0, 160) };
        })()
      `);
      if (listRevealBefore.found) break;
      await sleep(250);
    }
    await sleep(500);
    const listRevealAfter = await win.webContents.executeJavaScript(`
      (() => {
        const row = document.querySelector('[data-reveal-test="1"]');
        const scoreEl = row?.querySelector('.font-bold.tabular-nums');
        return {
          text: row?.textContent?.slice(0, 160) || '',
          score: scoreEl?.textContent?.trim() || '',
          stillHasReveal: [...(row?.querySelectorAll('button') || [])].some(
            b => (b.textContent || '').trim() === '揭晓'
          )
        };
      })()
    `);
    ok('★ 列表行「揭晓」点击后比分可见',
      listRevealBefore.found && !listRevealAfter.stillHasReveal && /^\d+-\d+$/.test(listRevealAfter.score),
      JSON.stringify({ before: listRevealBefore, after: listRevealAfter }));

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

    /* ---------- 周时间轴（core/week-risk.js 接入） ----------
       行数 / 底线结论 / 筛选开关都是结构常量，不依赖当天有没有比赛、几点。
       早先这里 0 覆盖：WeekTimeline 换数据源时连「7 行还在不在」都没人守。 */
    const weekTimeline = await win.webContents.executeJavaScript(`
      (() => {
        const rows = [...document.querySelectorAll('button')].filter(b =>
          /周[一二三四五六日]，\\d+ 场/.test(b.getAttribute('aria-label') || '')
        );
        const text = document.body.innerText;
        return {
          rowCount: rows.length,
          firstLabel: rows[0]?.getAttribute('aria-label') || '',
          hasTitle: text.includes('7 晚时间轴'),
          hasFloor: text.includes('底线'),
          hasWake: text.includes('起床'),
          hasVerdict: /越过底线|未越线|全周未越线/.test(text)
        };
      })()
    `);
    ok('★ 周时间轴渲染 7 行（周一~周日）', weekTimeline.rowCount === 7, JSON.stringify(weekTimeline));
    ok('★ 周时间轴标题 / 底线 / 起床结论常驻',
      weekTimeline.hasTitle && weekTimeline.hasFloor && weekTimeline.hasWake && weekTimeline.hasVerdict,
      JSON.stringify(weekTimeline));

    // 单晚筛选：点任一行出「正在筛选」，点日期旁的「清除」收起。
    // 用「清除 M/D」精确匹配，避开设置抽屉里的线路记忆「清除」。
    const dayRowClicked = await win.webContents.executeJavaScript(`
      (() => {
        const rows = [...document.querySelectorAll('button')].filter(b =>
          /周[一二三四五六日]，\\d+ 场/.test(b.getAttribute('aria-label') || '')
        );
        if (rows.length < 4) return false;
        rows[3].click();
        return true;
      })()
    `);
    await sleep(300);
    const dayFilterOn = await win.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText;
        const clearBtn = [...document.querySelectorAll('button')].find(b =>
          /^清除 \\d{1,2}\\/\\d{1,2}/.test((b.textContent || '').trim())
        );
        return { banner: text.includes('正在筛选'), hasClear: !!clearBtn };
      })()
    `);
    ok('★ 点单晚出现筛选横幅与「清除 M/D」按钮',
      dayRowClicked && dayFilterOn.banner && dayFilterOn.hasClear, JSON.stringify(dayFilterOn));

    await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(b =>
          /^清除 \\d{1,2}\\/\\d{1,2}/.test((b.textContent || '').trim())
        );
        if (btn) btn.click();
        return !!btn;
      })()
    `);
    await sleep(300);
    const dayFilterOff = await win.webContents.executeJavaScript(
      `!document.body.innerText.includes('正在筛选')`
    );
    ok('★ 清除后筛选横幅消失', dayFilterOff);

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

    // 睡眠档案启用后，Hero 必须出现个人剩余睡眠，而不是只显示抽象的 S 档。
    await win.webContents.executeJavaScript(`
      localStorage.setItem('sleepEnabled','true');
      localStorage.setItem('sleepWakeTime','07:30');
      localStorage.setItem('sleepMinHours','7');
      true
    `);
    await waitLoad(win, `${base}/?view=tonight&match=${futureFixture.id}`);
    await sleep(1500);
    const sleepLedgerText = await win.webContents.executeJavaScript(`document.body.innerText.slice(0, 1400)`);
    ok('★ 启用睡眠档案后页面显示个人剩余睡眠',
      sleepLedgerText.includes('起床') &&
        /看完约剩|看完直接到起床点/.test(sleepLedgerText),
      sleepLedgerText.slice(0, 240));

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
          hasFollowSection: text.includes('关注球队'),
          hasSleepSection: text.includes('个人睡眠'),
          hasSleepTime: !!aside?.querySelector('input[type="time"]'),
          hasWatchLater: text.includes('明早补看')
        };
      })()
    `);
    ok('★ 设置中不再出现浅色主题入口',
      settingsThemeRemoved.open && !settingsThemeRemoved.hasThemeSection &&
        settingsThemeRemoved.hasFollowSection &&
        settingsThemeRemoved.hasSleepSection && settingsThemeRemoved.hasSleepTime &&
        settingsThemeRemoved.hasWatchLater,
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

    /* 上下文守恒（P1-6）：顶栏视图切换不该丢滚动位置。
       此前切到「本周规划」再切回，左栏列表会跳回顶部 —— 刚从第 12 场翻到这里的人得重找。 */
    await waitLoad(win, `${base}/?view=tonight`);
    await sleep(1500);
    const scrollSet = await win.webContents.executeJavaScript(`
      (() => {
        // 左栏赛程列表：TonightView 里唯一的 space-y-0.5 + overflow-y-auto 容器
        // （标题「今晚赛程」在列表外层，不能用来定位）
        const list = [...document.querySelectorAll('div')].find(
          d => typeof d.className === 'string' && d.className.includes('overflow-y-auto')
            && d.className.includes('space-y-0.5')
        );
        if (!list) return { ok: false };
        const max = list.scrollHeight - list.clientHeight;
        if (max < 120) return { ok: false, max };
        list.scrollTop = Math.min(240, max);
        return { ok: true, top: Math.round(list.scrollTop), max };
      })()
    `);
    const switchView = async label => {
      await win.webContents.executeJavaScript(`
        (() => {
          const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes(${JSON.stringify(label)}));
          b?.click();
          return !!b;
        })()
      `);
      await sleep(900);
    };
    await switchView('本周规划');
    await switchView('今晚观赛');
    const scrollRestored = await win.webContents.executeJavaScript(`
      (() => {
        // 左栏赛程列表：TonightView 里唯一的 space-y-0.5 + overflow-y-auto 容器
        // （标题「今晚赛程」在列表外层，不能用来定位）
        const list = [...document.querySelectorAll('div')].find(
          d => typeof d.className === 'string' && d.className.includes('overflow-y-auto')
            && d.className.includes('space-y-0.5')
        );
        return list ? Math.round(list.scrollTop) : null;
      })()
    `);
    ok(
      '★ 切走视图再切回保留左栏滚动位置',
      scrollSet.ok && scrollRestored != null && Math.abs(scrollRestored - scrollSet.top) <= 2,
      JSON.stringify({ set: scrollSet, restored: scrollRestored })
    );

    /* 积分榜锚定（P1-6）：带本场上下文打开时，必须把交手双方滚进视野。
       欧冠联赛阶段 36 队、弹窗 86vh，排在第 20 名的球队本来在首屏之外。 */
    const uclFixture = repoFixtures.find(m => m.l === 'UCL' && m.st === 'sched' && !m.tbd);
    if (uclFixture) {
      await waitLoad(win, `${base}/?view=tonight&match=${uclFixture.id}`);
      await sleep(1500);
      await win.webContents.executeJavaScript(`
        (() => {
          const tab = [...document.querySelectorAll('#intel-panel button')].find(b => (b.textContent || '').includes('双方数据'));
          tab?.click();
          return !!tab;
        })()
      `);
      await sleep(350);
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = [...document.querySelectorAll('#intel-panel button')].find(b => (b.textContent || '').includes('查看完整积分榜'));
          btn?.click();
          return !!btn;
        })()
      `);
      await sleep(500);
      const anchorState = await win.webContents.executeJavaScript(`
        (() => {
          const modal = document.querySelector('[aria-labelledby="standings-title"]');
          if (!modal) return { open: false };
          const scroller = modal.querySelector('.overflow-auto');
          if (!scroller) return { open: true, scroller: false };
          const box = scroller.getBoundingClientRect();
          const hits = [...modal.querySelectorAll('tr[data-team-id]')]
            .filter(r => (r.innerText || '').includes('本场'));
          return {
            open: true,
            scroller: true,
            rows: modal.querySelectorAll('[data-team-id]').length,
            scrollable: scroller.scrollHeight > scroller.clientHeight + 20,
            scrollTop: Math.round(scroller.scrollTop),
            hits: hits.length,
            visible: hits.some(r => {
              const b = r.getBoundingClientRect();
              return b.top >= box.top - 2 && b.bottom <= box.bottom + 2;
            })
          };
        })()
      `);
      ok(
        '★ 积分榜带本场打开时锚定交手双方',
        anchorState.open && anchorState.rows === 36 && anchorState.scrollable &&
          anchorState.hits === 2 && anchorState.visible,
        JSON.stringify(anchorState)
      );
      await win.webContents.executeJavaScript(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
      );
      await sleep(300);
    }

    /* 连续补看（P1-5）：摘要的主行动是「开始依序补看」，位置靠顶部会话条推进。
       清单的做法是「点开一场、看完、退回摘要、再找下一场」；连看的做法是「下一场」。
       队列用固定 3 场写入，不依赖当天快照里恰好有昨晚的场次（那会让门禁随日期漂移）。 */
    const digestNight = morningDigestNight(Date.now());
    const digestFixtures = repoFixtures.filter(m => m.st === 'done').slice(0, 3);
    const digestQueue = digestFixtures.map((m, i) => ({
      id: m.id,
      night: digestNight,
      addedAt: Date.now() - (digestFixtures.length - i) * 60000,
      status: 'pending'
    }));
    await win.webContents.executeJavaScript(`
      (() => {
        localStorage.setItem('nightowl:watchLater:v1', ${JSON.stringify(JSON.stringify(digestQueue))});
        return true;
      })()
    `);
    await waitLoad(win, `${base}/?view=tonight`);
    await sleep(1500);

    // 从设置抽屉的「看摘要」进入：不依赖当前时刻是否落在起床窗口内
    await win.webContents.executeJavaScript(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('偏好与数据'));
        b?.click();
        return !!b;
      })()
    `);
    await sleep(400);
    const digestLauncher = await win.webContents.executeJavaScript(`
      (() => {
        const btn = [...document.querySelectorAll('aside button')].find(x => (x.textContent || '').trim() === '看摘要');
        btn?.click();
        return !!btn;
      })()
    `);
    await sleep(500);
    const digestState = await win.webContents.executeJavaScript(`
      (() => {
        const sec = document.querySelector('[aria-labelledby="morning-digest-title"]');
        if (!sec) return { open: false };
        const btns = [...sec.querySelectorAll('button')].map(b => (b.textContent || '').trim());
        const start = [...sec.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '开始依序补看');
        return {
          open: true,
          items: sec.querySelectorAll('article').length,
          hasStart: !!start,
          startIsPrimary: !!start && start.className.includes('bg-accent'),
          hasLater: btns.includes('稍后再看')
        };
      })()
    `);
    ok(
      '★ 早晨摘要主行动是「开始依序补看」（连看不是清单）',
      digestLauncher && digestState.open && digestState.items === 3 &&
        digestState.hasStart && digestState.startIsPrimary && digestState.hasLater,
      JSON.stringify(digestState)
    );

    const digestStarted = await win.webContents.executeJavaScript(`
      (() => {
        const sec = document.querySelector('[aria-labelledby="morning-digest-title"]');
        const btn = [...(sec?.querySelectorAll('button') || [])].find(b => (b.textContent || '').trim() === '开始依序补看');
        btn?.click();
        return !!btn;
      })()
    `);
    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
    );
    await sleep(700);
    const barFirst = await win.webContents.executeJavaScript(`
      (() => {
        const bar = document.querySelector('[aria-label="连续补看"]');
        if (!bar) return { bar: false };
        const text = (bar.innerText || '').split(String.fromCharCode(10)).join(' ');
        return {
          bar: true,
          text,
          digestClosed: !document.querySelector('[aria-labelledby="morning-digest-title"]'),
          first: text.includes('第 1 / 3 场'),
          prevDisabled: [...bar.querySelectorAll('button')].find(b => (b.textContent || '').includes('上一场'))?.disabled ?? null
        };
      })()
    `);
    ok(
      '★ 点「开始依序补看」进入第 1 场并显示「第 1 / 3 场」',
      digestStarted && barFirst.bar && barFirst.digestClosed && barFirst.first && barFirst.prevDisabled === true,
      JSON.stringify(barFirst)
    );

    const stepTo = async label => {
      await win.webContents.executeJavaScript(`
        (() => {
          const bar = document.querySelector('[aria-label="连续补看"]');
          const btns = [...(bar?.querySelectorAll('button') || [])];
          const btn = btns.find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(label)}));
          btn?.click();
          return !!btn;
        })()
      `);
      await sleep(450);
      return win.webContents.executeJavaScript(`
        (() => {
          const bar = document.querySelector('[aria-label="连续补看"]');
          return bar ? (bar.innerText || '').split(String.fromCharCode(10)).join(' ') : '';
        })()
      `);
    };

    const afterNext = await stepTo('下一场');
    const afterPrev = await stepTo('上一场');
    ok(
      '★ 会话条「下一场 / 上一场」按位置步进，不丢上下文',
      afterNext.includes('第 2 / 3 场') && afterPrev.includes('第 1 / 3 场'),
      JSON.stringify({ afterNext, afterPrev })
    );

    const marked = await win.webContents.executeJavaScript(`
      (() => {
        const bar = document.querySelector('[aria-label="连续补看"]');
        const btns = [...(bar?.querySelectorAll('button') || [])];
        const btn = btns.find(b => /标记已看|没有回顾/.test(b.textContent || ''));
        btn?.click();
        return !!btn;
      })()
    `);
    await sleep(800);
    const afterMark = await win.webContents.executeJavaScript(`
      (() => {
        const bar = document.querySelector('[aria-label="连续补看"]');
        const saved = JSON.parse(localStorage.getItem('nightowl:watchLater:v1') || '[]');
        return {
          text: bar ? (bar.innerText || '').split(String.fromCharCode(10)).join(' ') : '',
          firstStatus: saved[0]?.status || '',
          watchedCount: saved.filter(item => item.status === 'watched').length
        };
      })()
    `);
    ok(
      '★ 「标记已看，看下一场」写入队列并前进到第 2 场',
      marked && afterMark.text.includes('第 2 / 3 场') && afterMark.text.includes('已看 1') &&
        afterMark.firstStatus === 'watched' && afterMark.watchedCount === 1,
      JSON.stringify(afterMark)
    );

    await win.webContents.executeJavaScript(`
      (() => {
        const bar = document.querySelector('[aria-label="连续补看"]');
        const btn = [...(bar?.querySelectorAll('button') || [])].find(b => (b.textContent || '').trim() === '结束补看');
        btn?.click();
        return !!btn;
      })()
    `);
    await sleep(450);
    const barGone = await win.webContents.executeJavaScript(
      `!document.querySelector('[aria-label="连续补看"]')`
    );
    ok('★ 「结束补看」收掉会话条，回到常规浏览', barGone);
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
