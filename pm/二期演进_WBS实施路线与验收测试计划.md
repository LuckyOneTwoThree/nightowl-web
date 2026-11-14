# 夜猫看台 · 二期演进 WBS 实施路线与验收测试计划

> **状态**：📝 **待评审确认（确认后按阶段启动开发）**  
> **前置基线**：现行主干 `d73c628`（桌面端 `npm run test:all` + `check:render` + `check:layout` 全绿，手机端 `npm run check` 全绿）。

---

## 一、分阶段实施路线图（WBS）

按 **投入产出比（ROI）优先、纯核心层先行、双端同步严格闭环** 原则，划分为 3 个可独立验收的交付阶段：

### Phase 1 · 零外部依赖高 ROI 破局（P0：M1 + M2）
**目标**：用 100% 已有本地数据与算法基础设施，先上线两大“立竿见影”的痛点功能，验证用户交互形态。

| WBS 编号 | 任务包 | 核心交付物 | 涉及模块 / 文件 |
| :--- | :--- | :--- | :--- |
| **P1-T1** | 无剧透剧情心电图纯函数 | `summarizeDrama()` 状态机、降级判断、防剧透 DTO 脱敏 | `src/core/drama.js` + `tools/test-drama.mjs` |
| **P1-T2** | 桌面 & 手机端 Drama Meter 接入 | `MorningDigest` 与未揭晓完赛卡展示标签 + 脉冲心电条 | `src/components/MorningDigest.jsx` / `MatchRow.jsx` · `mobile/src/components/MorningDigestSheet.tsx` |
| **P1-T3** | 3 分杠杆赛果沙盘纯函数 | `simulateMatchStandings()` + 同轮竞争对手扫描 | `src/core/sandbox.js` + `tools/test-sandbox.mjs` |
| **P1-T4** | 桌面 & 手机端赛果沙盘交互 | `StandingsModal` / `MatchCanvas` / `StandingsPanel` 胜平负三态开关 | `src/components/StandingsModal.jsx` / `MatchCanvas.jsx` · `mobile/src/components/StandingsPanel.tsx` |
| **P1-T5** | 共享同步与 Phase 1 回归锁 | 运行 `sync:shared`、双端全量测试、布局 0px 溢出验证 | 桌面 `test:all` + `check:layout` · 手机 `npm run check` |

---

### Phase 2 · 护眠进阶与赛季情绪留存（P1：M3 + M4）
**目标**：打通“04:00 下半场切入 + 桌面无剧透悬念唤醒”以及“赛季个人履历与账单分享”。

| WBS 编号 | 任务包 | 核心交付物 | 涉及模块 / 文件 |
| :--- | :--- | :--- | :--- |
| **P2-T1** | 下半场切入计算与雷达核心逻辑 | `planSecondHalfCutIn()` 与 `evaluateRadarSuspense()` | `src/core/second-half.js` · `src/core/radar.js` + 单元测试 |
| **P2-T2** | 双端下半场切入 UI 与定时闹钟 | 详情/决策条切入切换；桌面通知 + 手机 `expo-notifications` 60' 定时提醒 | `src/components/DecisionStrip.jsx` · `mobile/src/lib/reminders.ts` |
| **P2-T3** | 桌面端 60' 悬念雷达守护调度 | 受控轮询窗（≤2 场、55'–70'、≥60s 节流）与绝不剧透推送 | `server/index.js` · `electron/main.cjs` · `tools/test-radar.mjs` |
| **P2-T4** | 观赛情绪印章与赛季账单内核 | `diary.js` 存储契约、ROI 验钞统计、`buildSeasonReport()` | `src/core/diary.js` · 存储适配 · `tools/test-diary.mjs` |
| **P2-T5** | 双端印章打卡与本地战报海报 | 「我的」/ 复盘弹窗印章入口 + 桌面端 SVG/Canvas PNG 导出 + 手机端长图预览 | `src/components/` · `mobile/src/app/(tabs)/me.tsx` |

---

### Phase 3 · 精细伴看与双端零云端接力（P2：M5 + M6）
**目标**：补齐跨周长线洞察、桌面物理伴看舒适度，并打通桌面 ↔ Android 的无云端本地闭环。

| WBS 编号 | 任务包 | 核心交付物 | 涉及模块 / 文件 |
| :--- | :--- | :--- | :--- |
| **P3-T1** | 14 天魔鬼赛程预警与周计划 ICS | `crunch.js` + `ics.js` plan 模式 + `/api/calendar/plan.ics` | `src/core/crunch.js` · `src/core/ics.js` · `server/index.js` |
| **P3-T2** | 桌面迷你置顶窗 & 防睡着休眠锁 | Electron 原地紧凑模式（不中断播放流）+ 倒计时/完赛静音暂停 | `electron/main.cjs` · `src/components/PlayerStage.jsx` · `mobile/WatchSheet.tsx` |
| **P3-T3** | 无冲突双向同步协议内核 | `sync-bundle.js` 增量合并状态机（含队列单向收敛与已揭晓并集） | `src/core/sync-bundle.js` + `tools/test-sync-bundle.mjs` |
| **P3-T4** | 桌面隔离临时 LAN 配对服务 | 独立端口 `120s TTL` 临时微服 + QR 生成 + 严格路由白名单审计 | `server/lan-pair.js` + 安全越权拦截测试 |
| **P3-T5** | 手机端 `nightowl://pair` 与接力落地 | 深链扫码 + 6 位 PIN 手输兜底 + 接力自动跳 `WatchSheet` 寻公开线 | `mobile/src/app/pair.tsx` · `mobile/app.json` |

---

## 二、测试策略与硬性验收门禁

每一阶段合入主干前，必须满足以下 4 类验证全绿：

### 2.1 自动化单元测试（延续 `tools/test-*.mjs`）
1. **防剧透与真实性逆向断言**：
   - `test-drama.mjs`：测试对 `summarizeDrama` 返回体执行 `JSON.stringify`，断言不含 `match.sc`、不含三字码、`side` 键数等于 `0`；验证 `events = []` 时 `2-1` 不出现 `剧本反转`、`终场悬念` 或任何脉冲点。
   - `test-sandbox.mjs`：验证 `UCL r9` 与 `SCG` 拒绝沙盘推演；验证模拟 `1-0` 后不污染传入的原始 `fixtures` 数组（严格不可变性）。
   - `test-radar.mjs`：验证 `WORTH_WAKING` / `GARBAGE_TIME` / `DULL_DRAW` / `UNAVAILABLE` 4 个出口分支及通知文案正则脱敏（无比分、无队名领先暗示）。
   - `test-sync-bundle.mjs`：验证手机旧队列 (`pending`) 与桌面新队列 (`watched`) 合并后结果必须为 `watched`；验证 `revealedIds` 合并不丢失任何已揭晓场次。

### 2.2 安全性专测（M6 必测红线）
1. 主进程/本地服务端口扫描断言：常驻运行状态下，向本机局域网 IP 发起 TCP 连接与 HTTP `/api/proxy` 请求必须被拒绝（`ECONNREFUSED`）；
2. 开启 120s 临时配对窗口期间：
   - 向临时配对端口请求 `/api/proxy?url=...`、`GET /api/fixtures` 必须返回 `404`；
   - 错误 Token / 错误 PIN 请求 `/pair/sync` 必须返回 `401/403`；
   - 超时 120s 后再次请求配对端口必须关闭连接（`ECONNREFUSED`）。

### 2.3 双端渲染、触控与基线防漂移检查
* **桌面端**：
  ```bash
  npm run build && npm run test:all
  env -u ELECTRON_RUN_AS_NODE npm run check:render
  env -u ELECTRON_RUN_AS_NODE npm run check:layout
  ```
  - 重点验证 `MorningDigest` 新增脉冲条、沙盘按钮与桌面 `mini-mode` 下无横向溢出（`0px overflow`）且无重叠遮挡。
* **手机端**：
  ```bash
  cd mobile && npm run sync:shared && npm run sync:pipeline && npm run check
  ```
  - 必须确保 `audit:touch` 全部新增 `Pressable` ≥ 44dp、TypeScript 零错误、`verify:shared` 零漂移。

---

## 三、潜在风险识别与应对预案

| 风险项 | 影响程度 | 应对设计 |
| :--- | :---: | :--- |
| **ESPN 某些冷门场次无 `keyEvents` 只有比分** | 中 | M1 显式区分 `hasEvents`，仅保留总进球级标签并诚实提示；M3 在无实时比分或事件时安全降级为 `UNAVAILABLE` 普通叫醒 |
| **局域网企业/校园 Wi-Fi 开启 AP 隔离导致手机连不上桌面 IP** | 中 | M6 在配对失败提示中明确告知“同一 Wi-Fi 下可能存在 AP 隔离”，同时保留 M4 的单文件 JSON 导出/导入作为零网络兜底通道 |
| **桌面“甩到手机看”遇到必须走本地代理的加密/防盗链线路** | 中 | 不盲传 `127.0.0.1` 不可达地址；明确标记 `proxyRequired` 并在手机侧自动触发公开直链重抓，不制造假死黑屏 |
| **Android 后台休眠导致用户误以为手机也会深夜自动查比分** | 高 | 在 PRD 与 UI 文案层明确双端边界：Android 端定位为「**定时闹钟唤醒**」，仅桌面端常驻开启「60' 智能悬念雷达」，杜绝预期落空 |
