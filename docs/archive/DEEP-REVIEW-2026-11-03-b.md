# 深度复核（2026-11-03 · 第二轮）

> 只读研究 + 小批次执行记录。基线：`npm run test:all` 全过（0 失败）、`npm run build` 通过、`mobile` 的 `verify:shared / typecheck` 通过。
> 本轮目标：在 v0.1.47 上**复验上一轮结论是否已修复**，并补充独立新发现；随后按"低风险优先"落地 A1/A2。

---

## 一、上一轮《DEEP-REVIEW-2026-11-03》结论复验（当前代码实测）

| 上轮结论 | 现状 | 证据 |
| :-- | :-- | :-- |
| P0-1 `groupTonight` 把 `done` 归入未开赛 | ✅ 已修 | `done-in-upcoming=0 finished=2`；[src/core/owl.js:442](../src/core/owl.js:442)；测试补了合成切片断言 [tools/test-owl.mjs:114](../tools/test-owl.mjs:114) |
| P0-2 `tbd` 占位时间被算成 live | ✅ 已修 | `live=0 tbd-live=0 liveCountAt=0`；tbd 统一走 `upcoming` |
| P1-1 「值得熬」与「低于底线」同屏 | ✅ 已修 | 68 Hero：`recommended=8, recommendedBelowFloor=0`；越线降级 neutral/defer [src/core/decision-strip.js:162](../src/core/decision-strip.js:162) |
| P1-2 「建议换一场」不可达 | ✅ 已接线 | 新增 `sameNightLighterPicks`（按结束时间筛「更早」）[src/core/owl.js:371](../src/core/owl.js:371)，桌面/手机 Tonight 均使用 |
| P2-1 `attempted` 服务端恒真 | ✅ 已修 | [server/scores.js:444](../server/scores.js:444)；`recordPendingChecks` 加 `hadSuccessfulRequest` 门禁 [server/index.js:181](../server/index.js:181) |
| P2-2 保鲜串行、配置项未接线 | ❌ 仍未 | `fetchAllEvents` 串行 + 固定 200ms；`rules.scores` 的 `maxConcurrentLeagues/requestDelayMs/timeoutMs` 未读取 [server/sources/index.js:88](../server/sources/index.js:88) |
| R1 手机数据管道手抄、`verify:shared` 覆盖窄 | ❌ 仍在 | `mobile/src/data/sync/scores.js` 多 `quickSyncTargets`；`normalize.js` 96 vs 160 行；[mobile/scripts/verify-shared.mjs:9](../mobile/scripts/verify-shared.mjs:9) |
| R2 双端入口不同源（周导航等） | ⚠️ 本轮已补桌面周导航 | 见下文 A1 |
| R3 服务端边界偏松 | ❌ 仍在 | `/api/live` 不按防剧透裁剪；`/api/proxy` 仅 OPTIONS 校验 Origin；`/api/health` 报配置端口；`/api/live-sources` 自动并入白名单 |

---

## 二、本轮新发现（独立证据）

1. **远期周规划被 `tbd` 稀释**：全量 1897 场里 940 场 `tbd`（50%）。近端第 0/2/3 周可排 56/38/46 场，第 4–9 周降到 20/29/10/10/21/10 场。算法排除 tbd 是正确的，但"本周精选"趋空时需要一句预期管理（周视图已显示 `tbdCount`）。
2. **手机数据分支漂移**：`quickSyncTargets` 只在手机侧；`normalize.js` 少了桌面 curl 兜底。`verify:shared` 的"一致"并不覆盖这条管道。
3. **`App.jsx` 巨型组件**：1421 行、27 `useState` / 26 `useEffect` / 21 `useMemo` / 35 `useCallback` / 9 `useRef`。已有 `useDataHealth`/`useLiveSnapshot` 先例，收敛未完成。
4. **手机晨间摘要双实例**：`_layout.tsx` 与 `me.tsx` 各挂一个 `useMorningDigest`，各自维护 `visible`、共读同一 AsyncStorage key；自动弹在 `_layout`，`me` 为手动入口，关闭只写 key、不回写另一实例。
5. **`verify:algo` 已退役**（直接 exit 0）。"与原版 0 偏差"冻结在 `BASELINE.md`，不再是活门禁。
6. **小遗留**：`server/live.js` 的 `liveCache` 无容量上限（highlights 有 500 条淘汰）；`isFinished` 接受 `st==='ft'` 但 `ALLOWED_ST` 不含 `ft`（死分支）。

---

## 三、本轮已执行（A1 + A2）

### A1 桌面周视图接入 `weekOffset`（补齐 R2）

- [src/App.jsx](../src/App.jsx)：新增 `weekOffset` 状态；`computeWeek(..., { weekOffset })`；把 `weekOffset / onWeekOffsetChange` 传给 `WeekView`。
- [src/components/WeekView.jsx](../src/components/WeekView.jsx)：标题行加「上一周 / 本周 / 下一周」导航；切换周时清空单晚筛选；标题按 `本周 / 未来周 / 历史周` 变化；**历史周不显示睡眠风险带与底线结论**（历史周无可排场次，显示"未越线"会误导），空态文案区分历史周。
- `computeWeek` 早已支持 `weekOffset`，`test-owl` 已有覆盖（[tools/test-owl.mjs:573](../tools/test-owl.mjs:573)），无需新增断言。

### A2 去重收口

- **每周预算选项 ×3 → 单一常量**：新增 [mobile/src/ui/budgetOptions.ts](../mobile/src/ui/budgetOptions.ts) 的 `WEEKLY_BUDGET_OPTIONS`；`me.tsx / plan.tsx / onboarding.tsx` 改为别名引入。
- **净胜球格式化 ×2 → 单一函数**：新增 [mobile/src/lib/format.ts](../mobile/src/lib/format.ts) 的 `formatGd`；`match/[id].tsx` 与 `StandingsPanel.tsx` 复用。
- **删除 `prefs.theme` 死字段**：[src/core/prefs.js](../src/core/prefs.js) 移除 `KEY.theme / DEFAULT_THEME / defaultPrefs.theme / loadPrefs.theme / savePrefs` 写入（主题恒为暗色，`applyTheme()` 不变）；已 `sync:shared` 同步到手机。

> 说明：`VERDICT_COPY` 双端各写一份**未强行合并**。`core/decision-strip.js` 顶部明确"只返回语义枚举与数值，不返回中文文案"，把文案塞进 core 会破坏这条纪律；若要去重，应另建同步的 UI 文案模块，成本/收益目前不划算。

---

## 四、后续建议批次（未执行，供排期）

| 批次 | 事项 | 证据 | 风险 |
| :-- | :-- | :-- | :-- |
| A3 | 手机同步分支「公共函数哈希清单」或拆 `shared/` 纯函数 | 新发现 2 | ✅ 已完成（见第五节） |
| A4 | 手机晨间摘要收口为单一实例 | 新发现 4 | ✅ 已完成（见第五节） |
| C1 | 保鲜接 `requestDelayMs/maxConcurrentLeagues/timeoutMs`（先做小并发 2–3 + 保留串行下限与指数退避） | P2-2，152 请求 ≥30s | 🔶 部分完成：`timeoutMs` 已透传（桌面+手机）；**并发暂缓**（实测多数周末仅 5–8s，封 IP 风险不划算，见第七节） |
| D1 | 拆分 `App.jsx`（`useWatchLater / useStopLoss / useOverlayStack / useFixturesRefresh`） | 新发现 3 | ✅ 四刀已完成（App 1421→1228，见第六节） |
| B1 | `/api/live` 按 `spoilerFree` 裁剪；先拍板威胁模型 | R3 | ⏸ 暂缓（本地单用户威胁模型不成立，见第七节说明） |
| B2 | `/api/proxy` 实际请求加 Origin 拒绝；`/api/health` 报真实端口 | R3 | ✅ 已完成（见第六节） |

**明确不建议动**：`computeTonight / computeWeek / computeScheduleRows / liveCountAt / fixtures 全量解析` 等"热点"（`docs/OPTIMIZATION-PLAN.md` 记录 8 条性能结论中 5 条为误判，当前无可感知热点）。

---

## 五、第二批执行（A3 + A4）

### A4 手机晨间摘要收口为单一实例

- 新增 [mobile/src/state/morningDigest.ts](../mobile/src/state/morningDigest.ts)：只持有一个递增 `openSignal`，不持任何比赛数据（补看队列仍是唯一事实源）。
- [mobile/src/app/_layout.tsx](../mobile/src/app/_layout.tsx)：摘要**只在这里挂一份**（自动弹出也在这里）；监听 `openSignal` 变化时调用唯一实例的 `open()`。
- [mobile/src/app/(tabs)/me.tsx](../mobile/src/app/(tabs)/me.tsx)：移除自挂的 `useMorningDigest` 与 `<MorningDigestSheet>`；「看摘要」改为 `requestOpen()`；顺带移除仅供旧弹窗使用的 `revealedIds / revealMatch` 读取。
- 效果：消除「两份 visible + 共读同一 AsyncStorage key、关闭不回写另一实例」的潜在叠层/复弹。

### A3 手机同步管道差异清单（让漂移可见）

- 新增 [mobile/scripts/verify-pipeline.mjs](../mobile/scripts/verify-pipeline.mjs) 与生成的 [mobile/scripts/pipeline-manifest.json](../mobile/scripts/pipeline-manifest.json)：登记 `scores/sources/espn/openfootball/normalize` + `live/highlights/scraper` 共 8 对桌面↔手机文件的内容哈希与行数差。
- 默认校验：任一侧内容变化即失败，提示复核两端是否仍等价；`npm run sync:pipeline`（`--write`）在人工确认后更新哈希。**它不要求两端逐字节相同**，只让"不可见的漂移"变成"必须显式确认的改动"。
- 已接入 `mobile/package.json` 的 `verify:pipeline` / `sync:pipeline`，并挂到 `pretypecheck` 与 `check`；`docs/DEVELOPMENT.md`、`mobile/README.md` 已补说明。
- 已实测：临时改动 `espn.js` → 校验失败并指出"mobile 已变"；还原后恢复通过。

---

## 六、第三/四/五/六批执行（B2 + D1 四刀）

### B2 服务端边界加固

- [server/index.js](../server/index.js) `/api/proxy`：**实际 GET/POST 也校验 Origin**（此前只校验 OPTIONS）。外部网页虽读不到响应（ACAO 受限），原可驱动代理流量、占用并发槽；同源 / 非浏览器请求无 Origin，照旧放行。
- [server/index.js](../server/index.js) `/api/health`：`listening` 改为 `server.address()` 的**真实绑定端口**，修正 Electron 回退 3101–3104 时仍报 3100 的错误。
- [tools/test-proxy.mjs](../tools/test-proxy.mjs)：新增 3 条断言——health 报真实端口、外部 Origin 的实际 GET → 403、本机回环 Origin 的实际 GET → 放行。`test:proxy` 29/29 通过。

### D1 第一刀：抽出 `useWatchLater`

- 新增 [src/hooks/useWatchLater.js](../src/hooks/useWatchLater.js)：把补看队列的 `state + ref + 四处写操作` 从 [App.jsx](../src/App.jsx) 抽出，队列语义仍全部在 `core/queue.js`，hook 只负责持久化与防陈旧闭包。
- [App.jsx](../src/App.jsx) 由 ~30 行样板降为一行解构；`addToQueue / markQueueWatched / removeFromQueue / toggleQueue / loadWatchLater / saveWatchLater` 的导入一并收敛。
- 回归：`test:all` 0 失败、`check:render` 77/77（其中「开始依序补看 / 标记已看 / 上一场下一场」正是补看队列路径，直接覆盖本次抽取）。

### D1 第二刀：抽出 `useStopLoss`

- 新增 [src/hooks/useStopLoss.js](../src/hooks/useStopLoss.js)：把止损的 `三份 state + 触发/过期两个 effect + 三个动作` 从 App 抽出；判定仍全部在 `core/stop-loss.js`，hook 不造判据。
- [App.jsx](../src/App.jsx) 用一次解构替代了三段散落代码，并把 `blocked`（任一浮层打开）显式传入，行为与原 `settingsOpen || onboardingOpen || ...` 条件等价。
- 回归：`test:all` 0 失败（含 `test-stop-loss` 核心判据）、`check:render` 77/77、`build` 通过。App 行数由 1421 降到 **1322**。
- 说明：render 冒烟未单独覆盖「止损弹条」的 DOM（检查脚本里没有该场景），本次为行为等价搬移 + 构建/离线回归保障；如需可在后续补一条可控作息/时间的 render 场景。

### D1 第三刀：抽出 `useOverlayStack`

- 新增 [src/hooks/useOverlayStack.js](../src/hooks/useOverlayStack.js)：把「背景 inert / Esc 只关最上层 / 按打开顺序入栈」从 App 抽出；`closers` 用 ref 持有，避免 Esc 监听器每次渲染重挂。
- [App.jsx](../src/App.jsx) 删除约 70 行浮层样板，只留一次 `useOverlayStack({ flags, splashOpen, closers })` 解构出 `overlayOpen / inertFor`。
- 回归：`test:all` 0 失败、`check:render` **77/77**（其中「更新弹窗打开时下层设置抽屉退出焦点（inert）」「赛程筛选面板按 Esc 关闭并归还焦点」「设置关闭后焦点回到偏好入口」等，正是本条逻辑的直接覆盖）。App 行数 1421 → **1270**。
- 剩余可继续抽取项：`useScoreSync`。

### D1 第四刀：抽出 `useFixturesRefresh`

- 新增 [src/hooks/useFixturesRefresh.js](../src/hooks/useFixturesRefresh.js)：抽走 `dataRev / refreshData / 两层竞态保护 / 窗口聚焦校准`，只负责「从 `/api/fixtures` 拉最新数据替换内存快照」。
- **有意不含 `triggerSync`**：triggerSync 依赖 `useDataHealth` 的 `refreshHealth`，而 useDataHealth 又依赖本 hook 的 `refreshData`，硬合并会把顺序耦合藏得更深。同步触发与轮询仍留在 App，按原顺序组装；App 侧用 `bumpDataRev()` 替代原 `setDataRev(v=>v+1)`。
- 回归：`test:all` 0 失败、`build`、`check:render` 77/77；App 行数 1270 → **1228**（四刀累计 **−193**）。

---

## 七、收尾（P1 零风险项 + 整体验收）

### P1 零风险项

- **保鲜超时透传**：`server/sources/index.js` 的 `fetchAllEvents` 增加 `timeoutMs` 并下传各源；`server/scores.js` 从 `rules.scores.timeoutMs` 传入。此前配置的 30s 因 `fetchAllEvents` 不传参而永远落成 ESPN 默认 25s。手机端同步 `mobile/src/data/sync/scores.js` 的完整同步同样改为用 `cfg.timeoutMs`（快检仍 6s）。**未引入并发**（避免封 IP 风险）。
- **周计划 tbd 透明度**：`WeekView` 在「只有 tbd 场次」或「预算内选不出、但有 tbd」时，提示「本周 N 场开球时间待定，公布后自动进入规划」，避免把"空计划"误读为 bug。
- 管道门禁 A3 恰好拦下 P1 的桌面改动 → 已把手机端同步口径镜像后 `sync:pipeline --write` 接受；`verify:pipeline` 恢复一致。

### 整体验收（全部通过）

| 检查 | 结果 |
| :-- | :-- |
| `npm run test:all` | ✅ 0 失败 |
| `npm run build` | ✅ 通过 |
| `npm run check:render`（真实 Electron） | ✅ 77/77 |
| mobile `npm run check`（verify:shared / verify:pipeline / audit:touch / typecheck） | ✅ 通过 |
| mobile `npm run export:android` | ✅ 产出 bundle |

> 未做 `electron-builder` 真机/安装包冒烟（需下载 electron 打包链、耗时且本机无签名身份），如需发版前再单独跑。

---

## 八、复现脚本索引

```bash
# 上一轮 P0/P1 是否仍存在（当前应全部为已修）
node -e "Promise.all([import('./src/core/owl.js'),import('./src/core/engine.js'),import('./src/data/index.js')]).then(([o,E,d])=>{const now=E.ts('2026-08-16T23:00');const t=o.computeTonight(now,{followedTeams:[],followedLeagues:['PD'],weeklyBudget:4});const g=o.groupTonight(t.slice,now);console.log('done-in-upcoming',g.upcoming.filter(m=>m.st==='done').length,'finished',g.finished.length)})"

# 内存续：P2-2 请求量（tbd 密集周）
node -e "Promise.all([import('./server/scores.js'),import('./server/data-store.js')]).then(async([s,d])=>{const fx=await d.loadFixtures();const now=Date.parse('2027-03-15T12:00:00+08:00');const tg=s.activeSyncTargets(fx,now);let n=0;for(const v of tg.values())n+=v.size;console.log('dateQueries',n,'minPacing',(n*0.2).toFixed(1)+'s')})"

# A1 weekOffset 定位
node -e "Promise.all([import('./src/core/owl.js'),import('./src/core/engine.js')]).then(([o,E])=>{const p={followedTeams:[],followedLeagues:['PL'],weeklyBudget:4};const now=E.ts('2026-11-03T12:00');for(const off of [-1,0,1,2]){const w=o.computeWeek(now,p,{weekOffset:off});console.log(off,w.weekStartStr,'actionable',w.actionableMatches.length,'best',w.plan.best.length)}})"
```
