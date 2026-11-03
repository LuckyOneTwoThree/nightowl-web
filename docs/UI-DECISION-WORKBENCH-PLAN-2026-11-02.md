# 夜猫看台 · 「今晚决策台」双端体验升级计划

- **状态**：P0 全部完成；P1-1 ~ P1-6 全部落地（P1-5 仅桌面端，理由见该段）；P2-1 移动端风险带、P2-2 Token 与排版收敛、P2-3 反馈与失败恢复已落地
- **基线**：`v0.1.44`，HEAD `b02206a`，桌面测试 31 脚本 / 891 断言全绿
- **当前实测**：37 脚本 / 1060 断言全绿；`build` 成功；`check:render` 73 项全过；`measure-layout` 三档无横向溢出；移动端 `npm run check`（`verify:shared` 0 漂移 + `audit:touch` 98 个控件全达标 + `typecheck`）+ `export:android` 通过
- **下一批**：移动端详情三级披露 / 桌面周视图接 `core/week-risk.js` / 真机验收（播放器静音与自动换线、通知权限、托盘与自启、风险带视觉、系统字号 1.3× 与 1.6×、外链失败提示）
- **范围**：桌面端 `src/`、移动端 `mobile/src/`、共享 `src/core/`
- **目标**：把「信息丰富的转播仪表盘」收敛为「在正确时机只回答一个问题的今晚决策台」

> 本文是下一阶段唯一执行计划。此前的 UI 审查和计划稿只作为输入，不再并行维护第二份执行口径。

---

## 一、目标、边界与不做什么

### 1.1 目标

1. **事实可信**：界面显示的睡眠时间、直播状态、补看状态与真实数据一致。
2. **骨架分态**：赛前、直播中、已结束使用不同的信息骨架，而不是同一张卡不断堆模块。
3. **先结论后证据**：先告诉用户「值不值得看」，再按需展开指数、近况、交锋和算法。
4. **上下文守恒**：切换比赛、视图、详情页和补看任务时，滚动位置、筛选条件和返回路径不丢失。
5. **双端同源**：共享算法和语义状态一致；视觉可以因屏幕尺寸不同，但行为规则不能分叉。

### 1.2 本轮不做

- 不泛化 `.broadcast-sheen`，不把高光当成主要升级手段。
- 不为了对标主流体育 App 而增加无数据来源的比分列、xG、控球率、阵型等字段。
- 不改变 `engine.js` 的算法基线和默认权重。
- 不做浅色主题，不整体更换现有夜间色板。
- 不把移动端规划页直接复制成桌面甘特图。
- 不在没有真实设备验证的情况下宣称播放器、通知和手势已经完成。

### 1.3 设计纪律

| 纪律    | 具体要求                                                  |
| :---- | :---------------------------------------------------- |
| 一屏一结论 | 同一屏只允许一个金色主动作、一个主指数展示位                                |
| 状态优先  | `tbd`、待录比分、同步失败、无线路都必须诚实降级，不能用占位值伪装确定信息               |
| 三段披露  | 「结论 → 证据 → 算法」；首屏不展开完整归因                              |
| 语义色固定 | 金色只表达推荐/选中，红色只表达直播/风险，青绿只表达睡眠额度                       |
| 动效克制  | 只服务状态变化、层级切换和操作确认，不做每张卡独立入场                           |
| 共享层只读 | `mobile/src/shared` 由桌面 `src/core`/`src/data` 生成，禁止手改 |

---

## 二、当前基线：已确认的问题与不能重复的旧判断

### 2.1 必须优先修的事实问题

| ID   | 问题                                | 位置                                | 用户影响                  |
| :--- | :-------------------------------- | :-------------------------------- | :-------------------- |
| T-01 | 最低睡眠线把分钟值传给了小时格式化函数               | `src/components/WeekView.jsx`     | 可能显示错误钟点，直接影响睡眠决策     |
| T-02 | 同开球面板维护独立 `queued` 状态             | `src/components/TonightView.jsx`  | 同一场比赛在不同入口显示不同补看状态    |
| T-03 | 「现在睡」只加入补看，不停止应用内播放               | `src/App.jsx` + `PlayerStage.jsx` | 按钮承诺与实际行为不一致          |
| T-04 | 已看/待看/未加入没有统一的三态动作                | `src/core/queue.js` + 多个入口        | 已看条目无法恢复，容易出现假按钮      |
| T-05 | 移动端 `tbd` 未隐藏虚假时间和指数              | `mobile/src/ui/MatchRow.tsx`      | 把占位信息当成确定信息           |
| T-06 | 移动端完赛比分是单字符串，未与主客行对齐              | `mobile/src/ui/MatchRow.tsx`      | 扫读需要左右折返，胜方层级不明确      |
| T-07 | 移动端直播 Hero 无比分层级，整卡点击直接打开观看 Sheet | `mobile/src/app/(tabs)/index.tsx` | 「了解状态」和「选择播放源」被混成一个动作 |
| T-08 | 球队页漏掉 `live` 场次                   | `mobile/src/app/team/[id].tsx`    | 用户最关注球队正在比赛时反而看不到     |
| T-09 | 跳过首次引导仍可能请求通知权限                   | `mobile/src/app/onboarding.tsx`   | 首次信任感受损               |
| T-10 | 移动播放器没有桌面端的首次/夜间静音策略              | `mobile/src/app/player.tsx`       | 深夜点开直播可能突然外放          |

### 2.2 需要保留的正确判断

- 不泛化装饰材质；当前 `.broadcast-sheen` 作为局部转播语言有效。
- 桌面端右栏在播放态是主任务工具，不应无条件移除。
- 移动端规划页需要减负，但不能把「雷区」藏进不可见的 Tab。
- 双端共享算法，不 fork `engine.js`。
- 先修状态真实性，再做视觉和动效。

### 2.3 已知验收脚本与环境事实

桌面端：

```bash
npm run test:all
npm run build
env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu tools/check-render.mjs
env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu tools/measure-layout.mjs
node tools/check-contrast.mjs
```

移动端：

```bash
cd mobile
npm run sync:shared
npm run verify:shared
npm run typecheck
npm run export:android
```

注意：

- 仓库没有 `npm test`，统一使用 `npm run test:all`。
- `check-render` 和 `measure-layout` 是 Electron 脚本，不能用裸 `node` 直接执行。
- **本机 Electron 无法初始化 Chromium sandbox**（`sandbox initialization failed: Operation not permitted`，随后 GPU/network service 崩溃 → `ERR_FAILED` 加载失败）。  
  必须显式带 `--no-sandbox --disable-gpu`，否则 `npm run check:render` 会以「0 项通过 / 1 项失败」假报错。  
  CI 在 Windows runner 上不受影响，`npm run check:render` 仍可原样使用。
- 修改 `src/core` 后必须同步到 `mobile/src/shared` 并运行 `verify:shared`。
- 当前环境无法替代真机验收播放器、通知、音量和安全区。

---

## 三、目标体验骨架

### 3.1 桌面端

```text
左栏：今晚决策列表                右栏：转播舞台 / 比赛上下文
┌──────────────────────┐      ┌──────────────────────────────┐
│ 今晚之选 Hero         │      │ 赛前：开球时刻 + 睡眠代价     │
│ 同开球取舍             │      │ 直播：比分 + 分钟 + 看直播    │
│ 今晚全部场次           │      │ 终场：赛果 + 回顾 / 补看      │
└──────────────────────┘      └──────────────────────────────┘
                                  下方：结论 → 证据 → 算法折叠
```

- 无视频流时，右栏不长期占用 315px；保留可发现的线路状态，但不让空栏挤压主舞台。
- 情报面板首屏只回答三件事：为什么看、代价多大、是否可信。
- 所有入口的「补看」动作共享同一状态源。

### 3.2 移动端

```text
今晚页：Hero（结论 + 状态） → 独立 CTA → 进行中 → 未开赛 → 已结束 → 补看
规划页：一周风险地图 → 单晚过滤 → 精选 / 零成本 / 雷区
详情页：对阵与状态 → 决策摘要 → 情报 / 数据 → 播放
```

- 点击 Hero 主体进入详情；「看直播」是独立动作。
- 比分是直播态第一视觉，但防剧透关闭时仍保持揭晓流程。
- 规划页首屏先给一周风险，再给单场列表。

---

## 四、执行批次

### P0 · 事实与信任修复

#### P0-1 睡眠时间轴纯函数化

- 新增 `formatMinuteOfDay(minutes)` 到 `src/core/format.js`。
- `WeekView` 的最低睡眠线、刻度和说明统一使用该函数。
- 修正说明文案为实际的 `20:00–次日 06:30`。
- 测试覆盖：`00:00`、`01:30`、`23:30`、跨零点、非 30 分钟边界。
- 验收：`07:30 − 6h` 显示 `01:30`，`07:30 − 6.5h` 显示 `01:00`，不是 `12:30`。

#### P0-2 补看队列三态与单一事实源

- 在 `src/core/queue.js` 增加：  
  |  |  |  |  
  | --- | --- | --- |
  - `queueStatusOf(items, id, now)` → `none | pending | watched`
  - `toggleQueue(items, match, now)` → 加入 / 移出 / 已看恢复为待看
- `App.jsx` 提供统一 `toggleWatchLater`，不再让各面板自行缓存 `queued`。
- 动作文案固定为：
  - 未加入：`加入补看`
  - 待看：`已入补看 · 取消`
  - 已看：`已看过 · 重新补看`
- 已加入按钮不得 `disabled`；队列满时给出明确恢复路径。
- 设置抽屉中的移除与已看操作保留，但通过同一队列函数提交。
- 测试：三态转换、重复点击、队列满、已看恢复、7 天过期。

#### P0-3 「现在睡」停止应用内播放

- `PlayerStage` 接受受控停止请求（推荐 `stopRequest` 请求 ID，不使用裸计数器）。
- 「现在睡」流程：加入补看成功 → 提交止损状态 → 触发停止请求 → 关闭止损条。
- 停止只承诺应用内播放器；外部浏览器已打开时不伪装成已停止。
- 验收：播放中点击「现在睡」，声音和画面停止，补看队列增加该场，止损状态落库。

#### P0-4 移动端比赛行

- `match.tbd`：时间显示 `--:-- / 待定`，隐藏睡眠档位和指数。
- live / finished 且有可用比分时，主客比分与两行队名同行右对齐。
- 胜方使用主文本与更高字重，负方降权；比分缺失时显示待录/待更新，不推测。
- 无障碍标签同步包含真实状态，不再朗读虚假指数。
- 验收：赛前、直播中、完赛已揭晓、完赛未揭晓、`tbd` 五种状态。

#### P0-5 移动端直播 Hero 解耦

- 点击卡片主体统一进入比赛详情。
- 独立「看直播」按钮才打开 `WatchSheet`。
- 直播态显示比分（有数据时）和分钟；没有实时比分时显示「比分待更新」。
- 防剧透开启且未揭晓时，不泄露比分。
- 验收：点击卡片与点击 CTA 进入不同路径；播放入口失败有返回动作。

#### P0-6 球队页补回进行中比赛

- 使用 `stateOf(match, now)` 派生 `live / upcoming / finished`。
- 直播场次置顶，显示分钟和可用比分。
- 「下一场」与「后续赛程」去重，计数显示真实总数。
- 验收：球队正在比赛时进入球队页，首屏有直播入口。

#### P0-7 首次引导权限与睡眠价值

- 拆分 `skipOnboarding()` 和 `finish()`；跳过绝不请求通知权限。
- 完成引导后展示一次可跳过的睡眠价值预览：
  - 「按 07:30 起床，这场看完约剩 5.5h」
  - 「启用个人睡眠账本」/「暂不启用」
- 只有用户明确启用后，才开启止损和自动晨间摘要。
- 通知权限只在用户明确打开提醒后请求。
- 验收：跳过路径不出现系统权限弹窗；启用路径能在当晚看到睡眠代价。

#### P0-8 移动播放器静音策略

- 保存用户显式音量/静音偏好。
- 首次播放或凌晨首次打开默认静音；用户已显式选择过时尊重用户选择。
- 起播后提供清晰可见的「开启声音」控件，不使用会挡住画面的长时浮层。
- 自动换线保持当前静音状态。
- 验收：iOS/Android 真机各一次；自动换线不重新外放。

#### P0-9 第一批验收门槛

- `npm run test:all` 全绿。
- `npm run build` 成功。
- `npm run check:render` 覆盖补看加入/移除与核心视图。
- 桌面 1120 / 1366 / 1440 布局无溢出。
- 移动端 `verify:shared`、`typecheck` 通过。
- 六种比赛状态走查：赛前、直播中、完赛未揭晓、完赛已揭晓、`tbd`、同步失败。

---

### P1 · 决策台骨架升级

#### P1-1 双端 `DecisionStrip` ✅ 已完成

目标：把「值不值得、代价多大、几点结束、有没有更轻替代」变成唯一结论条。

- ✅ 新增 `src/core/decision-strip.js`，只返回语义枚举和数值：  
  |  |  |  |  |  
  | --- | --- | --- | --- |
  - `verdict: recommended | neutral | defer | unknown`
  - `costMinutes`
  - `endAt`
  - `alternativeId`
- ✅ 中文文案由视图层生成（`DecisionStrip.jsx` / `DecisionStrip.tsx`），core 不返回展示字符串（有断言守着）
- ✅ 替代场次复用 `sameNightPicks` 候选口径，排除不可选、已看、已开球场次
- ✅ `tbd`、关闭睡眠账本、防剧透三种情况都有明确输出（`unknown` / `sleepKnown=false` / `resultHidden`）
- ✅ 桌面横向四段（`HeroCard` 底部），移动端两行两列；同一屏只出现一次（渲染冒烟断言）
- ✅ 测试：`tools/test-decision-strip.mjs` 47 项（推荐 / 无替代 / 全 tbd / 睡眠关闭 / 替代不合法 / 缺口不足 90 分钟 / 防剧透 / 字段纯度）

#### P1-2 桌面无流侧轨 ✅ 已完成（1120–1279 一项有意不做，见下）

- ✅ `PlayerStage` 在 `!streamUrl` 时提供折叠/展开状态（`railCollapsed`，默认折叠）
- ✅ `>=1280`：折叠为 52px 状态轨，播放时自动展开为 315px（`streamUrl` 变化即展开）
- ⚠️ `1120–1279`：**未改成紧凑横向线路条**。理由：该宽度下侧栏本来就整幅铺在画面下方，
  `check-render` 有一条既有断言守着「单条线路占满行宽」，改成横条会先破坏这条门禁，
  而实测没有可测量的收益。52px 竖轨仍严格只在 ≥1280 生效（与决策 #4 一致）。
- ✅ `<1120`：保持现有纵向布局
- ✅ 52px 轨显示：线路数量 / 接入状态（`aria-label` 完整朗读）、刷新、官方平台入口
- ✅ 展开按钮带 `aria-expanded`；展开后焦点落到 `#match-lines`，收起后归还展开按钮
- ✅ 不在没有视频流时隐藏真实状态（「当前无可用 / 接入中 / 待开播」都读得出来）
- ✅ 附带修的连通问题：`locateSection` 派发 `nightowl:locate` 事件，折叠状态下点「查看线路」
  会先 `flushSync` 展开再高亮，否则高亮会落在即将卸载的节点上
- ✅ 验收：`check-render` 新增 3 条断言（52px + aria-expanded / 展开 315px 且焦点移交 / 收起焦点归还），共 60 项全过
- 📌 **新发现（转 P1-3）**：当晚场次多时（左栏列表 `scrollHeight` 832），左栏列表被挤到 `min-h` 下限 96px。
  A/B 对照确认这是既有行为，与本次改动无关，但 Hero 变高后更容易触底，应在 P1-3 一并处理。

#### P1-3 三态 Hero 骨架 · 部分完成（列表优先已落地）

已完成：

- ✅ **列表优先（本轮最大收益）**：实测左栏 788px 时，同开球面板吃 472px（欧冠整轮 7 场 04:00 同开），
  把 Hero 压到 160px（内容 288 被裁）、列表压到 96px。改法：
  - 同开球默认收成**一行摘要**（`04:00 同开球 · 7 场 · 最高 4.2`），点开才逐条对比（内部滚动 `max-h-260`）；
  - 列表保底从 `min-h-[96px]` 提到 `min-h-[180px]`。
  - 实测三档：1440 → Hero 290 / 同开球 42 / 列表 396；1366 → 290 / 42 / 264；1120 → 290 / 42 / 196。
- ✅ 赛前主动作补「加入补看」（Hero 底部主行动 + 补看双按钮，三态文案与同开球/情报面板统一）
- ✅ 终场主动作修正：非选中的完赛场不再显示「开始观赛」，改为「查看赛后回顾」
- ✅ `check-render` 新增 2 条断言（同开球默认收起 / 展开后可比）→ 62 项全过

未做（有意保留）：

- ✅ **「指数只展示一次」改为弱化落地**：同开球逐条、列表行、备选场次、同夜推荐里的指数是横向比较的
  唯一依据，删掉等于抽走证据，所以只降权不删 —— 新增 `atoms.jsx` 的 `IndexTag`（11px / 常规字重 /
  次级文字色），四处调用点统一；移动端 `MatchRow` 行内指数去掉 accent 与 700 字重，
  `plan` 页入选行的 accent 也降为次级色。强调色从此**只属于** Hero 卡与情报面板头部。
  同时删掉已无人使用的 `INDEX_HIGHLIGHT_THRESHOLD`（留着会误导成「可以再点亮」），
  并新增一条渲染断言：任何 `[title^="夜猫指数"]` 的颜色不得等于 accent。
- ⏸ 三处 Hero 职责边界属梳理项，当前无重复实现导致的缺陷，等 P1-4 动情报面板结构时一并收敛。

#### P1-4 情报面板三级披露 ✅ 已完成（桌面端）

改法与原因：面板此前把 8 个分区一次铺开（睡眠代价 / 看点与故事线 / 数据说明 / 赛季身份 / 指数归因），
每块单独都成立，但同时出现 = 五块等权 = 没有主次。现在：

- ✅ **第一层（不滚动即可读完）**：三格横排 `结论 / 为什么看这场 / 数据可信度`
  - `结论` 复用 `decisionStrip()` 与 `DecisionStrip.jsx` 导出的同一份文案表（`VERDICT_COPY` / `REASON_COPY`）——
    同一语义两处措辞不一致，用户会以为是两个判断；Hero 场次不渲染这一格（左栏决策条已经给过）
  - `为什么看这场` 由 `driversOf(ev)` 出**最多三条语义驱动因素**（德比/焦点战/故事线关键节点/关注球队/关注联赛），
    按贡献降序取前三；**只出标签不出数字** —— 第一层摆三个 `+5.9 / +0.0 / +0.0` 只是逼用户做他做不了的除法
  - `数据可信度` 常驻（旧「数据说明」只在异常时出现）；正常状态只留一行字，待同步 / 上游未提供才给说明与「重查该场」
- ✅ **第二层（唯一主图表）**：指数归因分解条 —— 分子（星级/故事线/主队/联赛）与分母（睡眠代价/观看占用）
  在同一张表里闭合，末行即综合指数
- ✅ **第三层（折叠抽屉）**：`Block` 增加 `fold` 能力（`intel/primitives.jsx`），看点与故事线、赛季身份默认收起，
  收起时留一行摘要（`3 条线索` / `卫冕冠军`）。没有摘要的抽屉等于让用户猜里面有没有东西
- ✅ 首屏从 5 个等权分区收敛为「3 格 + 2 列（代价/归因）+ 2 个抽屉」，面板高度从 ~520px 降到 ~340px
- ✅ 验收：`check-render` 新增 3 条断言（首屏只留结论级信息 / 抽屉默认收起 / 展开后才出现正文）→ 66 项全过
- ⏸ 移动端比赛详情页仍是长滚动单页，未做同样的三级披露（与 P2-1 一并排期）
- ⏸ 「完整历史交锋收进抽屉」**未做**：快照里 91.5% 的场次交锋为 0 场、其余也只有 1 场，
  这块本来就只有一行（或一句「本赛季尚未交锋」），折叠后反而要多一次点击。
  真正的侵占来自「双方数据」整页的 4 张表，但那是用户主动进入的数据探索页，保留全量。

#### P1-5 晨间连续补看 ✅ 已完成（桌面端）

- ✅ 摘要主 CTA 从「稍后再看」改为「开始依序补看」，「稍后再看」降为 ghost 次要动作
  - 理由：摘要的动作是「连看」，不是「清单」。清单要逐条点开、看完、退回来找下一条；
    连看只需要「下一场」。原来的主次刚好反了
- ✅ 会话状态 `digestSession = { ids, cursor }` 抽成纯函数 `core/digest-session.js`
  （`createDigestSession` / `digestPosition` / `stepDigest`）——会话只持 id 快照 + 游标，
  **不记已看状态**，已看仍由补看队列这一个事实源决定
- ✅ 常驻会话条 `DigestSessionBar`（右栏顶部 `sticky`）：`第 N / M 场` + 联赛·时间·对阵 +
  上一场 / 下一场 / 标记已看，看下一场 / 结束补看；会话条存在时让位给它的「正在查看」提示条自动隐藏
- ✅ 从第一条**未看**条目开始（已标记过已看的场次不该让用户再点一次）；向前/向后都会跳过已看项
- ✅ 「没有回顾资源」是**事实到达后**才说的话：`RecapTimeline` / `HighlightsPanel` 各自把真实状态
  经 `hooks/useReviewStatus.js`（CustomEvent 广播）上报，只有 `recap === 'empty' && highlights === 'empty'`
  时，会话条才改口并把主行动换成「没有回顾，看下一场」+ 一行原因说明。
  `loading` / `error` / `idle` 都不下结论 —— 提前猜「没有」会把用户从能看的那场赶走
- ⏸ **不进移动端**：移动端早晨摘要走的是列表 + 详情页，返回即回列表，没有「退回摘要再找下一场」的中间态；
  强行加会话条会多一层需要退出的浮层。移动端留到 P2 与详情页改造一并考虑
- ✅ 验收：`check-render` 新增 5 条断言（主行动是「开始依序补看」/ 进入「第 1 / 3 场」/
  下一场·上一场步进 / 标记已看写入队列并前进 / 结束补看）→ 73 项全过；
  `test:digest` 32 项纯函数断言进 `test:all`

#### P1-6 上下文守恒 ✅ 已完成（虚拟列表一项有意不做，见下）

- ✅ 切换比赛时右栏回到新比赛顶部（`rightPaneRef` + `activeMatchId` effect；实测 1120×700 滚到 318 → 切场 → 0）
- ✅ 每个视图保留自己的选中比赛（`lastInViewRef`）与滚动位置（`hooks/useScrollMemory.js`）
  - 记忆用模块级 `Map` 而不是 `sessionStorage`：这些位置随窗口尺寸与数据刷新失效，跨会话恢复反而把人带到空位置
  - 恢复分两拍：挂载时写一次，下一帧再补一次（队徽/字体未就绪时内容高度未定，`scrollTop` 会被截断）；用户已经自己滚过就不再动他
  - 卸载时用最后一次真实读到的值回写，不用 `el.scrollTop` —— 节点已脱离文档时读出来是 0，会把记住的位置覆盖成顶部
  - 周视图按「页签 + 日期筛选」分桶（`week:${tab}:${day}`）：换页签本来就是换了一份内容
- ⏸ **赛程视图（`ScheduleView`）未接**：它用 virtua 虚拟列表，挂载后按测量结果重算可视区，直接写 `scrollTop` 会被纠正回去；
  而赛程本身是带筛选的检索页，换筛选条件回到顶部是正确行为。真要恢复得走 virtua 的 cache 机制，收益不抵复杂度。
- ⏸ 「每个视图独立筛选条件」**无需实现**：目前只有赛程视图有筛选（`filters` 只喂 `computeScheduleRows`），
  其余两个视图没有可独立的状态；等以后再出现第二个带筛选的视图时再拆桶。
- ✅ 「回到当前视图」返回该视图上一次选中的比赛，失效时回退到该视图第一场
- ✅ 桌面积分榜带 `match` 打开时锚定交手双方（`StandingsModal`）：
  - 两队相隔一屏内 → 整对**居中**；相隔超过一屏（第 3 名 vs 第 20 名）→ 只锚主队，落在可视区上部 28%
    （上面还有表头与分区标签，居中会把「前四参考线 / 附加赛区」推出屏幕）
  - 用 `getBoundingClientRect` 求差而不是 `offsetTop`：行在 `table` 里，`offsetParent` 不一定是滚动容器
  - 切换联赛仍回到榜首；`match` 只取 `h`/`a` 两个 id 进依赖，避免 App 每次重渲染都重锚
- ✅ 移动端比赛详情「情报 / 数据」各自保留滚动位置：两页签共用一个 `Animated.ScrollView`，
  默认会把上一个页签的偏移带过去（在情报页读到 800px 切到数据页，会落在一张没读过的表中间）。
  现在按页签各存一份偏移；`useNativeDriver: true` 时 JS 侧读不到 `Animated.Value` 的值，
  位置靠 `Animated.event` 的 `listener` 另存，恢复放在下一帧（新页签高度要等布局结束才成立）
- ✅ 「同步失败提示持续到恢复」**已满足**：顶栏数据健康指示器由状态驱动（`dataHealth.state`），
  不是一次性 toast，失败会一直亮到下一轮同步恢复正常。P0 阶段已核实，本轮无需改动
- ✅ 验收：`check-render` 新增 2 条断言（切走视图再切回保留左栏滚动位置 / 积分榜带本场打开时锚定交手双方）→ 68 项全过

---

### P2 · 规划页与视觉语法

#### P2-1 移动端一周风险地图 ✅ 已完成

原来那张柱状图只回答「哪晚消耗大」，回答不了「到几点、会不会越线」——而后者才是熬夜的人真正在算的事。
现在换成 7 行共用一条横向坐标的风险带：

- ✅ 新增共享纯函数 `src/core/week-risk.js`（桌面 / 手机共用，桌面暂未接）
  - 一条「夜」= 当日 18:00 → 次日 08:00，坐标是「距 18:00 的分钟数」，与 `owlDay` 同源
  - 横轴**按数据自适应**（左右各留 30 分钟、取整到整点），不用固定的 18:00–08:00：
    固定域在真实数据上会白白空出两小时（04:00 的场次收在 06:00，右边还空到 08:00）
  - 底线 = 起床时间 − 最低睡眠，与 P0 睡眠账本同源；未启用作息时仍给默认值但标 `assumed`，
    界面必须写明「按默认 07:30 / 7h 画的线」，不能让默认值冒充用户作息
  - `tbd` 场次**不归属任何一晚**，只在周级报总数：「几点开球都不知道，按占位时间把它摊到周三，
    等于凭空造出一个时间结论」（比原计划的「tbd 夜晚不做虚假结束时间」更严）
- ✅ 新组件 `mobile/src/ui/WeekRiskBand.tsx`：7 行 × 同一坐标，色块按 `sleepTier` 着色，
  睡眠底线是一条贯穿 7 行的竖线，越线那段用 `warn` 覆盖 + 右侧警号 + 时间转 warn
  - 结论行在带上方：`6 晚越过底线 · 最晚到 06:00（周一）`
  - 每行右侧是「最晚收在几点 + 几场」，空夜显示 `—`（不写「空」，因为可能有待定场次）
  - 今夜（`current`）的周几字变金色，并在上方点一个 3px 圆点
- ✅ 点某一晚 → 原地只看那晚，再点取消；筛选范围是**精选 / 零成本 / 雷区 / 备选**
  （比计划的三个多一个备选——同一屏里只有一个夜晚，备选跳出该夜会自相矛盾）
- ✅ 补一个「该晚其他场次」兜底列表：只看某晚之后，如果那晚的场次恰好都没被算法选中，
  页面上就一个入口都没有了。这份补集只列**上面四个区块没列过**的 id，不重复展示
- ⏸ 删掉旧的三样东西，理由都要记住：
  - 「熬夜分布」柱状图（被风险带取代）
  - 每晚展开的比赛预览（内容已被上面五个区块覆盖，且会与精选重复）
  - 「按 07:30 起床 · 精选有 N 晚低于 7h 底线」摘要行 —— 它和风险带的「越线夜数」是两个口径
    （一个只看精选、一个看全周），同一屏出现两个"低于底线"数字会让人不知道该信哪个
- ✅ 验收：`test:week-risk` 55 项（含真实快照不变量：风险带场次数必须逐日等于 `computeWeek`）→
  `test:all` 36 脚本 / 1044 断言；移动 `typecheck` + `export:android` 通过
- ⚠️ 视觉未走查：本机起不了模拟器，颜色/密度只能真机看（色块重叠、竖线粗细、11px 刻度可读性）

#### P2-2 Token 与排版收敛 · ✅ 已完成（移动端）

色板没有动。这一项只做三件事：把「每次写新组件都要重新猜一次」的档位砍掉、
把「所有想强调的地方都加粗」的字重收敛、把「看起来能点但其实只有 13dp 高」的地方补够。

**圆角三档 + 胶囊**（52 处样式、110 个 token）

- 旧档 `sm/md/lg/xl/xxl/xxxl` 六档在实际使用里已经退化成随机数：同为按钮出现过 12 和 8，
  同为卡片出现过 20 和 16。**档位多不等于精细，只等于每次新写一个组件都要重新猜一次。**
- 新档：`control 8`（按钮 / 输入框 / 分段 / 行内元素）、`card 16`（列表容器 / Hero / 面板）、
  `overlay 20`（Sheet / 弹层）、`pill 999`（只用于状态，不用于容器）。

**字重角色制**（173 处）

- 700 / 800 此前一共出现 105 次，几乎等于「所有想强调的地方都加粗」——结果是没有任何东西真的突出。
- 新档：`body 400` / `label 500`（标签、队名） / `title 600`（标题、比分）；层级改由字号与等宽数字承担，
  不再有更粗的档。现在分布：`title 169` / `label 4` / `body 1`。

**动效与数字**

- `durations` 收敛为 160 / 200 / 220；`Sheet.tsx` 与 `player.tsx` 里硬编码的 180、200 改用 `durations.base`。
- 五处「会跳动的数字」（赛程日期计数、实时时间轴计数、决策条数值、预算统计）补 `tabular-nums`。

**44×44 触控目标 · 新增门禁 `npm run audit:touch`**

- 肉眼过 90 多个 `Pressable` 必然漏，而且改一次样式就可能把某个按钮打回 28dp，所以做成脚本：
  读同文件 `StyleSheet.create`、叠加样式数组、解析 `fontSize.xs` / `spacing.sm + 2` 这类 token 与算式、
  加上 `hitSlop` 三种写法的外扩，最后判 44dp。
- 修掉 15 处：行内文字链（「重试」「去设置」「已看」「移除」「关闭」「清除」）只有 13dp 高，
  外扩补到 16；`revealButton` / `revealPill` / `watchLaterButton` / 风险带行补齐到 45dp 上下；
  止损横幅三个按钮 `minHeight 40 → 44`；决策条「同夜替代」格子靠 `hitSlop` 补到 51dp
  （相邻格子都不接手势，重叠不抢点击）。
- 算不出高度的情况不静默放过：脚本里 9 条豁免，每条写清为什么够 44dp（卡片整块可点、遮罩全屏可点、
  高度写在内容 View 上）。**新出现算不出高度的控件而不进表，一样失败**——否则这个门禁会慢慢变假绿。
- 负向验证过：把「移除」的 `hitSlop` 从 16 改回 4，脚本报 `21.2dp` 并退出 1。

**系统字号 1.3× / 1.6×**

- 正文、队名、比分的容器一律 `height → minHeight`（`Chip`、`SleepBadge`、`SegmentedControl`、
  Tab 徽章、`todayButton`、睡眠步进器、赛程日期卡），字大了盒子跟着长。
- 只有一类文字封顶 `fontScale.micro = 1.3`：**尺寸被数据或几何锁死的微文字**——风险带坐标轴刻度。
  它旁边那些色块不会跟着字变大，字再大只会糊到邻居身上。

**有意不做**

- `dateScroll` 仍固定 `height: 78`：横向滚动容器需要确定高度，改成 `minHeight` 会让它在测量前塌掉；
  日期卡本身已改 `minHeight`，1.6× 时卡片长到 69 仍在容器内。
- Tab 徽章数字不封顶：它已改 `minHeight` + `paddingVertical`，向下长即可，不必牺牲可读性。
- 色板与暗色值不动（这一项本来就不是换皮）。

- ⚠️ 未真机走查：本机起不了模拟器，系统字号 1.3× / 1.6× 的实际溢出、徽章增长后的对齐只能真机看。

#### P2-3 反馈与失败恢复 · ✅ 已完成（双端）

这一项的共同点是：**失败必须留下痕迹，并且当场能补救**。原来三类失败都是静默的 ——
外链打不开（`Linking.openURL(...).catch(() => {})`）、操作失败和操作成功长得一模一样（同一个绿勾）、
外壳桥 `ipcRenderer.send` 发完就没有回执。

**Toast 分级（双端各自一份，形态随平台）**

- 移动 `state/toast.ts` + `ui/Toast.tsx`：`success / info / error` 三档，错误停 6s、成功 3.2s
  （成功扫一眼就够，失败要读完还能点到按钮），最多挂两个恢复动作。挂在根布局上，
  页面不再各写一份。
- 桌面 `lib/toast.js` + `components/ToastHost.jsx`：模块级订阅（不用 Context，因为调用点常在
  事件处理函数甚至非组件模块里）。新增层叠档 `zIndex.toast = 130` —— 高于 modal、低于 splash，
  否则弹窗开着时「已复制」看不见。
- 桌面新增 `test:toast` 16 项：失败必须带恢复动作、旧提示退场不能误伤新提示、
  错误存活时间长于成功。

**外链失败「重试 / 复制链接」**

- 移动 `lib/openExternal.ts`：`Linking.openURL` 失败 → `打不开「X」` + 重试 + 复制链接
  （`expo-clipboard`）。WatchSheet 的两处、我的页官方平台入口全部改走它。
- 桌面 `lib/openExternal.js`：打不开的判定有两条路 —— Electron 桥的返回值和 `window.open` 的 null。
  为此把 `ipcRenderer.send('win:open-external')` 改成 `invoke`，主进程 `shell.openExternal` 抛错时回 `false`
  （老 preload 返回 undefined，按成功处理，不会误报）。PlayerStage 三处、HighlightsPanel 两处、
  UpdateModal 一处全部收口。
- `lib/clipboard.js` 保留 `execCommand` 回退：本地 http / `file://` 下 `navigator.clipboard` 不可用。
  返回布尔值，调用方必须据此说「已复制」或「复制失败」，不做乐观提示。

**WatchSheet**

- 免责声明 3 条并 1 条：直链段、集锦段、页尾原来各写了一遍「不代理 / 不下载」，同一件事说三次
  只会被当成噪音跳过。合并后一条讲清「索引可能失效 + 原生播放器打开 + 不代理不下载不转码 + 官方平台可能需登录」。
- YouTube 集锦显示真实 `eventName` 与平台名（`provider` → 「YouTube」），不再一律写「队名 vs 队名 · 官方集锦」。

**搜索**

- 结果区改「先取全量再截断」：区块头显示真实总数，超出 30 条时给「查看全部 N 场」跳赛程。
  此前直接 `.slice(0, 30)`，用户不知道还有多少。
- 输入框回车 = 带关键词跳赛程看全部（`returnKeyType="search"` 之前没有任何行为）。

**浮层焦点栈**

- 新增 `hooks/useDialogFocus.js`：打开时记住原落点并移进对话框，关闭时归还；
  原元素已移除或已处于 inert 子树内则不归还。
- 六个对话框（设置抽屉、更新弹窗、积分榜、早晨摘要、命令面板、首次引导）统一接入，
  其中摘要原本有一份手写实现，一并收掉。
- **删掉 App 里那套 `rememberFocus` / `restoreFocus`**（连同四个 `*ReturnRef` 与集中归还的 effect）：
  同一件事两处实现，新增弹窗必须两边都登记才有归还。现在只在弹窗自己身上。
- 既有断言 `设置关闭后焦点回到偏好入口` 在删掉 App 那套之后仍然通过 —— 说明归还确实由 hook 完成，
  不是靠旧代码兜着。

---

## 五、文件影响面

```text
src/core/format.js                  P0-1 时间格式化
src/core/queue.js                   P0-2 队列三态
src/core/decision-strip.js          P1-1 新增纯函数
src/core/digest-session.js          P1-5 连续补看纯函数（会话只持 id + 游标）
src/core/week-risk.js               P2-1 一周风险带纯函数（夜坐标 / 睡眠底线 / 越线量）
src/hooks/useScrollMemory.js        P1-6 滚动位置记忆（模块级 Map）
src/hooks/useReviewStatus.js        P1-5 回顾资源真实状态广播
src/App.jsx                         P0-2/P0-3/P1-5/P1-6 状态与流程
src/components/WeekView.jsx         P0-1 时间轴
src/components/TonightView.jsx      P0-2 同开球状态源
src/components/IntelPanel.jsx       P0-2/P1-4 补看动作与披露
src/components/PlayerStage.jsx      P0-3/P1-2 停止与侧轨
src/components/Player.jsx           P0-8 桌面静音策略参考
src/components/StopLossBanner.jsx   P0-3 文案与行为一致
src/components/MorningDigest.jsx    P1-5 摘要主行动
src/components/DigestSessionBar.jsx P1-5 连看位置与跳过
src/components/RecapTimeline.jsx    P1-5 回顾状态上报
src/components/HighlightsPanel.jsx  P1-5 集锦状态上报
mobile/src/ui/MatchRow.tsx          P0-4 移动比赛行
mobile/src/app/(tabs)/index.tsx     P0-5 直播 Hero
mobile/src/app/(tabs)/plan.tsx      P2-1 周风险带与单晚筛选
mobile/src/ui/WeekRiskBand.tsx      P2-1 风险带组件（7 行共用一条时间轴）
mobile/src/app/team/[id].tsx        P0-6 球队直播
mobile/src/app/match/[id].tsx       P0-5/P1-6 详情与滚动
mobile/src/app/onboarding.tsx       P0-7 权限与价值启用
mobile/src/app/player.tsx           P0-8 夜间静音
mobile/src/ui/theme.ts              P2-2 圆角三档 / 字重角色制 / fontScale.micro
mobile/src/ui/motion.ts             P2-2 动效 160 / 200 / 220
mobile/scripts/audit-touch.mjs      P2-2 44dp 触控门禁（npm run audit:touch）
src/lib/toast.js                    P2-3 桌面全局提示（模块级订阅）
src/components/ToastHost.jsx        P2-3 提示渲染与恢复动作
src/lib/openExternal.js             P2-3 外链打开：失败给「重试 / 复制链接」
src/lib/clipboard.js                P2-3 复制（含 execCommand 回退）
src/hooks/useDialogFocus.js         P2-3 弹窗焦点进场与归还（六处共用）
mobile/src/state/toast.ts           P2-3 移动全局提示
mobile/src/ui/Toast.tsx             P2-3 移动提示条
mobile/src/lib/openExternal.ts      P2-3 移动外链打开与复制
electron/{main,preload}.cjs         P2-3 外链桥改为 invoke 并回报结果
```

---

## 六、验证矩阵

| 层级    | 命令/方法                                              | 通过标准                         |
| :---- | :------------------------------------------------- | :--------------------------- |
| 共享算法  | `npm run test:all`                                 | 既有断言不回归，新纯函数测试通过             |
| 桌面构建  | `npm run build`                                    | Vite 构建成功，无新 chunk 异常        |
| 桌面渲染  | `env -u ELECTRON_RUN_AS_NODE npm run check:render` | 首屏、补看、核心视图无异常                |
| 桌面布局  | `npx electron tools/measure-layout.mjs`            | 1120 / 1366 / 1440 无溢出、无滚动陷阱 |
| 对比度   | `node tools/check-contrast.mjs`                    | 现有 token 对比度不降级              |
| 移动共享层 | `cd mobile && npm run verify:shared`               | 0 漂移                         |
| 移动触控  | `cd mobile && npm run audit:touch`                 | 97 个 Pressable 全部 ≥ 44dp     |
| 移动类型  | `cd mobile && npm run typecheck`                   | 0 error                      |
| 移动构建  | `cd mobile && npm run export:android`              | 成功产出                         |
| 真机    | iOS / Android 各一台                                  | 播放/音量/通知/安全区/返回路径/系统字号        |
| 视觉走查  | 桌面 3 档窗口 + 移动 320/375/414                          | 六种比赛状态都可见且无遮挡                |

### 六种状态验收清单

- [ ] 赛前且时间确定
- [ ] 赛前且 `tbd`
- [ ] 直播中且实时比分可用
- [ ] 直播中且实时比分不可用
- [ ] 已结束且比分已揭晓
- [ ] 已结束且比分未揭晓/上游缺失

---

## 七、风险、回滚与依赖


| 风险                 | 影响             | 处理                                         |
| :----------------- | :------------- | :----------------------------------------- |
| 共享层漂移              | 移动端算法与桌面不一致    | core 改动后必须 `sync:shared` + `verify:shared` |
| 52px 侧轨压缩主舞台       | 小窗口可读性下降       | 先做 1280+，1120 保留横向布局                       |
| **三态 Hero 重复指标**   | 同屏出现两个指数/CTA   | 每个 surface 明确唯一主人，回归时用 DOM 选择器断言           |
| DecisionStrip 另写算法 | 与背包/今晚之选口径分叉   | 只复用现有 engine 输出，新增 candidate 测试            |
| 播放停止信号误触发          | 新比赛被意外停止       | 使用请求 ID，不使用裸布尔/计数器                         |
| 迁移队列文案             | 老用户看到「重新补看」不理解 | 保留设置内说明，状态变化即时反馈                           |
| 移动端无真机             | 夜间静音/外链/通知无法验收 | 标记为「待真机」，不宣称已完成                            |
| 视觉 token 变更        | 全站对比度与截图回归     | 色板不动；只做半径、字重、动效收敛                          |

**回滚策略**：

- P0 每项独立提交，可单独 revert。
- `decision-strip.js` 为新增文件，UI 可先不接入；接入后保留旧展示路径一个版本周期。
- 侧轨与 Hero 骨架使用 feature flag（本地 `prefs` 或常量为 `false` 可退回），不直接影响旧布局。
- 队列迁移只新增函数，不删除 `addToQueue/removeFromQueue/markQueueWatched`，保证旧数据可读。

---

## 八、执行顺序与提交拆分

### 第 1 批：P0 事实与信任

1. `fix(format): correct sleep cutoff clock formatting`
2. `feat(queue): add three-state toggle and shared source`
3. `fix(stop-loss): stop in-app playback when sleeping`
4. `fix(mobile): honor tbd and align score hierarchy`
5. `fix(mobile): separate live hero status from watch action`
6. `fix(mobile): show live team match and avoid permission on skip`
7. `feat(mobile): default to muted playback at night`

每项合并前独立运行相关测试；全部通过后跑一次完整门禁。

### 第 2 批：P1 决策台骨架

1. `feat(decision): add semantic decision strip and tests`
2. `feat(player): collapse idle desktop control rail by breakpoint`
3. `refactor(hero): state-specific skeletons with single ownership`
4. `refactor(intel): progressive disclosure of evidence and algorithm`
5. `feat(morning): sequential catch-up flow`
6. `fix(context): preserve scroll, filters and origin match`

### 第 3 批：P2 语言与视觉

1. `feat(mobile): week risk map with sleep-floor marker`
2. `style(tokens): unify radii, weights and motion roles`
3. `fix(feedback): persistent sync errors and recoverable external links`
4. `fix(a11y): focus stack, touch targets and dynamic type coverage`

---

## 九、完成定义

- [ ] 6 种比赛状态都有可验收的真实界面表现。
- [ ] 补看从任何入口加入/移除/恢复，状态一致。
- [ ] 「现在睡」停止应用内播放，并明确外部播放器的边界。
- [ ] `tbd` 不再显示确定时间、档位或指数。
- [ ] 移动端直播 Hero 的「看状态」与「看直播」是两个独立动作。
- [ ] 桌面无流时不长期占用 315px 空侧栏。
- [ ] 首屏只出现一个主指数与一个主动作。
- [ ] 共享层 0 漂移，桌面测试全绿，移动 typecheck 通过。
- [ ] 计划中的所有未验证项明确标注为「待真机」而不是「已完成」。

---

## 十、需要评审确认的产品决策

1. 通用补看文案是否统一为「加入补看」，只在摘要语境里使用「明早补看」。
2. 「现在睡」是否只停止应用内播放，还是还要最小化窗口/退出全屏。
3. 移动端直播 Hero 的主动作优先级：看直播 vs 先看详情。
4. 52px 侧轨是否只在 `>=1280` 启用；1120 是否接受横向线路条而非竖轨。
5. 是否在本轮加入首次睡眠账本启用卡，还是留到 P1 单独做。

以上五项确认后再进入代码执行；未确认时保持现有布局和文案，不擅自扩大范围。
