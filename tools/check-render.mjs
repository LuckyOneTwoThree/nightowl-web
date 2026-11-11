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
import { ts as fixtureTs, nightOf } from '../src/core/engine.js';
import { morningDigestNight } from '../src/core/morning.js';

app.disableHardwareAcceleration();

/**
 * ⚠️ 必须接管「所有窗口关闭」的默认行为。
 *
 * Electron 默认在最后一个窗口销毁时退出进程。主场景在 finally 里 destroy 窗口，
 * 于是后面的人造数据场景（C7）会在第一行 await 之前就被掐掉 —— 表现为
 * 「打印了标题就没了、exit 0」，没有任何报错，最难查的一类。
 * 退出时机由脚本末尾的 app.exit() 显式决定。
 */
app.on('window-all-closed', () => {});

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
const PRELOAD = resolve(ROOT, 'electron/preload.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 选择一个明确仍在未来的场次，避免赛后数据更新后把「指数」断言误判成完赛行。 */
const repoFixtures = JSON.parse(readFileSync(resolve(ROOT, 'src/data/fixtures.json'), 'utf8'));
/** 人造场景按联赛取队（不写死球队 id，赛季换血后不会静默失效） */
const TEAMS = JSON.parse(readFileSync(resolve(ROOT, 'src/data/teams.json'), 'utf8'));
const futureFixture = repoFixtures.find(
  m => m.st === 'sched' && !m.tbd && fixtureTs(m.t) > Date.now() + 2 * 3600000
);
let pass = 0;
let fail = 0;
let skipped = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * 明确跳过，而不是判失败。
 *
 * 有些断言依赖「今晚恰好有比赛 / 恰好有同开球场次」这类数据形态。真实快照
 * 每天在变（11-05 上午刷新后，今晚没有场次），用失败表达「场景不存在」会让
 * 门禁变成看日子过活 —— 而一旦养成「今天红了明天可能绿」的习惯，
 * 真回归就没人看了。跳过必须打印出来并在汇总里计数，不能被当成通过。
 */
/**
 * 明确跳过，而不是判失败。
 *
 * 有些断言依赖「今晚恰好有比赛 / 恰好有同开球场次」这类数据形态。真实快照
 * 每天在变（11-05 上午刷新后，今晚没有场次），用失败表达「场景不存在」会让
 * 门禁变成看日子过活 —— 而一旦养成「今天红了明天可能绿」的习惯，
 * 真回归就没人看了。
 *
 * 但从 C7 起，这类断言不再走这里：主场景改调 deferToScenario()，
 * 由「人造数据场景」真跑一遍。只有极端时序（本夜不足 20 分钟）才会累加 skipped。
 */
let deferred = 0;
/**
 * 主场景数据不满足 → 不跳过，转交「人造数据场景」（本轮 C7 新增）。
 *
 * 与 skip 的区别：skip 是「这条永远跑不到」，deferred 是「换个数据集再跑」。
 * 后者必须真的在后面跑出结果，否则总数会对不上，一眼能看出来。
 */
function deferToScenario(name) {
  deferred++;
  console.log(`  ⏳ ${name} — 主场景无此形态，转由人造数据场景验证`);
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
  // 隐藏窗口在 Windows CI（DPI 缩放）下构造参数可能换算不到正确 CSS 视口，
  // 导致 xl 断点（1280）失效。显式钉死内容区，后续 setContentSize 验证过在隐藏窗口可靠。
  win.setContentSize(1440, 900);

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
    await waitLoad(win, `${base}/?view=tonight`);
    await sleep(1800);

    const initial = await win.webContents.executeJavaScript(`
      (() => ({
        rootChildren: document.getElementById('root')?.children.length || 0,
        text: document.body.innerText.slice(0, 400)
      }))()
    `);
    ok('★ #root 已渲染', initial.rootChildren >= 1, JSON.stringify(initial));
    ok('★ 首屏含「今晚观赛」', initial.text.includes('今晚观赛'));
    const headings = await win.webContents.executeJavaScript(`(() => ({
      h1: document.querySelectorAll('h1').length,
      h2: document.querySelectorAll('h2').length
    }))()`);
    ok('★ 页面有唯一 h1 与主视图 h2', headings.h1 === 1 && headings.h2 >= 1, JSON.stringify(headings));
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
    if (indexTone.count === 0) {
      deferToScenario('★ 列表行指数不用强调色');
    } else {
      ok(
        '★ 列表行指数不用强调色',
        indexTone.bad === 0,
        `弱化 ${indexTone.count} 处，异常 ${indexTone.bad} 处（${indexTone.sample} ≠ ${indexTone.mutedRgb}）`
      );
    }

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
          heroH: Math.round(document.querySelector('[data-hero-card]')?.getBoundingClientRect().height || 0),
          expanded: btn ? btn.getAttribute('aria-expanded') : null
        };
      })()
    `);
    if (!kickoffPanel.exists) {
      deferToScenario('★ 同开球默认收起为一行摘要');
    } else {
      ok(
        '★ 同开球默认收起为一行摘要',
        kickoffPanel.h <= 80 && kickoffPanel.expanded === 'false',
        JSON.stringify(kickoffPanel)
      );
    }

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
        const hero = document.querySelector('[data-hero-card]');
        return {
          h: Math.round(panel.getBoundingClientRect().height),
          heroH: Math.round(hero?.getBoundingClientRect().height || 0),
          heroScroll: hero?.scrollHeight || 0,
          heroClient: hero?.clientHeight || 0,
          panelScroll: panel.scrollHeight,
          panelClient: panel.clientHeight,
          ariaControls: panel.querySelector('button[aria-expanded="true"]')?.getAttribute('aria-controls') || null,
          listId: document.getElementById('same-kickoff-list')?.id || null,
          activeCurrent: panel.querySelector('[aria-current="true"]') !== null,
          expanded: panel.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') ?? null
        };
      })()
    `);
    if (!kickoffOpen || !kickoffAfter) {
      // kickoffAfter 为 null 时（面板不存在）原代码在 detail 参数里直接读
      // kickoffAfter.heroH —— 未捕获的 TypeError 会把整轮渲染冒烟打成「执行失败」，
      // 后面 60 多项一条都跑不到。
      deferToScenario('★ 展开后同开球逐条可比');
      deferToScenario('★ 展开同开球不压缩/截断 Hero');
      deferToScenario('★ 同开球展开列表由左栏整体滚动，面板自身不裁切');
      deferToScenario('★ 同开球展开按钮关联列表且 active 行有 aria-current');
    } else {
      ok(
        '★ 展开后同开球逐条可比',
        kickoffAfter.h > 42 && kickoffAfter.expanded === 'true',
        JSON.stringify(kickoffAfter)
      );
      ok(
        '★ 展开同开球不压缩/截断 Hero',
        Math.abs((kickoffAfter.heroH || 0) - (kickoffPanel.heroH || 0)) <= 2 &&
          kickoffAfter.heroScroll <= kickoffAfter.heroClient + 1,
        JSON.stringify({ before: kickoffPanel.heroH, after: kickoffAfter.heroH, scroll: kickoffAfter.heroScroll, client: kickoffAfter.heroClient })
      );
      ok(
        '★ 同开球展开列表由左栏整体滚动，面板自身不裁切',
        kickoffAfter.panelScroll <= kickoffAfter.panelClient + 1,
        JSON.stringify({ scroll: kickoffAfter.panelScroll, client: kickoffAfter.panelClient })
      );
      ok(
        '★ 同开球展开按钮关联列表且 active 行有 aria-current',
        kickoffAfter.ariaControls === 'same-kickoff-list' &&
          kickoffAfter.listId === 'same-kickoff-list' &&
          kickoffAfter.activeCurrent,
        JSON.stringify({ controls: kickoffAfter.ariaControls, id: kickoffAfter.listId, current: kickoffAfter.activeCurrent })
      );
    }

    // 收回来，避免影响后续左栏高度相关的断言
    await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('[aria-label="同开球对比"] button[aria-expanded="true"]');
        if (btn) btn.click();
        return true;
      })()
    `);
    await sleep(160);

    /* 侧轨折叠（P1-2）：无视频流时收成 52px 状态轨，展开回到 315px，焦点双向归还。
       断言前置条件：宽屏断点（≥1280）生效且线路区存在（未终场）。
       隐藏窗口视口不足 1280 时 xl-only 功能无法生效，如实跳过而不是假红。 */
    const railState = await win.webContents.executeJavaScript(`
      (() => {
        const wide = window.matchMedia('(min-width: 1280px)').matches;
        const head = document.getElementById('match-lines');
        const rail = head?.parentElement;
        const expand = rail?.querySelector('button[aria-label="展开线路与官方平台"]');
        return {
          innerWidth: window.innerWidth,
          wide,
          hasRail: !!rail,
          width: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
          hasExpand: !!expand,
          expandedAttr: expand ? expand.getAttribute('aria-expanded') : null
        };
      })()
    `);
    ok(
      '★ 无视频流时侧轨收成 52px 且标注 aria-expanded=false',
      !railState.hasRail || !railState.wide ||
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
        const cls = rail?.className || '';
        return {
          // 隐藏窗口 CSS 过渡可能停滞，getBoundingClientRect 读不到终值；
          // class 是结构性真相，过渡只是动画。
          expandedClass: cls.includes('w-[315px]'),
          collapsedClass: cls.includes('w-[52px]'),
          focused: document.activeElement === head,
          hasCollapse: !!document.querySelector('button[aria-label="收起线路侧栏"]')
        };
      })()
    `);
    ok(
      '★ 展开侧轨恢复 315px 并把焦点交给线路区',
      !railExpandClicked ||
        (railExpanded.expandedClass && !railExpanded.collapsedClass && railExpanded.focused && railExpanded.hasCollapse),
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
        const cls = rail?.className || '';
        const btn = document.querySelector('button[aria-label="展开线路与官方平台"]');
        return {
          collapsedClass: cls.includes('w-[52px]'),
          expandedClass: cls.includes('w-[315px]'),
          focusBack: !!btn && document.activeElement === btn
        };
      })()
    `);
    ok(
      '★ 收起后焦点归还展开按钮',
      !railCollapseClicked || (railBack.collapsedClass && !railBack.expandedClass && railBack.focusBack),
      JSON.stringify(railBack)
    );

    /* 「情报」是页内定位，不是弹窗。1440 下目标本来就完整可见，
       scrollIntoView 不会产生位移 —— 必须靠高亮 + 焦点给出反馈。 */
    const heroAction = await win.webContents.executeJavaScript(`
      (() => {
        // 必须限定到 HeroCard 本身。用 'main > section' 会先匹配到决策条，
        // 而决策条里也有「查看赛前情报」——它只负责选中比赛、不做页内定位，
        // 于是断言测的其实是一个不相干的按钮（实测 scrollIntoView 调用 0 次）。
        const hero = document.querySelector('[data-hero-card]');
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
          elExists: !!el,
          hasFlash: el?.classList.contains('locate-focus-flash') || false,
          focused: document.activeElement === el
        };
      })()
    `);
    if (!heroAction.clicked || !heroActionFeedback.elExists) {
      // 区块没渲染（例如该场次没有情报区）不是交互失效 —— 但也不能静静通过。
      deferToScenario('★ 已选中 Hero 的主按钮可直达当前状态对应区块');
    } else {
      ok('★ 已选中 Hero 的主按钮可直达当前状态对应区块',
        heroActionFeedback.hasFlash && heroActionFeedback.focused,
        JSON.stringify({ action: heroAction, feedback: heroActionFeedback }));
    }
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

    // 线路检测期间主按钮文案是「检测中…」且 disabled（MatchCanvas），检测走外网抓取，
    // 保底签名过期时重试可达数秒 —— 固定 sleep 赌它完成会随网络时延假红。
    // 轮询到按钮就绪再点：本断言只关心「点击后的高亮与焦点」，不关心抓取时延。
    let linesReady = false;
    for (let i = 0; i < 60; i++) {
      linesReady = await win.webContents.executeJavaScript(`
        [...document.querySelectorAll('button')].some(
          b => (b.textContent || '').trim() === '查看线路' && !b.disabled
        )
      `);
      if (linesReady) break;
      await sleep(500);
    }
    const linesClicked = linesReady
      ? await win.webContents.executeJavaScript(`
          (() => {
            const btn = [...document.querySelectorAll('button')].find(
              b => (b.textContent || '').trim() === '查看线路'
            );
            if (!btn) return false;
            btn.click();
            return true;
          })()
        `)
      : false;
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
      JSON.stringify({ linesReady, linesClicked, ...linesFeedback }));

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
          // 空赛周：周视图走的是「本周暂无未开赛场次」分支，时间轴本就不该渲染。
          emptyWeek: text.includes('本周暂无未开赛场次') || text.includes('历史周不显示熬夜风险'),
          hasTitle: text.includes('7 晚时间轴'),
          hasFloor: text.includes('底线'),
          hasWake: text.includes('起床'),
          hasVerdict: /越过底线|未越线|全周未越线/.test(text)
        };
      })()
    `);
    if (weekTimeline.emptyWeek) {
      // 真实快照可能整周无赛（如 2026-11-09）。这不是回归，转交人造场景验证时间轴。
      deferToScenario('★ 周时间轴渲染 7 行（周一~周日）');
      deferToScenario('★ 周时间轴标题 / 底线 / 起床结论常驻');
      deferToScenario('★ 点单晚出现筛选横幅与「清除 M/D」按钮');
    } else {
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
    }

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
        // 隐藏窗口里程序化 scrollTop 可能不派发 scroll 事件，补一个合成事件
        // 确保 useScrollMemory 的监听器把位置记进内存。
        list.dispatchEvent(new Event('scroll'));
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
    if (!scrollSet.ok) {
      // 列表不存在或内容不足一屏（今晚场次少时 max < 120）→ 没有可复位的滚动位置。
      // 这不是「切视图丢了滚动」，但也不该静静通过。
      deferToScenario('★ 切走视图再切回保留左栏滚动位置');
    } else {
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
      scrollRestored != null && Math.abs(scrollRestored - scrollSet.top) <= 2,
      JSON.stringify({ set: scrollSet, restored: scrollRestored })
    );
    }

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

    /* 连续补看（P1-5）：摘要只认「真实开球日 === 昨晚」的队列项 —— queueWithMatches 会用
       owlDay(match.t) 覆盖播种的 night（改期重算，产品正确）。主场景快照的完赛场是赛季初
       日期，永远不等于「昨晚」，这 5 项随日期必然假红；转交人造数据场景（注入昨晚完赛场）真跑。 */
    deferToScenario('★ 早晨摘要主行动是「开始依序补看」（连看不是清单）');
    deferToScenario('★ 点「开始依序补看」进入第 1 场并显示「第 1 / 3 场」');
    deferToScenario('★ 会话条「下一场 / 上一场」按位置步进，不丢上下文');
    deferToScenario('★ 「标记已看，看下一场」写入队列并前进到第 2 场');
    deferToScenario('★ 「结束补看」收掉会话条，回到常规浏览');

    // 剧场断言需要一个带播放器的选中场；摘要流程移走后显式选一场完赛场。
    const theaterFixture = repoFixtures.find(m => m.st === 'done');
    if (theaterFixture) {
      await waitLoad(win, `${base}/?view=tonight&match=${theaterFixture.id}`);
      await sleep(1200);
    }

    // 剧场切换不能重建播放器。
    //
    // 旧实现的三种布局根节点在 div / Fragment 之间切换、VideoScreen 的树层级也不同，
    // React 会整棵卸载重建 —— 画面黑屏重连，还会重复触发一次 video:playing
    // （同一场起播被记成两次成功，污染线路成功率）。同一问题在比赛第 120 分钟
    // 由 live 转 ended_pending 时也会出现（加时赛必现）。
    //
    // 断言方式：给视频容器打一个自定义属性，切剧场后检查它还在。
    // 只要子树被重建，新节点就不带这个属性 —— 这是结构性判断，不依赖动画/像素。
    {
      const before = await win.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('.player-adaptive-video');
          if (!v) return { found: false };
          v.__noProbe = 'kept';
          return { found: true, hasBtn: !!document.querySelector('[aria-label="切换为宽屏剧场"]') };
        })()
      `);
      if (!before.found || !before.hasBtn) {
        ok('★ 切宽屏剧场复用同一个视频容器（不卸载重建）', false,
          `未进入比赛详情：${JSON.stringify(before)}`);
      } else {
        await win.webContents.executeJavaScript(
          `document.querySelector('[aria-label="切换为宽屏剧场"]')?.click()`
        );
        await sleep(450);
        const after = await win.webContents.executeJavaScript(`
          (() => {
            const v = document.querySelector('.player-adaptive-video');
            return {
              kept: v?.__noProbe === 'kept',
              inTheater: !!document.querySelector('[aria-label="切换为协同模式"]')
            };
          })()
        `);
        ok('★ 切宽屏剧场复用同一个视频容器（不卸载重建）',
          after.kept && after.inTheater, JSON.stringify(after));
        // 切回协同模式，避免影响后续断言
        await win.webContents.executeJavaScript(
          `document.querySelector('[aria-label="切换为协同模式"]')?.click()`
        );
        await sleep(300);
      }
    }
  } catch (err) {
    ok('渲染冒烟执行完成', false, String(err?.stack || err));
  } finally {
    try {
      win.destroy();
    } catch {}
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  }

  /* ==================================================================
   * 人造数据场景（C7）
   *
   * 主场景的门禁依赖「今晚恰好有球 / 恰好有同开场次」。实测赛季 52.6% 的日子无赛，
   * 于是 8 项断言长期处于「跳过」——跳过不是通过，它们实际上是没在跑。
   * 这里用一份**只依赖当前时刻**的人造赛程（全在今晚、含 3 场同开球、含德比）
   * 把同样的检查真跑一遍。
   *
   * 关键设计：时间相对 now 生成，写完仍然是「今晚」——不能用固定日期，
   * 否则过几天就变成历史数据，「今晚」直接空掉。
   * ================================================================ */
  console.log('');
  console.log('人造数据场景（补齐主场景因数据形态转交的断言）');

  // ⚠️ 必须是 `YYYY-MM-DDTHH:MM`（带 T）：引擎的 ts()/owlDay() 按 'T' 切分，
  // 换成空格会静默退化成「全天 00:00」，本夜直接查不到场次 —— 表现为「人造数据注入了但界面还是空的」。
  const bjWall = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
  const plusDay = ds => {
    const d = new Date(Date.parse(ds + 'T00:00:00Z') + 86400000);
    return d.toISOString().slice(0, 10);
  };

  /** 只依赖 now 的人造赛程：14 场全在今晚，其中 3 场同开、含德比与六强内战 */
  function buildSyntheticFixtures(now) {
    const night = nightOf(now);
    const nightEnd = Date.parse(`${plusDay(night)}T05:55:00+08:00`);
    // 主展示组放在 now+60min；若已接近本夜尾声则前挪，保证仍有未来场次
    let t0 = Math.min(now + 60 * 60000, nightEnd - 90 * 60000);
    if (t0 < now + 10 * 60000) t0 = now + 10 * 60000;

    const byLeague = lid => TEAMS.filter(t => t.league === lid).map(t => t.id);
    const pl = byLeague('PL');
    const pick = (arr, a, b) => (arr.includes(a) && arr.includes(b) ? [a, b] : null);

    // 同开球组：德比 + 六强内战 + 默西塞德，保证 Hero 与面板同时成立
    const groupA = [pick(pl, 'ARS', 'TOT'), pick(pl, 'MCI', 'MUN'), pick(pl, 'LIV', 'EVE')]
      .filter(Boolean);
    const used = new Set(groupA.flat());
    const rest = pl.filter(id => !used.has(id));
    const groupB = [];
    for (let i = 0; i + 1 < rest.length && groupB.length < 4; i += 2) groupB.push([rest[i], rest[i + 1]]);

    const pd = byLeague('PD');
    const sa = byLeague('SA');
    const groupC = [];
    for (let i = 0; i + 1 < pd.length && groupC.length < 3; i += 2) groupC.push([pd[i], pd[i + 1]]);
    for (let i = 0; i + 1 < sa.length && groupC.length < 5; i += 2) groupC.push([sa[i], sa[i + 1]]);

    const out = [];
    let r = 12;
    const push = (pair, atMs, league) => {
      const [h, a] = pair;
      out.push({
        id: `TEST-${r}-${h}-${a}`,
        l: league,
        r,
        t: bjWall(atMs),
        tbd: false,
        st: 'sched',
        h,
        a
      });
      r++;
    };
    // 夜尾运行时（例如 05:30）没有 4 小时可用，必须压缩间隔，否则后几场会落到**下一夜**，
    // 今晚切片直接少一半，滚动断言会假红。
    const room = nightEnd - t0;
    const step = room > 4 * 3600000 ? 30 * 60000 : 3 * 60000;
    const at = off => Math.min(t0 + off, nightEnd - 2 * 60000);
    groupA.forEach(p => push(p, at(0), 'PL'));                    // 同开球组
    groupB.forEach((p, i) => push(p, at((i + 1) * step), 'PL'));
    groupC.forEach((p, i) => push(p, at((i + 1) * step * 1.5), i < 3 ? 'PD' : 'SA'));
    return out;
  }

  let synthetic = buildSyntheticFixtures(Date.now());
  {
    // 极端时序（05:40 之后）：本夜只剩几分钟，来不及造「未来场次」。
    // 这种情况如实计为跳过，不假装通过 —— 全天占比 <2%。
    const nightEndMs = Date.parse(`${plusDay(nightOf(Date.now()))}T05:55:00+08:00`);
    if (nightEndMs - Date.now() < 20 * 60000) {
      console.log(`  ⏭ 本夜仅剩 ${Math.max(0, Math.round((nightEndMs - Date.now()) / 60000))} 分钟，来不及造未来场次 → ${deferred} 项跳过`);
      skipped += deferred;
      deferred = 0;
    }
  }
  if (deferred > 0) {
    const srv = createServer(loadRules(), silent, {
      backgroundSync: false,
      loadFixtures: async () => synthetic,
      saveFixtures: () => ({ ok: true, path: '/tmp/nightowl-synthetic.json', bytes: 1 }),
      syncScores: async () => ({
        patches: new Map(), errors: [], stats: {}, bySource: {},
        conflicts: [], incompleteScore: [], unmatched: []
      })
    });
    const port2 = await new Promise((res, rej) => {
      srv.listen(0, '127.0.0.1', () => res(srv.address().port));
      srv.on('error', rej);
    });
    const base2 = `http://127.0.0.1:${port2}`;
    const win2 = new BrowserWindow({
      width: 1440, height: 900, show: false, paintWhenInitiallyHidden: true,
      backgroundColor: '#0b0e15',
      webPreferences: {
        preload: PRELOAD, contextIsolation: true, nodeIntegration: false,
        sandbox: true, backgroundThrottling: false
      }
    });
    win2.setContentSize(1440, 900);
    const errs2 = [];
    win2.webContents.on('console-message', (_e, level, message) => {
      if (level >= 3) errs2.push(message);
    });

    try {
      await waitLoad(win2, `${base2}/?view=tonight`);
      await win2.webContents.executeJavaScript(`
        localStorage.setItem('onboardingDone','1');
        localStorage.setItem('nightowl:splash_shown','1');
        localStorage.setItem('followedTeams','[]');
        localStorage.setItem('spoilerFree','false');
        true
      `);
      await waitLoad(win2, `${base2}/?view=tonight`);
      await sleep(1600);
      /* ① 列表行指数不用强调色 */
      const tone = await win2.webContents.executeJavaScript(`
        (() => {
          const nodes = [...document.querySelectorAll('[title^="夜猫指数"]')];
          const probe = document.createElement('span');
          probe.className = 'text-text-muted';
          document.body.appendChild(probe);
          const mutedRgb = getComputedStyle(probe).color;
          probe.remove();
          const bad = nodes.filter(n => getComputedStyle(n).color !== mutedRgb);
          return { count: nodes.length, bad: bad.length, mutedRgb };
        })()
      `);
      ok('★ 列表行指数不用强调色（人造场景）',
        tone.count > 0 && tone.bad === 0,
        `弱化 ${tone.count} 处，异常 ${tone.bad} 处`);

      /* ② 同开球面板：默认收起 */
      const collapsed = await win2.webContents.executeJavaScript(`
        (() => {
          const panel = document.querySelector('[aria-label="同开球对比"]');
          if (!panel) return { exists: false };
          const btn = panel.querySelector('button[aria-expanded]');
          return {
            exists: true,
            rows: panel.querySelectorAll('[aria-current], li, div[id="same-kickoff-list"] > div').length,
            h: Math.round(panel.getBoundingClientRect().height),
            heroH: Math.round(document.querySelector('[data-hero-card]')?.getBoundingClientRect().height || 0),
            expanded: btn ? btn.getAttribute('aria-expanded') : null,
            summary: (panel.innerText || '').trim().slice(0, 40)
          };
        })()
      `);
      ok('★ 同开球默认收起为一行摘要（人造场景）',
        collapsed.exists && collapsed.h <= 80 && collapsed.expanded === 'false',
        JSON.stringify(collapsed));

      /* ③ 展开：逐条可比 / 面板不裁切 / aria 关联 */
      const opened = await win2.webContents.executeJavaScript(`
        (() => {
          const btn = document.querySelector('[aria-label="同开球对比"] button[aria-expanded="false"]');
          if (!btn) return false;
          btn.click();
          return true;
        })()
      `);
      await sleep(320);
      const expanded = await win2.webContents.executeJavaScript(`
        (() => {
          const panel = document.querySelector('[aria-label="同开球对比"]');
          if (!panel) return null;
          const hero = document.querySelector('[data-hero-card]');
          const btn = panel.querySelector('button[aria-expanded="true"]');
          return {
            h: Math.round(panel.getBoundingClientRect().height),
            heroH: Math.round(hero?.getBoundingClientRect().height || 0),
            heroScroll: hero?.scrollHeight || 0,
            heroClient: hero?.clientHeight || 0,
            panelScroll: panel.scrollHeight,
            panelClient: panel.clientHeight,
            ariaControls: btn?.getAttribute('aria-controls') || null,
            listId: document.getElementById('same-kickoff-list')?.id || null,
            activeCurrent: panel.querySelector('[aria-current="true"]') !== null,
            rows: panel.querySelectorAll('button[aria-pressed], [data-same-kickoff-row]').length
          };
        })()
      `);
      ok('★ 展开后同开球逐条可比（人造场景）',
        !!opened && !!expanded && expanded.h > 42,
        JSON.stringify({ opened, h: expanded?.h }));
      // 展开后左栏出现滚动条 + pr-1，内容宽度少约 16px，文本重排会让 Hero 略**变高**。
      // 这是重排不是压缩：真正的缺陷是「被压扁」与「内容被截断」，
      // 所以下界卡死 -2px，截断交给 scrollHeight<=clientHeight+1 兜住。
      ok('★ 展开同开球不压缩/截断 Hero（人造场景）',
        !!expanded &&
          (expanded.heroH || 0) >= (collapsed.heroH || 0) - 2 &&
          expanded.heroScroll <= expanded.heroClient + 1,
        JSON.stringify({ before: collapsed.heroH, after: expanded?.heroH, scroll: expanded?.heroScroll, client: expanded?.heroClient }));
      ok('★ 同开球展开列表由左栏整体滚动，面板自身不裁切（人造场景）',
        !!expanded && expanded.panelScroll <= expanded.panelClient + 1,
        JSON.stringify({ scroll: expanded?.panelScroll, client: expanded?.panelClient }));
      ok('★ 同开球展开按钮关联列表且 active 行有 aria-current（人造场景）',
        !!expanded &&
          expanded.ariaControls === expanded.listId &&
          expanded.listId === 'same-kickoff-list' &&
          expanded.activeCurrent,
        JSON.stringify({ controls: expanded?.ariaControls, listId: expanded?.listId, active: expanded?.activeCurrent }));

      /* ④ Hero 主按钮直达对应区块 */
      const heroBtn = await win2.webContents.executeJavaScript(`
        (() => {
          const hero = document.querySelector('[data-hero-card]');
          const btn = [...(hero?.querySelectorAll('button') || [])].find(b =>
            ['查看赛前情报', '查看直播线路', '查看赛后回顾', '进入直播间'].includes((b.textContent || '').trim())
          );
          if (!btn) return { clicked: false };
          const text = (btn.textContent || '').trim();
          const target = text.includes('情报') ? 'intel-panel'
            : text.includes('线路') ? 'match-lines' : 'match-recap';
          btn.click();
          return { clicked: true, target, text };
        })()
      `);
      await sleep(220);
      const targetId = JSON.stringify(heroBtn.target || '');
      const heroFx = await win2.webContents.executeJavaScript(`
        (() => {
          const el = document.getElementById(${targetId});
          return {
            exists: !!el,
            hasFlash: el?.classList.contains('locate-focus-flash') || false,
            focused: document.activeElement === el
          };
        })()
      `);
      ok('★ 已选中 Hero 的主按钮可直达当前状态对应区块（人造场景）',
        !!heroBtn.clicked && heroFx.exists && heroFx.hasFlash && heroFx.focused,
        JSON.stringify({ action: heroBtn, feedback: heroFx }));

      /* ⑤ 切走视图再切回：左栏滚动位置保留
         ⚠️ 先收起面板：展开态下滚动交给左栏整体（by design），内层列表本身不再可滚，
         直接在这里找可滚列表必然落空。 */
      await win2.webContents.executeJavaScript(
        `document.querySelector('[aria-label="同开球对比"] button[aria-expanded="true"]')?.click()`
      );
      await sleep(400);
      const scrollSet = await win2.webContents.executeJavaScript(`
        (() => {
          const list = [...document.querySelectorAll('div')].find(
            d => typeof d.className === 'string' && d.className.includes('overflow-y-auto')
              && d.className.includes('space-y-0.5')
          );
          if (!list) return { ok: false };
          const max = list.scrollHeight - list.clientHeight;
          if (max < 120) return { ok: false, max };
          list.scrollTop = Math.min(160, max);
          list.dispatchEvent(new Event('scroll'));
          return { ok: true, top: Math.round(list.scrollTop), max };
        })()
      `);
      await sleep(260);
      const switchView2 = async label => {
        await win2.webContents.executeJavaScript(`
          (() => {
            const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes(${JSON.stringify(label)}));
            b?.click();
            return !!b;
          })()
        `);
        await sleep(900);
      };
      await switchView2('本周规划');
      /* 周时间轴在人造赛程下必须真实渲染：主场景遇空赛周会转交到这里。 */
      const weekTimeline2 = await win2.webContents.executeJavaScript(`
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
      ok('★ 周时间轴渲染 7 行（周一~周日）（人造场景）',
        weekTimeline2.rowCount === 7, JSON.stringify(weekTimeline2));
      ok('★ 周时间轴标题 / 底线 / 起床结论常驻（人造场景）',
        weekTimeline2.hasTitle && weekTimeline2.hasFloor && weekTimeline2.hasWake && weekTimeline2.hasVerdict,
        JSON.stringify(weekTimeline2));

      const dayRowClicked2 = await win2.webContents.executeJavaScript(`
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
      const dayFilterOn2 = await win2.webContents.executeJavaScript(`
        (() => {
          const text = document.body.innerText;
          const clearBtn = [...document.querySelectorAll('button')].find(b =>
            /^清除 \\d{1,2}\\/\\d{1,2}/.test((b.textContent || '').trim())
          );
          return { banner: text.includes('正在筛选'), hasClear: !!clearBtn };
        })()
      `);
      ok('★ 点单晚出现筛选横幅与「清除 M/D」按钮（人造场景）',
        dayRowClicked2 && dayFilterOn2.banner && dayFilterOn2.hasClear, JSON.stringify(dayFilterOn2));

      await win2.webContents.executeJavaScript(`
        (() => {
          const btn = [...document.querySelectorAll('button')].find(b =>
            /^清除 \\d{1,2}\\/\\d{1,2}/.test((b.textContent || '').trim())
          );
          if (btn) btn.click();
          return !!btn;
        })()
      `);
      await sleep(300);
      const dayFilterOff2 = await win2.webContents.executeJavaScript(
        `!document.body.innerText.includes('正在筛选')`
      );
      ok('★ 清除后筛选横幅消失（人造场景）', dayFilterOff2);

      await switchView2('今晚观赛');
      const restored = await win2.webContents.executeJavaScript(`
        (() => {
          const list = [...document.querySelectorAll('div')].find(
            d => typeof d.className === 'string' && d.className.includes('overflow-y-auto')
              && d.className.includes('space-y-0.5')
          );
          return list ? Math.round(list.scrollTop) : null;
        })()
      `);
      ok('★ 切走视图再切回保留左栏滚动位置（人造场景）',
        scrollSet.ok && restored != null && Math.abs(restored - scrollSet.top) <= 2,
        JSON.stringify({ set: scrollSet, restored }));

      /* ⑥ 连续补看（P1-5，主场景转交）：摘要只认「真实开球日 === 昨晚」的队列项。
         追加 3 场昨晚完赛场（owlDay(t) === morningDigestNight(now)），重载后播种队列真跑。
         放在现有断言之后追加，避免完赛场扰动前面「今晚 / 同开球 / 周时间轴」的计数。 */
      {
        const digestNight = morningDigestNight(Date.now());
        const plIds = TEAMS.filter(t => t.league === 'PL').map(t => t.id);
        const donePairs = [[plIds[0], plIds[1]], [plIds[2], plIds[3]], [plIds[4], plIds[5]]];
        const doneFixtures = donePairs.map(([h, a], i) => ({
          id: `TEST-DONE-${i + 1}-${h}-${a}`,
          l: 'PL', r: 1,
          t: `${digestNight}T23:${String(i * 15).padStart(2, '0')}`,
          tbd: false, st: 'done', h, a, sc: '2-1'
        }));
        synthetic = [...synthetic, ...doneFixtures];
        const digestQueue = doneFixtures.map((m, i) => ({
          id: m.id,
          night: digestNight,
          addedAt: Date.now() - (doneFixtures.length - i) * 60000,
          status: 'pending'
        }));
        await win2.webContents.executeJavaScript(`
          (() => {
            localStorage.setItem('nightowl:watchLater:v1', ${JSON.stringify(JSON.stringify(digestQueue))});
            return true;
          })()
        `);
        await waitLoad(win2, `${base2}/?view=tonight`);
        await sleep(1500);
        await win2.webContents.executeJavaScript(`
          (() => {
            const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('偏好与数据'));
            b?.click();
            return !!b;
          })()
        `);
        await sleep(400);
        const digestLauncher2 = await win2.webContents.executeJavaScript(`
          (() => {
            const btn = [...document.querySelectorAll('aside button')].find(x => (x.textContent || '').trim() === '看摘要');
            btn?.click();
            return !!btn;
          })()
        `);
        await sleep(500);
        const digestState2 = await win2.webContents.executeJavaScript(`
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
        ok('★ 早晨摘要主行动是「开始依序补看」（连看不是清单）（人造场景）',
          digestLauncher2 && digestState2.open && digestState2.items === 3 &&
            digestState2.hasStart && digestState2.startIsPrimary && digestState2.hasLater,
          JSON.stringify(digestState2));

        const digestStarted2 = await win2.webContents.executeJavaScript(`
          (() => {
            const sec = document.querySelector('[aria-labelledby="morning-digest-title"]');
            const btn = [...(sec?.querySelectorAll('button') || [])].find(b => (b.textContent || '').trim() === '开始依序补看');
            btn?.click();
            return !!btn;
          })()
        `);
        await win2.webContents.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
        );
        await sleep(700);
        const barFirst2 = await win2.webContents.executeJavaScript(`
          (() => {
            const bar = document.querySelector('[aria-label="连续补看"]');
            if (!bar) return { bar: false };
            const text = (bar.innerText || '').split(String.fromCharCode(10)).join(' ');
            return {
              bar: true,
              digestClosed: !document.querySelector('[aria-labelledby="morning-digest-title"]'),
              first: text.includes('第 1 / 3 场'),
              prevDisabled: [...bar.querySelectorAll('button')].find(b => (b.textContent || '').includes('上一场'))?.disabled ?? null
            };
          })()
        `);
        ok('★ 点「开始依序补看」进入第 1 场并显示「第 1 / 3 场」（人造场景）',
          digestStarted2 && barFirst2.bar && barFirst2.digestClosed && barFirst2.first && barFirst2.prevDisabled === true,
          JSON.stringify(barFirst2));

        const stepTo2 = async label => {
          await win2.webContents.executeJavaScript(`
            (() => {
              const bar = document.querySelector('[aria-label="连续补看"]');
              const btn = [...(bar?.querySelectorAll('button') || [])].find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(label)}));
              btn?.click();
              return !!btn;
            })()
          `);
          await sleep(450);
          return win2.webContents.executeJavaScript(`
            (() => {
              const bar = document.querySelector('[aria-label="连续补看"]');
              return bar ? (bar.innerText || '').split(String.fromCharCode(10)).join(' ') : '';
            })()
          `);
        };
        const afterNext2 = await stepTo2('下一场');
        const afterPrev2 = await stepTo2('上一场');
        ok('★ 会话条「下一场 / 上一场」按位置步进，不丢上下文（人造场景）',
          afterNext2.includes('第 2 / 3 场') && afterPrev2.includes('第 1 / 3 场'),
          JSON.stringify({ afterNext2, afterPrev2 }));

        const marked2 = await win2.webContents.executeJavaScript(`
          (() => {
            const bar = document.querySelector('[aria-label="连续补看"]');
            const btn = [...(bar?.querySelectorAll('button') || [])].find(b => /标记已看|没有回顾/.test(b.textContent || ''));
            btn?.click();
            return !!btn;
          })()
        `);
        await sleep(800);
        const afterMark2 = await win2.webContents.executeJavaScript(`
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
        ok('★ 「标记已看，看下一场」写入队列并前进到第 2 场（人造场景）',
          marked2 && afterMark2.text.includes('第 2 / 3 场') && afterMark2.text.includes('已看 1') &&
            afterMark2.firstStatus === 'watched' && afterMark2.watchedCount === 1,
          JSON.stringify(afterMark2));

        await win2.webContents.executeJavaScript(`
          (() => {
            const bar = document.querySelector('[aria-label="连续补看"]');
            const btn = [...(bar?.querySelectorAll('button') || [])].find(b => (b.textContent || '').trim() === '结束补看');
            btn?.click();
            return !!btn;
          })()
        `);
        await sleep(450);
        const barGone2 = await win2.webContents.executeJavaScript(
          `!document.querySelector('[aria-label="连续补看"]')`
        );
        ok('★ 「结束补看」收掉会话条，回到常规浏览（人造场景）', barGone2);
      }

      ok('人造场景无运行时报错', errs2.length === 0, errs2.slice(0, 2).join(' | '));
    } catch (err) {
      ok('人造数据场景执行完成', false, String(err?.stack || err));
    } finally {
      try {
        win2.destroy();
      } catch {}
      srv.closeAllConnections?.();
      await new Promise(r => srv.close(r));
    }
  }

  console.log('');

  console.log(
    `通过 ${pass} 项，失败 ${fail} 项` +
      (skipped ? `，跳过 ${skipped} 项（数据形态不满足）` : '') +
      (deferred ? `（其中 ${deferred} 项由人造数据场景承接）` : '')
  );
  app.exit(fail ? 1 : 0);
}).catch(err => {
  console.error('FATAL', err?.stack || err);
  app.exit(1);
});
