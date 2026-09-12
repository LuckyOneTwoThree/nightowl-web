# 夜猫看台 · Stitch 提示词工程指南与页面 Prompt 全集（重构终版）

> ⚠️ **本文件已降级为历史参考（2026-09-12）**
>
> **不要直接使用下方的 Prompt 原样重新生成页面。** 原因：
>
> 1. **Prompt 中包含无数据源的编造字段**（`xG`、控球率、`68% 成功率`、`4-3-3 阵型`、`6.2 Mbps`、`节律扰动` 等），
>    与 UI 规范 §五「真实数据可达性铁律」冲突。实测这些字段在数据层**全部不存在**。
> 2. **Prompt 中的布局与信息架构已被修订**：三视图 Tab 由左栏上移至顶栏；不引入左侧竖排 rail；
>    左栏宽度统一为 `max-w-[520px]`。
> 3. `teams.tag` 被当作"战术风格标签"使用，**语义错误**（实为赛季身份，且仅 17/111 队有）。
>
> **当前有效规则以以下三份为准**：
> - 《UI设计规范与视觉设计系统》（视觉 token 与可达性铁律）
> - 《页面状态机与交互细节指南》（交互与分档状态）
> - 《数据可达性对账表》+《决策排定与开工执行清单》（字段去留的最终判据）
>
> 若需重新生成页面，请基于上述文档重写 Prompt，而非复用本文件。

---

> **文档说明（原文，保留供追溯）**：本文件为 **Stitch** 专门打磨的高保真 UI 生成提示词（Prompts）。

> **核心原则**：
> 1. **彻底废除无意义的“原子组件展台”**，聚焦于 4 个真实产品页面；
> 2. **左栏解耦为三大核心心智**：【🌙 今晚 Tonight】·【📊 本周 Week】·【📅 赛程 Schedule】；
> 3. **数据 100% 真实可达**：严格基于项目真实存在的 `storylines`、`rivalries`、`sleepTier` 与 `teams.tag`，严禁编造交锋与球员对抗数据；
> 4. **桌面级体验**：macOS 交通灯安全区、100vh 零外层滚动、右栏横向三列防溢出。

---

## 目录
1. [Prompt 1：【🌙 今晚观赛工作台】(Tonight View · 默认首屏正在直播)](#一prompt-1今晚观赛工作台tonight-view--默认首屏)
2. [Prompt 2：【📊 本周规划工作台】(Week Budget Planner · 0-1背包DP算法)](#二prompt-2本周规划工作台week-budget-planner)
3. [Prompt 3：【📅 全量赛程日历台】(Schedule Calendar · 1897场长表检索)](#三prompt-3全量赛程日历台schedule-calendar)
4. [Prompt 4：【⚙️ 个人偏好与数据抽屉】(Settings & Preferences Drawer)](#四prompt-4个人偏好与数据抽屉settings-drawer)

---

## 一、Prompt 1：【🌙 今晚观赛工作台】(Tonight View · 默认首屏)

> **心智定义**：深夜 02:45，球迷坐在电脑前。左栏仅聚焦当晚的 3~6 场比赛（今晚焦点阿森纳vs曼城进行中），右栏为 1080p 极清播放大屏、多线路切换与基于真实资产的战术情报板。

### Stitch 输入 Prompt (直接复制以下代码块)

```markdown
Design a modern, high-density, cyberpunk-inspired dark sports desktop workstation called "Owl Terrace (夜猫看台) - Tonight Match Station" for hardcore European football fans.
Screen resolution: 1440x900 desktop viewport, strictly fixed 100vh height (`h-screen w-screen overflow-hidden flex flex-col bg-[#0A0D14]`). Absolutely NO outer body scroll.

### 1. Color Palette & Typography
- Background: Pure deep midnight obsidian (#0A0D14).
- Cards & Containers: Dark slate surface (#131722) with subtle fine borders (#232A3B).
- Primary Accent: Amber Gold (#FFB800) for hero highlights, star ratings, high ROI badges.
- Live Status Accent: Glowing Neon Coral Red (#E24B4A) with subtle pulsing live beacon dot.
- Secondary Accents: Cyan/Teal (#44E2CD) for low sleep cost, Mystic Purple (#CEB5FF) for derby/storylines.
- Typography:
  - Font Families: 'Hanken Grotesk' for titles, 'Be Vietnam Pro' for body, 'JetBrains Mono' for all numbers (times, scores, ROI).
  - Icons: Google Material Symbols Outlined.
- Club Badges: Use circular color badges with bold 3-letter abbreviations (e.g. Red circle with 'ARS', Sky-blue with 'MCI', Blue with 'INT', Red/Black with 'MIL'). DO NOT use external img links that might break.

### 2. Layout Hierarchy: Top Bar + 38% / 62% Dual Columns
- Top Bar (Height: 52px, border-b border-[#232A3B], pl-20 pr-6 flex justify-between items-center bg-[#0D111A] select-none, noting pl-20 reserves safe space for macOS traffic light window buttons):
  - Left: Owl logo icon in amber gold, text "夜猫看台 · 纯净观赛工作台", version badge "v4.0 Desktop".
  - Center: Live Beijing wall-clock in JetBrains Mono "02:45:18 CST", pill badge "● 3 场比赛正在进行中".
  - Right: Followed Club dropdown pill [❤️ 阿森纳 Arsenal ▾], Settings button [⚙ 偏好与数据].

- Main Workspace (flex, flex-1, overflow-hidden):
  - LEFT COLUMN (Width: 38%, min-w-[420px], max-w-[520px], border-r border-[#232A3B], p-4 flex flex-col gap-3 h-full overflow-hidden bg-[#0E121B]):
    1. View Switcher Tabs (h-9 bg-[#131722] p-1 rounded-lg flex text-xs font-medium border border-[#232A3B]):
       - Tab 1 (Active): [🌙 今晚观赛 (Tonight)] with solid amber gold pill (`bg-[#FFB800] text-black font-semibold`).
       - Tab 2: [📊 本周规划 (Week)] text-slate-400 hover:text-slate-200.
       - Tab 3: [📅 赛程日历 (Schedule)] text-slate-400 hover:text-slate-200.
    2. Hero Focus Match Card ("今晚之选" - Arsenal vs Man City):
       - Gradient background (#1E1B18 to #131722), amber border glow (border-[#FFB800]/40), rounded-xl p-3.5 flex flex-col gap-2.
       - Header row: Badge [今晚唯一焦点 HERO], [夜猫指数 ROI 28.5 ★★★], Live badge [🔴 LIVE 65'].
       - Versus Row: Red circular badge (32px) 'ARS', "阿森纳", live score "2 - 1" in large bold 24px JetBrains Mono with live red glow, "曼城", sky-blue circular badge (32px) 'MCI'.
       - Tactical Narrative: "英超争冠天王山对决！胜者直接登顶积分榜首位".
       - Bottom Row: Sleep Tier badge [S3 重度 · 3.5h 损耗], Action button: Solid Amber Gold "🔴 立即观赛" with soundwave icon.
    3. Tonight Matches Slice Header:
       - Row: "今晚全部场次 (北京时间 09-11 凌晨 · 4 场)" + text "夜猫口径归属昨夜".
    4. Tonight Compact Match List (flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar):
       - Match 1 (Active Playing): 03:00 阿森纳 vs 曼城 [🔴 LIVE 65' (2-1)] [S3 重度] (Left gold border 3px, bg-[#1A2133]).
       - Match 2 (Live Derby): 02:45 国际米兰 vs AC米兰 [🔴 LIVE 72' (1-1)] [S3 重度] [米兰德比 ★★★].
       - Match 3 (Minefield Warning): 03:00 卡利亚里 vs 莱切 [0-0] [⚠ 雷区 · 建议睡觉] (Muted dashed border, dark slate).
       - Match 4 (Finished): 20:30 切尔西 vs 富勒姆 [完赛 2-0] [S0 零成本] (Muted 60% opacity).

  - RIGHT COLUMN (Width: 62%, flex-1, bg-[#080B10], p-4 flex flex-col gap-3 h-full overflow-hidden):
    1. High-Definition Stream Player (16:9 aspect ratio, max-h-[480px] rounded-xl overflow-hidden bg-black shadow-2xl relative group border border-[#232A3B]):
       - Simulated live match broadcast: Crisp pitch view with broadcast scoreboard overlay at top-left ("ARS 2 - 1 MCI · 65:14").
       - Top Overlay Pill: "英超 第5轮 · 阿森纳 vs 曼彻斯特城" + Pill badge "咪咕原画 1080p 50fps · 6.2 Mbps".
       - Bottom Player Controls Bar: Play/Pause, Live sync red dot, Time "65:14", Volume slider, Quality [原画 1080p], PIP icon, Cinema mode, Fullscreen button.
       - Keyboard shortcuts hint at top-right: "[F] 全屏  [P] 画中画  [M] 静音  [1-4] 切源".
    2. Stream Switcher Bar (h-10 px-1 flex items-center justify-between text-xs):
       - Left pill group (flex gap-1.5):
         - Option 1 (Active): Solid Gold [● 线路1: 咪咕原画 (极清 50fps)]
         - Option 2: Slate Pill [线路2: 官方超清]
         - Option 3: Slate Pill [线路3: 英文原声 (SkySports)]
         - Option 4: Slate Pill [🛡️ 线路4: 备用沙箱内嵌]
       - Right button: [↗ 直达官方原站] with external link icon.
    3. Real-Data Tactical Intelligence Panel (flex-1 min-h-[190px] grid grid-cols-3 gap-3 overflow-hidden):
       - Column Card A: "🌙 睡眠成本评级": S3 重度身体损耗 · 02:30–04:00 死线档 · 建议次日中午补觉 · 咖啡因安全窗口已关闭.
       - Column Card B: "⚔️ 焦点德比与故事线": 【争冠冲刺篇】双方位列榜一榜二 · 官方故事线核心碰撞节点.
       - Column Card C: "⚽ 战术风格标签": 阿森纳【传控压迫 · 青年近卫军】 vs 曼城【传控统治 · 进攻狂潮】.

Ensure zero outer scrollbar, razor-sharp padding, clean contrast, and a professional dark broadcast command center feel.
```

---

## 二、Prompt 2：【📊 本周规划工作台】(Week Budget Planner)

> **心智定义**：球迷想算清身体账：“我这周只有 4 小时熬夜额度，算法帮我算算该熬哪几场？”
> 界面切换至【本周】，左栏展示完整的 0-1 背包 DP 规划器、最优解卡片与雷区预警；右栏展示选中比赛的赛前情报与线路预约。

### Stitch 输入 Prompt

```markdown
Design the "Weekly Sleep Budget Planner (本周熬夜规划工作台)" view for the "Owl Terrace (夜猫看台)" dark desktop app.
Screen resolution: 1440x900 desktop viewport, fixed height (h-screen w-screen overflow-hidden flex flex-col bg-[#0A0D14]).

### 1. Visual Theme & Layout
- Midnight obsidian theme (#0A0D14 base, #131722 cards, #FFB800 gold accents, #44E2CD teal for safe budget).
- Top Bar: macOS safe area pl-20, clock "02:45 CST", followed club.

- Main Container (flex, flex-1, overflow-hidden):
  - LEFT COLUMN (Width: 38%, min-w-[420px], max-w-[520px], border-r border-[#232A3B], p-4 flex flex-col gap-3 h-full overflow-hidden bg-[#0E121B]):
    1. View Switcher Tabs:
       - Tab 1: [🌙 今晚观赛 (Tonight)]
       - Tab 2 (Active): [📊 本周规划 (Week)] with solid amber gold pill (`bg-[#FFB800] text-black font-semibold`).
       - Tab 3: [📅 赛程日历 (Schedule)]
    2. DP Knapsack Interactive Budget Controller (Card with glowing teal border):
       - Header: "0-1 背包算法 · 本周熬夜预算规划", subtitle: "量化身体损耗，计算全周最高性价比组合".
       - Interactive Budget Slider:
         - Large digital readout in JetBrains Mono: "4.0 小时 / 周" (Current selection).
         - Slider track [=======o====] from 0.0h to 8.0h with markers: S1(1h), S2(2.5h), S3(3.5h), S4(4.5h).
       - Algorithm Solved Status: "DP 背包已求出最优解 · 覆盖率 87.5% · 建议熬夜 3.5h · 结余 0.5h".
    3. DP Recommended Optimal Matches List:
       - Header: "算法精选组合 (已自动入选 3 场)"
       - Pick 1: 周五 03:00 阿森纳 vs 曼城 [S3 成本 3.5h] [ROI 28.5 ★★★] [主队保底入选]
       - Pick 2: 周六 20:30 切尔西 vs 富勒姆 [S0 成本 0.0h] [ROI 16.0 ★★] [零成本赠送]
       - Pick 3: 周日 21:30 拜仁 vs 勒沃库森 [S0 成本 0.0h] [ROI 22.0 ★★★] [德甲榜首对决]
    4. Minefield Warnings (本周避坑雷区):
       - Warning Card (bg-red-950/20 border border-red-500/30 p-2.5 rounded-lg text-xs):
         - "⚠ 雷区预警：周日 03:00 卡利亚里 vs 莱切 (S3 重度 · ★1星级 · 无故事线) -> 算法强烈建议睡觉！"

  - RIGHT COLUMN (Width: 62%, flex-1, bg-[#080B10], p-4 flex flex-col gap-3 h-full overflow-hidden):
    1. Focal Match Pre-kickoff Tactical Hub (16:9 ratio, dark tactical pitch layout):
       - Center: Large tactical pitch diagram with subtle floodlight glow.
       - Match countdown: "距开球 00:14:32" in glowing JetBrains Mono.
       - Starting Formation: Arsenal (4-3-3) vs Man City (4-1-4-1) tactical boards.
       - Stream Probe status: "📡 3 条高速线路已锁定 (咪咕原画 / 官方高清 / 英文原声)".
    2. Weekly Schedule Timeline Matrix (h-48 bg-[#131722] rounded-xl p-3 border border-[#232A3B] flex flex-col justify-between text-xs):
       - "本周熬夜日历透视 (周一至周日)":
       - 7-day visual bars showing sleep cost distribution (Friday spike S3, Saturday safe S0, Sunday safe S0).
       - Advice banner: "周五熬夜后，周六无深夜场次，拥有 36 小时充裕补觉窗口 🟢".

Style must feel intellectual, quantitative, empowering fans to take control of their circadian rhythm.
```

---

## 三、Prompt 3：【📅 全量赛程日历台】(Schedule Calendar)

> **心智定义**：球迷想查五大联赛赛程：“下周有什么比赛？皇马哪天踢马竞？昨晚比分是多少？”
> 切换至【赛程】，左栏 100% 纵向空间释放给虚拟长列表，具备联赛多选、主队过滤、防剧透比分模糊；右栏呈现选中比赛的对阵巡礼与战报。

### Stitch 输入 Prompt

```markdown
Design the "Full Schedule & Calendar Explorer (全量赛程日历台)" view for the "Owl Terrace (夜猫看台)" desktop app.
Screen resolution: 1440x900 desktop viewport, fixed height (h-screen w-screen overflow-hidden flex flex-col bg-[#0A0D14]).

### 1. Visual Theme & Layout
- Deep midnight theme (#0A0D14 base, #131722 surface cards, #FFB800 gold highlights).
- Top Bar: macOS safe area pl-20, clock "02:45 CST", followed club.

- Main Container (flex, flex-1, overflow-hidden):
  - LEFT COLUMN (Width: 38%, min-w-[420px], max-w-[520px], border-r border-[#232A3B], p-4 flex flex-col gap-2.5 h-full overflow-hidden bg-[#0E121B]):
    1. View Switcher Tabs:
       - Tab 1: [🌙 今晚观赛 (Tonight)]
       - Tab 2: [📊 本周规划 (Week)]
       - Tab 3 (Active): [📅 赛程日历 (Schedule)] with solid amber gold pill (`bg-[#FFB800] text-black font-semibold`).
    2. Multi-dimensional Filter Bar (Clean & Compact):
       - Search input box: "🔍 搜索 111 支球队 / 焦点战...".
       - League pill tabs: [全部 1,897 (Active gold)], [★3 焦点战], [英超 PL], [欧冠 UCL], [西甲 PD], [德甲 BL], [意甲 SA], [法甲 FL].
       - Toggle bar: [❤️ 只看关注球队] toggle, [👁️ 防剧透模式 (隐藏已赛比分)] toggle (Active teal).
    3. Full Schedule Virtual List (flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar):
       - Date Header: "2026-09-12 周六 (第4轮 · 8场比赛)"
       - Match Card 1 (Finished - Spoiler Mode): 20:30 切尔西 vs 富勒姆 [S0 零成本] -> Score box displays "[ 👁️ 点击揭晓比分 ]" with frosted blur effect.
       - Match Card 2 (Upcoming): 22:00 利物浦 vs 伯恩茅斯 [S0 零成本] [★2 评分] [安菲尔德主场].
       - Match Card 3 (Derby Selected): 00:30 拜仁慕尼黑 vs 多特蒙德 [S1 轻度] [★★★ 德国国家德比] (Gold border).
       - Match Card 4 (TBD Pending): 02:00 皇家马德里 vs 比利亚雷亚尔 [时间待定 tbd] [电视台未定档] (Muted dashed pill).
       - Match Card 5 (Finished): 03:00 巴黎圣日耳曼 vs 摩纳哥 [完赛 3-1] (Revealed score).

  - RIGHT COLUMN (Width: 62%, flex-1, bg-[#080B10], p-4 flex flex-col gap-3 h-full overflow-hidden):
    1. Match Showcase Panel (16:9 aspect ratio, dark stadium banner):
       - Selected: "德国国家德比 · 拜仁慕尼黑 vs 多特蒙德 (德甲 第5轮)".
       - Center: Giant team logos with glowing stadium background, kickoff "2026-09-13 00:30 北京时间".
       - Action buttons: [⭐ 设为本周焦点关注], [📅 导出 ICS 日历到手机/电脑], [📡 预约直播线路通知].
    2. Derby & Tactical Background Card (bg-[#131722] rounded-xl p-4 border border-[#232A3B] flex-1 flex flex-col gap-2 text-xs):
       - Header: "⚔️ 德比档案：德国国家德比 (Der Klassiker)".
       - Storyline summary: "德甲最具统治力的宿敌对决！多特蒙德客场挑战安联球场，凯恩领衔拜仁锋线 vs 多特青春风暴".
       - Sleep Tier Breakdown: "S1 轻度档 (00:30 开球) · 睡眠成本 1.0h · 完赛约 02:20 · 建议赛前小憩 30 分钟".

Style: Ultra-organized, high-density data explorer, buttery smooth layout.
```

---

## 四、Prompt 4：【⚙️ 个人偏好与数据抽屉】(Settings Drawer)

> **心智定义**：用户点击顶栏【⚙ 偏好设置】，右侧滑出半透明毛玻璃抽屉面板。管理关注球队、关注联赛（影响 +8 分加成）、默认周预算、防剧透开关与 ESPN 数据同步状态。

### Stitch 输入 Prompt

```markdown
Design a slide-out settings and preferences drawer for the "Owl Terrace (夜猫看台)" desktop app.
Desktop 1440x900 viewport, background darkened with midnight glassmorphism backdrop (backdrop-blur-md bg-black/60).
The drawer slides in from the right edge (width: 480px, bg-[#131722], border-l border-[#232A3B], h-full p-6 flex flex-col justify-between shadow-2xl).

### Drawer Contents:
1. Drawer Header:
   - Title: "个人偏好与算法配置", subtitle: "定制你的熬夜决策大脑与观赛工作台", close 'close' icon button.

2. Settings Section 1: "关注球队 (Favorite Clubs)"
   - Search input box with magnifying glass icon: "搜索 111 支五大联赛与欧冠球队...".
   - Selected clubs tag pills: [🔴 阿森纳 (主队) ✕], [⚪ 皇家马德里 ✕].
   - Quick club grid: 8 circular club badges (曼城, 拜仁, 巴萨, 国米, 利物浦, 巴黎, 多特, 米兰) with '+' toggle buttons.

3. Settings Section 2: "关注联赛 (League Bias & Bonus)"
   - Explanatory note: "核心铁律：仅在关注联赛 < 6 个时触发 +8 分偏好加成；全选 6 个时加成为 0".
   - 6 toggle chips with league badges:
     - [✔ 英超 PL (已选)] [✔ 欧冠 UCL (已选)] [✔ 西甲 PD (已选)]
     - [✔ 德甲 BL (已选)] [✔ 意甲 SA (已选)] [法甲 FL (未选)]
   - Live bonus preview indicator: "当前状态: 已选 5 个联赛 · 关注场次获得 +8 分加成生效中 🟢".

4. Settings Section 3: "睡眠成本与防剧透规则"
   - Default weekly budget slider: "4.0 小时 / 周".
   - Toggle switch: "已赛场次默认隐藏比分 (防剧透模式)" -> [ON (高亮开启)].
   - Toggle switch: "赛前 15 分钟系统桌面通知" -> [ON].

5. Settings Section 4: "数据保鲜与本地服务状态"
   - Status card (bg-[#0A0D14] p-3 rounded-lg border border-[#232A3B] text-xs):
     - "ESPN 赛程保鲜: 10 分钟前同步 (1,897 场已校验，比分已补录 159 场)".
     - "本地流代理: 127.0.0.1:3000 (运行正常 · 内存 32MB 零泄漏)".
     - [🔄 立即同步最新比分] outline button.

6. Drawer Footer:
   - [恢复默认设置] text button, and solid amber gold [保存偏好配置] button.

Style: Refined dark obsidian theme, tactile toggles, clear typography hierarchy, and smooth spacing.
```
