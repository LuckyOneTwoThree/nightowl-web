# 深度复核（2026-11-03）

> 只读研究，不改代码。每条结论都附了复现方式；未验证的单独标注。
> 基线：`npm run test:all` 1060 项通过、`npm run build` 通过、`mobile` 的 `verify:shared / typecheck / audit:touch` 通过。

---

## 一、项目全景

**一句话**：本地单机 + 双端的「这场值不值得熬夜」决策工具。桌面 Electron 承载直播/情报，Android 承载随身决策；算法、数据、文案口径都在 `src/core`，手机端由 `sync-shared` 生成副本。

| 层 | 桌面 | 手机 | 共享方式 |
| :-- | :-- | :-- | :-- |
| 决策算法 | `src/core/engine.js`(683) + `owl.js`(415) | `mobile/src/shared/core/*` | 生成 + `verify:shared` 哈希校验 |
| 语义层 | `decision-strip / week-risk / data-health / queue / sleep / stop-loss / morning / digest-session` | 同上 | 同上 |
| 数据 | `src/data/fixtures.json`(220 KB, 1897 场) | 同上 | 同上 |
| 比分保鲜 | `server/scores.js` + `server/sources/*`（ESPN 主 + openfootball 副） | `mobile/src/data/sync/*`（**手抄分支**） | 不在校验范围 |
| 直播 | 本地 127.0.0.1:3100 代理 + M3U8 重写 + 会话白名单 | 原生播放器直连，无代理 | 设计如此 |

**核心口径（读代码确认，不是文档转述）**

- 时间一律北京墙钟串 `YYYY-MM-DDTHH:mm`；`ts()` 做纯 UTC 减 8h；`owlDay()` 把 00:00–06:00 归前一夜。
- 夜猫指数 = 星级 ×10 + 关注/剧情/联赛加成 ÷ (1 + 睡眠代价 + 0.5×观赛代价)；S0–S4 档位代价 0/1/2.5/3.5/4.5h。
- 周规划 = 0-1 背包（预算 + 最多 5 场 + 同时段互斥），`tbd` 永不入算法、永不进周网格。
- 防剧透 = `revealed` 集合；`done` 且未揭晓时比分隐藏。
- 双端同源只覆盖 `src/core`、`src/data`、6 个 server JSON、`tz.mjs`；**手机端的比分/直播/集锦/抓取分支不在校验里**。

**验证阶梯**（仓库既有）：`test:all`（离线 35 套）→ `build` → `check:render`（无头 Electron）→ 真实 Windows CI → 用户机器 → Android 真机。

---

## 二、已验证的缺陷

### P0-1 `groupTonight` 把已结束场次归入「未开赛」——双端同时中招

**位置**：[src/core/owl.js:398](src/core/owl.js:398)

```js
const s = E.matchState(m, nowTs);
if (s === 'live') live.push(m);
else if (s === 'ended_pending' || s === 'done') finished.push(m); // ← 'done' 永不成立
else upcoming.push(m);
```

`matchState()` 对 `st === 'done'` 返回的是 `'finished'`（[src/core/engine.js:103](src/core/engine.js:103)），不是 `'done'`。于是所有已录入完赛的场次都落进 `upcoming`，「已结束」折叠区永远是空的。

**影响面**：桌面 `TonightView`（[src/components/TonightView.jsx:194](src/components/TonightView.jsx:194)）与手机首页（[mobile/src/app/(tabs)/index.tsx:103](mobile/src/app/(tabs)/index.tsx:103)）都调这个函数。用户在同一屏看到：

- 「未开赛 19」里 16 条是 22:00/23:00 已经踢完的比赛；
- 「已结束」计数 0，折叠区不出现；
- `renderRow` 传给 `MatchRow` 的 `state` 仍是 `stateOf()` 的真值，所以行内会显示终场比分/「待录比分」，**分区标题与行内容自相矛盾**。

**复现**

```bash
node -e "import('./src/core/owl.js').then(async o=>{
  const d=await import('./src/data/index.js'),E=await import('./src/core/engine.js');
  const now=E.ts('2026-08-16T23:00');
  const t=o.computeTonight(now,{followedTeams:[],followedLeagues:['PD'],weeklyBudget:4});
  const g=o.groupTonight(t.slice,now);
  console.log('upcoming',g.upcoming.length,'done-in-upcoming',
    g.upcoming.filter(m=>m.st==='done').length,'finished',g.finished.length);
})"
# → upcoming 2 done-in-upcoming 2 finished 0
#   PD-1-RAC-VIL 2026-08-16T23:00 done
#   PD-1-ESP-LEV 2026-08-17T01:00 done
```

真实数据扫描：**最早 40 个夜晚（8 月开季段，每晚都有已录入完赛的场次）× 4 个时刻 = 160 个样本，160/160 都出现 done 混入 upcoming**。纯未来夜晚不会触发（那里没有 `done`），所以只有「当天已踢完几场、用户又回头看一眼」的场景才暴露——这也解释了它为什么能活到现在。更贴近日常的触发方式：把 11-07 22:00/23:00 的 16 场按保鲜后的真实状态置为 `done`，01:00 打开今晚视图 → `upcoming=19`、其中 16 场已完赛、`finished=0`。

**为什么 1060 项测试没拦住**

[tools/test-owl.mjs:93](tools/test-owl.mjs:93) 写的是：

```js
ok('★ finished 组只含已结束（done / ended_pending）',
   g.finished.every(m => ['done', 'ended_pending'].includes(stateOf(m, NOW))));
```

这条断言**只有 bug 存在时才可能通过**——修正后 `finished` 里装的是 `'finished'`/`'ended_pending'`，它反而会红。而 `upcoming` 那条用的是测试自带的、按时间推算的 `isEnded`：`NOW` 固定在 09-13 12:00，当晚 14 场都在 20:00 之后开球，`isEnded` 全为 false，于是**空断言也通过**。

→ 修 P0-1 必须同时改这条断言的期望值（`finished` 应接受 `'finished'`/`'ended_pending'`；`upcoming` 应断言不含 `st === 'done'` 与 `'finished'`）。

---

### P0-2 `tbd` 占位时间会被算成「进行中」——顶栏红点和「进行中」分区会凭空出现

**位置**：[src/core/owl.js:316](src/core/owl.js:316) `liveCountAt`、`groupTonight` 的 `live` 分支、`stateOf`。

`tbd` 场次的 `t` 是整轮共用的占位时间（实测 940 场，只有 `02:00` 与 `04:00` 两种）。`matchState` 只看时间不看 `tbd`，所以占位时间一到，整轮 tbd 全部变成 `'live'`：

```
2027-03-15 02:30（PD 第 28 轮，20 场全 tbd）
groupTonight → live=20，其中 tbd=20
liveCountAt → 20        ← 顶栏「进行中」徽章
```

同一现象在 2026-10-26 02:30 的 PD 第 10 轮复现（11 场 tbd 进 live）。行内显示 `--:--` + 「待定」，但分区头是「进行中」+ 红点 + `N′` 分钟数；`liveCountAt` 还驱动桌面 TopBar 与手机 TabBar 的直播徽章（[src/components/TopBar.jsx:129](src/components/TopBar.jsx:129)、[mobile/src/ui/TabBar.tsx:43](mobile/src/ui/TabBar.tsx:43)）。

**判定**：`tbd` 不应有 live/finished 状态——`isPickable`（[src/core/owl.js:40](src/core/owl.js:40)）已经明确「`st !== 'sched' || tbd` → 不可排」。需要把同一判据提到 `matchState` 调用点：`tbd` 直接归 `upcoming`（或单列「时间待定」组），`liveCountAt` 跳过 `tbd`。

**复现**

```bash
node -e "Promise.all([import('./src/core/owl.js'),import('./src/data/index.js'),import('./src/core/engine.js')]).then(([o,d,E])=>{
  const now=E.ts('2027-03-15T02:30'); const t=o.computeTonight(now,{followedTeams:[],followedLeagues:['PD'],weeklyBudget:4});
  const g=o.groupTonight(t.slice,now); console.log('live',g.live.length,'tbd-live',g.live.filter(m=>m.tbd).length,'liveCountAt',o.liveCountAt(now));
})"
```

---

### P1-1 「值得熬」与「低于睡眠底线」同时出现在同一屏（PRD §6.7 未落地）

PRD §6.7 原文：*推荐结果不得静默低于用户底线。低于底线时必须同时显示“不推荐熬夜”或替代场次*。

现状：`decisionStrip` 完全不知道「底线」这个概念（[src/core/decision-strip.js:108](src/core/decision-strip.js:108) 只算 `costMinutes`/`remainingMinutes`），结论条照给「值得熬 · 今晚焦点」；底线只在 `SleepNote` 的一行小字里出现（[src/components/SleepNote.jsx:33](src/components/SleepNote.jsx:33)）。同一张 Hero 上，左边金句「值得熬」，下面灰色小字「低于 7h 底线，建议补看」。

**实测**（`followedTeams:['ARS','MCI']`、`followedLeagues:['PL','UCL']`、起床 07:30、底线 7h、每晚 22:00 取 Hero）：

| 指标 | 数值 |
| :-- | :-- |
| 有 Hero 的夜晚 | 68 |
| Hero 低于底线 | 56（82%） |
| 结论为「值得熬」 | 43 |
| **「值得熬」且低于底线** | **35（81%）** |

不是边缘情况：关注球队的 03:00 / 03:45 场几乎必然越线，而「关注」分支在 `verdictOf` 里优先级最高、直接 return，连代价都不看（[src/core/decision-strip.js:152](src/core/decision-strip.js:152)）。

**可选口径**（需产品拍板）：`recommended` 在 `belowFloor` 时降级为 `neutral` + 专用 reason（「看完低于底线」），或在结论条增加第五格；不建议硬过滤（PRD 明确「不直接硬过滤」）。

---

### P1-2 「建议换一场」几乎不可达——替代候选池按「好」排序，而「更轻」要按「早」筛

`decisionStrip` 的 DEFER 需要同时满足：有同夜替代、替代早结束 ≥30 分钟、替代指数 ≥ 当前 60%、且 `costMinutes ≥ 90`。候选来自 `pickToday().extras`，而 extras 的定义是「星级 ≥2 的其余场次」（[src/core/engine.js:306](src/core/engine.js:306)），Hero 又按「关注 → 联赛 → 星级 → 代价低」排序——Hero 基本就是当晚星级最高/代价最低的那场。

**实测 68 个 Hero**（两种候选池都跑了一遍）：

| 候选池 | 池非空 | 有合格替代 | `defer` 出现 |
| :-- | :-- | :-- | :-- |
| `pickToday().extras`（星级 ≥2 的其余场） | 19/68（平均 0.32 场） | 0–1 | **0** |
| `sameNightPicks(...,4)`（界面实际用的） | 61/68 | 5 | **2** |

界面用的候选池比 `extras` 好，但 68 个 Hero 里仍只有 2 次真的给出「建议换一场」。构造数据下 DEFER 路径本身是通的（`index=5`、替代 01:00 vs 03:45 → `defer`），所以不是死代码，而是**候选池的排序口径不对**：`sameNightPicks` 按指数降序取前 4（[src/core/owl.js:326](src/core/owl.js:326)），Hero 又通常是当晚最高分，前 4 里天然缺少「更早结束」的候选；而「更轻」这个判据需要按**结束时间**筛选，不是按「好」排序。桌面 [src/components/TonightView.jsx:165](src/components/TonightView.jsx:165) 与手机 [mobile/src/app/(tabs)/index.tsx:513](mobile/src/app/(tabs)/index.tsx:513) 都用 `sameNightPicks`，所以两端一样低。这是 P1-1/P1-2 的共同根因：**替代池按「好」排序，而「更轻」需要按「早」筛选**。

---

### P2-1 `attempted` 服务端永远为 true——桌面「无需检查」分支不可达

`syncScores()` 的返回体没有 `attempted` 字段（[server/scores.js:445](server/scores.js:445)），`server/index.js` 三处都用 `result.attempted !== false`（[:485](server/index.js:485)、[:603](server/index.js:603)、[:651](server/index.js:651)）——`undefined !== false` 恒真。手机分支自己补了 `attempted:false`（[mobile/src/data/sync/scores.js:473](mobile/src/data/sync/scores.js:473)）。

后果：没有任何可查目标时，桌面 `summarizeSyncResponse` 会报「已是最新」，而 `classifySyncOutcome` 里的 `not_needed` 分支永远走不到（[src/core/sync-outcome.js:16](src/core/sync-outcome.js:16)）。同类问题：`recordPendingChecks()` 在**零请求、或整轮失败**时也照写「最后检查时间」（[server/index.js:459](server/index.js:459)、[:622](server/index.js:622)），设置页会显示「刚检查过」而实际没联网。

---

### P2-2 保鲜是「严格串行 + 每请求 200ms」，配置项却没接上

`fetchAllEvents` 串行 await + 固定 `setTimeout(200)`（[server/sources/index.js:88](server/sources/index.js:88)），`rules.json` 里的 `scores.maxConcurrentLeagues:3`、`scores.requestDelayMs:400`、`scores.timeoutMs:30000` **一个都没被读取**（[server/rules.json:56](server/rules.json:56)）；ESPN 的 `fetchLeague` 只拿 `opts.timeoutMs`，而 `fetchAllEvents` 只传 `{log, season}`，所以配置的 30s 实际永远是 25s（[server/sources/espn.js:73](server/sources/espn.js:73)）。

**量化的代价**（用真实 fixtures 跑 `activeSyncTargets`）：

| 日期 | 联赛数 | 查询日数 | 仅 200ms 节流的理论下限 |
| :-- | :-- | :-- | :-- |
| 2026-11-03 | 2 | 5 | 1.0 s |
| 2026-11-22 | 6 | 39 | 7.8 s |
| 2026-12-06 | 6 | 81 | 16.2 s |
| 2027-03-15 | 6 | 152 | **30.4 s** |

再叠加每请求的网络时延与 3 次重试退避，tbd 密集周的单轮同步可以到分钟级。这是**已存在且可测量**的问题，不是「形式上全表扫描」那种误判（参见 `docs/OPTIMIZATION-PLAN.md` 的教训：先测再改）。

---

## 三、结构性风险（不是单点 bug，是「下次一定还会犯」）

### R1 手机端数据管道是手抄分支，且不在 `verify:shared` 覆盖内

`sync-shared` / `verify-shared` 只覆盖 `src/core`、`src/data`、6 个 JSON、`tz.mjs`（[mobile/scripts/verify-shared.mjs:11](mobile/scripts/verify-shared.mjs:11)）。以下文件是**人工维护的分支**：

```
mobile/src/data/sync/{scores,sources,espn,openfootball,normalize}.js
mobile/src/data/{live,highlights,scraper}.js
```

实测漂移（`diff` 确认，非猜测）：

| 文件 | 桌面 | 手机 |
| :-- | :-- | :-- |
| `scores.js` | 502 行 | 547 行，多出 `quickSyncTargets`（72h 下拉快检） |
| `normalize.js` | 有 curl 兜底、有 `localPartsToWall` 删除说明 | 无 curl；注释被压缩，事故背景丢失 |
| `openfootball.js` | 不传 `retries` | 传 `retries` |
| `highlights.js` | 磁盘缓存 + 原子写 | AsyncStorage，URL 校验用自写正则 |
| `scraper.js` | 从 `tv-channels.local.json` 读保底源 | `TV_SPORTS_CHANNELS = []`（设计如此） |

危险点不是「有差异」（差异有合理理由），而是**差异不可见**：桌面修了 `scores.js` 的窗口/改期保护，手机不会自动获得；手机加了快检逻辑，桌面也不会。`verify:shared` 给出「一致」的绿灯，容易被读成「整条管道一致」。

**建议**：把「允许差异」显式化——要么给 mobile 分支加一份 `shared-pipeline` 哈希清单（只校验不该变的公共函数），要么把这些文件拆成 `shared/` 纯函数 + 端侧薄适配器（`fs`/`AsyncStorage` 注入）。

### R2 双端 UI 语义同源、入口不同源

| 能力 | 桌面 | 手机 |
| :-- | :-- | :-- |
| 周导航（上一周/下一周） | **无**（`computeWeek(Date.now())`，[src/App.jsx:629](src/App.jsx:629)） | 有（`weekOffset`，[plan.tsx:65](mobile/src/app/(tabs)/plan.tsx:65)） |
| 补看队列三态 | 有（`toggleQueue` / `queueStatusOf`，Hero + 同开球行 + 情报面板） | 只有「加入 / 移除 / 标记已看」；Tonight 与 Hero **没有入口**（详情页与「我的」才有） |
| 同开球对比（FR-10） | 有 `SameKickoffPanel` | **无** |
| 结论文案表 | `VERDICT_COPY`/`REASON_COPY` 手写 | 同内容再手写一份（[mobile/src/ui/DecisionStrip.tsx:19](mobile/src/ui/DecisionStrip.tsx:19)） |
| 赛程日切换 | 有（前后两天 + 全季） | 有（不同实现） |

`computeWeek` 本身已支持 `weekOffset` 且注释写明「手机端下一周此前把 nowTs 整体后移」的教训——桌面只是没接参数，属于低成本补齐。

### R3 服务端边界比看起来松

- `/api/live` 不做完赛/防剧透门禁（[server/index.js:373](server/index.js:373)）；`/api/recap` 有。防剧透只在客户端 `reveal.js` 生效，任何能读响应体的进程都能拿到比分。若「防剧透」是产品承诺，服务端应至少对 `spoilerFree` 请求裁剪 `sc`。
- `/api/proxy` 的实际 GET/POST 不做 Origin 拒绝，只有预检做（[server/index.js:278](server/index.js:278)）；外部页面虽读不到响应（ACAO 受限），但能驱动代理流量、占用 16 个并发槽。
- `/api/health` 报的是 `rules.listen.port`（3100），Electron 回退到 3101–3104 时是错的（[:204](server/index.js:204) vs [electron/main.cjs:147](electron/main.cjs:147)）。
- `/api/live-sources` 把抓到的每个域名自动写进会话白名单（[:539](server/index.js:539)），与「显式授权」的设计意图相冲；50 个主机配额会被快速消耗。
- `data-store.saveFixtures` 用同步 `writeFileSync/renameSync`（[:83](server/data-store.js:83)），且没有写锁；`loadFixtures` 每个请求重读解析（0.67ms，**性能上可忽略**，但并发写读存在窗口）。

### R4 测试门禁的盲区（比缺测试更值得注意）

- `test-owl` 的两条断言与实现耦合到「实现错了才通过」（P0-1）。
- `test:all` 35 套里，手机端只有 `verify:shared / typecheck / audit:touch / export`，**没有任何针对手机 UI 行为或手机同步分支的测试**。
- `verify-shared` 的「一致」只证明 `src/core` 没漂移（R1）。

---

## 四、优化候选（按「证据强度 × 影响 ÷ 成本」排序）

| # | 事项 | 证据 | 成本 | 风险 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | 修 `groupTonight` 的 `'done' → 'finished'`，同步改测试期望 | P0-1，160/160 复现 | 2 行 + 1 条断言 | 低；需连带看手机首页分区 |
| 1b | 先补一条**真能失败**的回归断言（构造含 `done` 的切片），再改实现 | 现有断言「错了才通过」 | 小 | 低；顺序很重要，否则改完看不出对错 |
| 2 | `tbd` 不进 `live`/`finished`：`liveCountAt` 与 `groupTonight` 共用「tbd → 待定」判据 | P0-2，20/20 复现 | ~10 行 + 测试 | 低；注意 `pp` 归类一并明确 |
| 3 | 替代池改为「同夜 + 早于本场」再排序；`sameNightPicks` 增加 `earlierThan` 选项 | P1-2，defer 2/68、合格替代 5/68 | 中 | 中；会改变结论条出现的频率，需文案复核 |
| 4 | `decisionStrip` 增加 `belowFloor`，`recommended` 在越线时降级/加警示 | P1-1，35/43 | 中（双端 UI 各一处） | 中；属产品口径，需拍板 |
| 5 | 把 `attempted` 真正写进 `syncScores` 返回；`recordPendingChecks` 只在有成功请求时记录 | P2-1 | 小 | 低 |
| 6 | 接上 `requestDelayMs` / `maxConcurrentLeagues` / 每源 `timeoutMs`；先做「并发 2–3 + 保留节流」 | P2-2，152 请求 ≥30s | 中 | 中；上游封 IP 的历史风险，必须保留串行下限与指数退避 |
| 7 | 给手机同步分支加「公共函数哈希清单」，把漂移显式化 | R1 | 中 | 低 |
| 8 | 桌面周视图接 `weekOffset`（`computeWeek` 已支持） | R2 | 小 | 低 |
| 9 | 手机 Tonight/Hero 补「补看」入口，复用 `toggleQueue` 三态 | R2 | 小–中 | 低 |
| 10 | `/api/live` 对未揭晓请求裁剪比分；`/api/proxy` 实际请求加 Origin 拒绝；`/api/health` 报真实端口 | R3 | 小 | 低 |
| 11 | 去重：`BUDGETS`×3、`formatGd`×2、结论文案表双端、`theme.shadows` 与 `prefs.theme` 死字段 | 代码确认 | 小 | 低 |

**明确不建议动的**：`computeTonight`（0.9ms）、`computeWeek`（2.4ms）、`computeScheduleRows`、`liveCountAt` 的扫描成本、fixtures 全量解析（0.67ms）。`docs/OPTIMIZATION-PLAN.md` 已记录 8 条性能结论里 5 条是误判；当前没有任何热点接近可感知阈值。

---

## 五、未验证 / 待确认

- 手机 `MorningDigestSheet` 在 `_layout.tsx` 与 `me.tsx` 各挂一份，两份 `useMorningDigest` 各自读同一个 AsyncStorage key；**代码上确认存在**，未在真机上验证是否会出现重复弹窗或关闭状态互相覆盖。
- `/api/live-sources` 的 50 主机配额耗尽后的用户可见表现（未构造复现）。
- `live.js` 的 `liveCache` 无上限、`highlights.js` 的限流非并发安全：代码确认，未做压力验证，按影响暂列低。
- 手机 `MatchRow` 对 `tbd` 行的指数展示细节未逐行核对（只确认了无障碍文案会省略指数）。

---

## 六、复现脚本索引

```bash
# P0-1 已完成场次混入「未开赛」
node -e "import('./src/core/owl.js').then(async o=>{const d=await import('./src/data/index.js'),E=await import('./src/core/engine.js');const now=E.ts('2026-08-16T23:00');const t=o.computeTonight(now,{followedTeams:[],followedLeagues:['PD'],weeklyBudget:4});const g=o.groupTonight(t.slice,now);console.log('upcoming',g.upcoming.length,'done-in-upcoming',g.upcoming.filter(m=>m.st==='done').length,'finished',g.finished.length)})"

# P0-2 tbd 占位时间被算成进行中
node -e "Promise.all([import('./src/core/owl.js'),import('./src/core/engine.js')]).then(([o,E])=>{const now=E.ts('2027-03-15T02:30');const t=o.computeTonight(now,{followedTeams:[],followedLeagues:['PD'],weeklyBudget:4});const g=o.groupTonight(t.slice,now);console.log('live',g.live.length,'tbd-live',g.live.filter(m=>m.tbd).length,'liveCountAt',o.liveCountAt(now))})"

# P1-1/P1-2 越线推荐与替代命中率（68 个 Hero 的统计，替代池 = 界面实际用的 sameNightPicks）
node -e "Promise.all([import('./src/core/owl.js'),import('./src/data/index.js'),import('./src/core/engine.js'),import('./src/core/decision-strip.js'),import('./src/core/sleep.js')]).then(([o,d,E,ds,sl])=>{const p={followedTeams:['ARS','MCI'],followedLeagues:['PL','UCL'],weeklyBudget:4,sleepEnabled:true,sleepWakeTime:'07:30',sleepMinHours:7};const nights=[...new Set(d.getFixtures().filter(m=>m.st==='sched'&&!m.tbd).map(m=>E.owlDay(m.t)))].sort();let h=0,r=0,rb=0,below=0,defer=0,altQ=0;for(const n of nights){const now=E.ts(n+'T22:00'),t=o.computeTonight(now,p);if(!t.hero)continue;h++;const {ev,index}=o.evalOne(t.hero.m,p);const pool=o.sameNightPicks(t.hero.m,p,4,now).map(x=>({m:x.m,index:x.index}));const s=ds.decisionStrip({match:t.hero.m,index,prefs:p,now,followed:ev.isFollowed,alternatives:pool});const l=sl.sleepLedger(t.hero.m.t,{enabled:true,wakeTime:'07:30',minSleep:7});const isBelow=l.valid&&l.ready&&l.belowFloor;if(isBelow)below++;if(ds.lighterAlternative(t.hero.m,index,pool))altQ++;if(s.verdict==='defer')defer++;if(s.verdict==='recommended'){r++;if(isBelow)rb++;}}console.log({heroes:h,heroBelowFloor:below,recommended:r,recommendedBelowFloor:rb,altQualified:altQ,defer})})"

# P2-2 保鲜请求量
node -e "Promise.all([import('./server/scores.js'),import('./server/data-store.js')]).then(async([s,d])=>{const fx=await d.loadFixtures();for(const iso of ['2026-11-03','2026-12-06','2027-03-15']){const now=Date.parse(iso+'T12:00:00+08:00');const tg=s.activeSyncTargets(fx,now);let n=0;for(const v of tg.values())n+=v.size;console.log(iso,'dates',n,'min-pacing',n*0.2+'s')}})"
```
