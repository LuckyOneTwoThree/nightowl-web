# 深度复核 · 最终版（2026-11-04）

> 本文件合并三份独立审查（本人两轮 + 一份外部审查），**逐条复核后**只保留站得住的结论，取代同日的初版。
> 基线 v0.1.49 · 只读审查，未改业务代码。
> 每一处"确认"都附了复现命令或实测数据；标"需修正"的是我复核后认为对方定级或表述不成立的项。

---

## 零、修复落地状态（2026-11-04 当日完成）

所有 P0/P1、P2 主体与 P3 高价值项已在本轮落地，门禁从 1110 → **1130 断言 / 38 脚本全绿**，
`check:render` 81 → **82 项**（新增「切剧场不重建播放器」），`check:layout` 三档 × 两种边框无横向溢出，mobile `check` 全过。

| 项 | 状态 | 关键改动 |
| :-- | :-- | :-- |
| P0-1 历史签名直链 | 🟡 门禁已加，历史待清洗 | `.gitleaks.toml` + `tools/check-secrets.mjs`（负向验证过）+ `secret-scan.yml`；历史清洗需 force-push，仍待拍板 |
| P1-1 改期 >1 天查不到 | ✅ | 积压场次窗口 ±1 → ±MATCH_WINDOW_DAYS；实测救回 `FL-9-LOR-BRT`（0-2 / 11-03 03:45），另纠正 2 场改期 |
| P1-2 partial_failure 丢补丁 | ✅ | `ok` 改为「结果可用」+ 新增 `degraded`；死分支复活；顶栏「同步失败」降级为黄色「已更新 N 场」 |
| P1-3 用户数据遮蔽内置 | ✅ | `mergeFixtures` 按 id 并集合并；端到端验证 1898 = 1897 + 1 |
| P1-4 播放器卸载重建 | ✅ | 三布局共用一套 DOM；`check:render` 新增结构性断言（负向验证：加 key 后 `kept:false` 变红） |
| P1-5 手机只跑快检 | ✅ | 24h 一次完整同步（失败不写时间戳） |
| P1-6 止损提示被消费 | ✅ | 桌面抽 `anyOverlayOpen` 单一变量；手机补 `blocked`（播放器 panelOpen / 详情 WatchSheet） |
| P2-1 deadline 截断 | ✅ | `truncated/skipped` 上报，不推进 `lastCheckedAt`，判定 `partial_failure` |
| P2-2 单条脏数据打掉整页 | ✅ | `setFixtures` 结构校验（真实 1897 条 0 误伤，脏数据 7→5） |
| P2-3 Host 校验 / SSRF | ✅ | Host 白名单（用 `server.address().port`）+ `isPrivateHost` 拒绝 IP/localhost/内网名；`new URL` 移进 try |
| P2-4 数据落后误报 | ✅ | `staleHours` 以完赛时刻为基准；「落后」需同时满足 `pendingCount > 0` |
| P2-5 检查记录作用域 | ✅ | 单场重查只记该场；后台按失败联赛排除 |
| P2-6 设置页时间冻结 | ✅ | 内部 30s `nowTs` 进依赖；`freshText` 用 `freshAt` 向后推算；补看 7 天过期改用它 |
| P2-7 赛程页 tbd 计数 | ✅ | `computeScheduleRows` 新增 `tbdCount`；表头「20 场（待定 20）」，芯片全待定时写「待定 20」；57/136 组受影响 |
| P2-8 播放失败记两次 | ✅ | 同线路 800ms 内合并，切场重置 |
| P2-9 proxy/allow 当成功 | ✅ | 检查 `res.ok` 与 `body.ok`，失败回退 `activeLineId` |
| P2-10 手机文案与事实相反 | ✅ | `dataStateHint` 加 `canRecheck`；首页错误条改用真实 `syncError` |
| P2-11 预算 +1 落到 7 | ✅ | 改为落到下一个合法档位 |
| P2-12 Electron 过支持期 | 🟡 部分 | patch/minor 已升（audit high 16→14）；Electron 33→45、builder 25→26、Tailwind 3→4 属 major，需单独一批 + Windows CI 回归；剩 1 critical（tar，构建期） |
| P3-1..15 | 部分 | 已修：`tbd` 分支、`live-sources` 失败归因、`will-navigate` 协议、缓存头、`requestDelayMs` 接线；其余见第七章批次 5 |
| G1 反向断言 | ✅ | `test-owl:98` 改为按 `stateOf` 判定，另补「tbd 归 upcoming」正向断言 |
| G2 改期测试覆盖 | ✅ | 新增「积压覆盖 20261102」「当天刚完赛仍 ±1」两条 |

---

## 零之一、基线

| 检查 | 结果 |
| :-- | :-- |
| `npm run test:all` | ✅ 37 脚本 / **1110 断言**全过 |
| `vite build` | ✅ 2.98s；index 777KB(gzip 201KB) + Player 702KB(gzip 217KB)，Vite 警告 >500KB |
| `mobile` check | ✅ verify:shared（零漂移）/ verify:pipeline / audit:touch（101 Pressable）/ tsc |
| `npm audit --omit=dev` | ✅ 0 |
| `npm audit`（全量） | ⚠️ 34 项：**1 critical / 16 high**（见 P2-12） |

---

## 一、复核矩阵

### 1.1 上一轮（11-03）P0/P1 —— 全部真修

| 项 | 复验证据 |
| :-- | :-- |
| P0-1 `done` 混入「未开赛」 | `2026-08-16T23:00` → upcoming 0 / finished 2 / doneInUpcoming 0；测试已补合成切片 |
| P0-2 `tbd` 被判 live | `2027-03-15T02:30` → live 0 / `liveCountAt` 0 / `stateOf` 返回 `tbd` |
| P1-1 越线仍推荐熬夜 | 68 Hero：`recommendedBelowFloor` **35 → 0** |
| P1-2「建议换一场」不可达 | ⚠️ 仍 `defer` 2/68、合格替代 5/68（属产品口径，不建议靠放松阈值） |
| P2-1 桌面 `attempted` 恒真 | ✅ 改为 `bySource.requests > 0` |
| P2-2 配置项未接线 | ⚠️ `timeoutMs` 已透传；`requestDelayMs(400)` / `maxConcurrentLeagues(3)` 仍是**死配置** |
| R2 桌面周导航 | ✅ `weekOffset` 已接 |

### 1.2 外部审查新增项 —— 逐条复核

| # | 外部结论 | 我的复核 | 判定 |
| :-- | :-- | :-- | :-- |
| 1 | 公开仓库历史泄露签名直播直链 | `git log -S "SecurityKey"` 定位到 `23e47a3` / `ce883ca` / `79f3aa4`；`23e47a3:server/scraper.js` 含 **2 条 579 / 581 字符 URL**，`SecurityKey`/`encrypt`/`timestamp`/`userid` 各 2 次；`56f0c0d` 提交信息自认「含会话签名与个人标识，不再入库」 | ✅ **成立，P0** |
| 2 | 改期超过 1 天永远查不到 | 本地 `FL-9-LOR-BRT` = `2026-11-01T03:45` / sched；ESPN `dates=20261102` 返回 `Brest at Lorient 2026-11-02T19:45Z Full Time`（北京 11-03 03:45）；`scores.js:161` 只 `add(±86400000)`，`scores.js:393` 单场重查同样 `[-1d,0,+1d]` | ✅ **成立，P1** |
| 3 | `partial_failure` 时补丁被丢弃 | `sync-outcome.js:49` 返回 `ok:false`；`App.jsx:421` `if (!outcome.ok) return;` → 后续 `payload.fixtures` 永不应用；**且 `App.jsx:431` 的 `partial_failure` 分支因此永不执行（死代码）** | ✅ **成立，P1**（我上轮漏了） |
| 4 | 用户数据永久遮蔽内置赛程 | `data-store.js:58` `activeFixturesPath()` = 用户文件存在即完全替代，`loadFixtures()` 无合并 | ✅ **成立，P1** |
| 5 | `staleHours` 把休赛日误报成过期 | `data-store.js:117` `staleHours = now - lastScoreTs`，`lastScoreTs` 取**开球时间**，非同步时间 | ✅ 成立，P2 |
| 6 | `recordPendingChecks` 作用域过大 | `server/index.js:473`（单场重查）与 `:636`（后台同步）都传**全部** `fixtures`；`hadSuccessfulRequest` 只要求任一 source `ok>0` | ✅ 成立，P2 |
| 7 | Electron 33 过支持期 / 审计 1 critical 16 high | 实测 34 项（1 critical / 16 high），`electron <=42.11.15` 标 high | ✅ 成立，P2 |
| 8 | `pp` 有时间的场次永不进同步目标 | 代码属实（`scores.js:141` 只排除 `pp && !t`，`:147` 只收 `sched`）；**但当前 fixtures 里 `pp` 总数为 0** | ⚠️ **需修正定级**：理论缺陷，当前数据不可触发 |
| 9 | `SwitchRow` 缺 `describedBy` | 属实（`SettingsDrawer.jsx:797` 只传 `label`）；但 `Hint` 是 hover tooltip 而非屏读文本 | ⚠️ **需修正**：影响面比表述小，P3 |
| 10 | `test-scores.mjs` 把「±1 天」写成预期 | 实际断言只 `has('20260913') && has('20260915')`，**不断言 size**；扩窗后该测试仍会通过 | ⚠️ **需修正表述**：是**覆盖不足**（缺「实际晚 2 天」用例），不是「固化缺陷」 |

### 1.3 两份报告重合项（互相印证，可信度最高）

- 播放器 `/api/live-sources` 失败只 `console.warn`、空态归因「源站推流受限」
- `will-navigate` 未限制协议就 `shell.openExternal`
- 同步串行 + 固定 200ms，`requestDelayMs`/`maxConcurrentLeagues` 未接线
- 手机首页错误条硬编码「沿用本地数据」
- 主 chunk 超 500KB

### 1.4 外部审查未覆盖、由本轮补上的项

播放器卸载重建（P1-4）· 手机例行同步只跑快检（P1-5）· 止损提示静默消费（P1-6）· 单条脏数据打掉整页（P2-2）· Host 校验与代理 SSRF（P2-3）· 设置页时间冻结（P2-6）· 赛程页 tbd 计入表头（P2-7）· 播放器双通道记两次（P2-8）· `proxy/allow` 的 `200+{ok:false}`（P2-9）· 预算 +1 落到 7（P2-11）· **门禁假绿**（第六章）

---

## 二、P0

### P0-1 公开仓库历史含个人签名直播直链

**证据（脱敏）**

```
git log -S "SecurityKey" --oneline -- .
  56f0c0d chore: 保底频道直链外置（含会话签名与个人标识，不再入库）
  ce883ca fix: 播放链路两处 P1 —— HLS 类型误判致黑屏 + 并发闸门泄漏
  23e47a3 feat: 直播源自动抓取 + 真实数据统计

git show 23e47a3:server/scraper.js   # 337 行
  最长 URL：581 / 579 字符
  敏感字段：SecurityKey ×2、encrypt ×2、timestamp ×2、userid ×2
```

- 当前 HEAD **干净**：`server/watch-sources.json` 只含咪咕官方搜索模板（`miguvideo` 域名 ×6，无签名参数）；`server/tv-channels.local.json` 已被 `.gitignore` 与打包负向规则排除，从未入库（`git log --diff-filter=A` 无记录）。
- 但历史仍可通过 `raw.githubusercontent.com/<owner>/<repo>/23e47a3/server/scraper.js` 读取（仓库公开）。

**影响**：`userid` + 会话签名属于个人数据；签名可能已过期，但应按「已泄露」处理。

**修复需要改写历史 + force-push（不可逆）**，必须单独确认。可选项：

| 方案 | 效果 | 代价 |
| :-- | :-- | :-- |
| A. `git filter-repo --replace-text` 清洗 `server/scraper.js` 历史 | 历史不可再读 | force-push，所有 clone 需重新拉取 |
| B. 仓库转私有 | 立刻止血，历史仍在 | 失去开源 |
| C. 只轮换上游通道（换掉这批签名源）+ 加 gitleaks | 泄露数据失效，历史仍在 | 最轻，但 userid 仍可见 |

---

## 三、P1

### P1-1 改期超过 1 天的比赛永远查不到，界面误报「上游缺分」

**位置**：[server/scores.js:161](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/server/scores.js:161)、[:393](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/server/scores.js:393)

```js
if (!m.tbd && t + MATCH_DURATION_MS < nowTs && nowTs - t <= 14 * 86400000) {
  add(t - 86400000);
  add(t + 86400000);          // ← 只有 ±1 天
}
```

单场重查同样：`for (const offset of [-86400000, 0, 86400000])`。

**实测**：本地 `FL-9-LOR-BRT` = `2026-11-01T03:45` sched；ESPN `dates=20261102` 返回 `Brest at Lorient, 2026-11-02T19:45Z, Full Time`。查询日期只会落在 `20261030/31` 与 `20261101`，事件在 `20261102` → 永不命中。

口径不一致：匹配窗口 `MATCH_WINDOW_DAYS = 4`、改期保护 `RESCHEDULE_WINDOW_DAYS = 60`，但**查询日期**只开 ±1 天。点「重查该场」也救不回。

**影响**：假「上游缺分」、积分榜/统计/补看队列各缺一场；手机分支同一份逻辑同样中招。直接违背数据诚实承诺。

**建议**：对「仍未有比分」的过去场次做二阶段——先 ±1 天，未匹配再 ±4 天（复用 `MATCH_WINDOW_DAYS`）。只对仍未匹配的场次展开，不要一刀切放大请求量（当前完整同步已 21.5s）。

---

### P1-2 `partial_failure` 时服务端已写盘的补丁被桌面丢弃

**位置**：[src/core/sync-outcome.js:49](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/src/core/sync-outcome.js:49)、[src/App.jsx:421](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/src/App.jsx:421)

```js
// sync-outcome.js
if (changed > 0) return { ok: false, status: 'partial_failure',
                          text: `已更新 ${changed} 场，${errors} 个来源失败` };

// App.jsx
if (!outcome.ok) { if (outcome.httpStatus === 0) lastSyncTriggerRef.current = 0; return; }
if (outcome.payload?.fixtures?.length && setFixtures(...)) bumpDataRev();
else if (outcome.status === 'updated' || outcome.status === 'partial_failure') refreshData();
                                                          // ↑ 永不执行（上面已 return）
```

同一模式还出现在 `SettingsDrawer.jsx:157`、`useDataHealth.js:132`；`useDataHealth.js:61` 只要 `lastSync.errors > 0` 就把顶栏标红「同步失败」。

**影响**：ESPN 成功、openfootball 某一批失败时，服务端已写盘，桌面却既不应用也不刷新，最长等 120s 健康轮询；期间显示「同步失败」+ 旧比分。手机端会应用补丁，但首页文案说「沿用本地数据」，同样自相矛盾。

**建议**：「能否应用补丁」与「是否有来源失败」拆开——`written.ok === true` 就应用 `payload.fixtures`；`partial_failure` 用黄色「已更新 N 场，M 个来源未响应」。顺手删掉那段死分支。

---

### P1-3 用户数据永久遮蔽内置赛程——升级送不到新场次

**位置**：[server/data-store.js:58](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/server/data-store.js:58)

```js
export function activeFixturesPath() {
  const p = userFixturesPath();
  return p && existsSync(p) ? p : BUILT_IN;   // 用户文件存在 → 内置完全不读
}
```

内置 UCL 赛程止于 `2027-01-28`，淘汰赛对阵尚未加入。**已同步过的老用户，即使装了含新对阵的新版本，也看不到这些场次**——用户文件永远覆盖内置文件。手机 `loadStoredFixtures` 同样「有存储就优先」。

**影响**：README 承诺「升级覆盖安装不丢比分」，实际还额外「永久锁住出厂赛程」；新赛季、UCL 淘汰赛、官方更正都送不达。

**建议**：内置为基线，按 `id` 合并——同 id 用用户侧比分/状态/时间覆盖，内置新增 id 追加；写盘保存合并结果；加 `schemaVersion`/`season` 校验。手机同改。

---

### P1-4 播放器会在两个正常路径上被卸载重建

**位置**：[src/components/PlayerStage.jsx:1304](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/src/components/PlayerStage.jsx:1304)

```jsx
{!theaterMode
  ? (stackIntel
      ? <div className="flex w-full flex-col gap-3 xl:flex-row">…</div>   // div
      : <><div …>{VideoScreen}</div>{underVideo}</>)                      // Fragment
  : (<div className="flex w-full flex-col gap-2.5">…</div>)}              // div，少一层 wrapper
```

同一 child 槽位的 type 在 `div ↔ Fragment` 之间变化，且 `VideoScreen` 的树层级不同 → React 卸载整棵子树重建，`<Player>` 随之 destroy → 重连。

两条触发路径都不需要用户犯错：

1. 点「切换为宽屏剧场」（`theaterMode` 翻转）；
2. `stackIntel = finished || (live && !streamUrl)`，而 `matchState` 在开球 **+120 分钟**从 `live` 变 `ended_pending` → **加时赛必然在第 120 分钟黑屏重连一次**。

连带污染：重建让 `Player.jsx:173` 的 `video:playing` 再触发一次 `handleFirstPlay`，同一场真实起播记成 2 次成功，扰动 `line-memory` 成功率；`IntelPanel` 的 tab 状态被重置。

**修法**：三处共用同一个 wrapper `div`，布局只换 className，固定 `VideoScreen` 的树位置。

---

### P1-5 手机例行同步只跑「快检」，940 场 TBD 与未来 48h 永不自动更正

**位置**：[mobile/src/data/sync/useSync.ts:85](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/mobile/src/data/sync/useSync.ts:85)、[scores.js:236](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/mobile/src/data/sync/scores.js:236)

```js
// useSync.ts refresh()（启动 / 回前台 / 下拉都走这里）
outcome = await syncNow({ quick: true });

// scores.js quickSyncTargets
if (m.st !== 'sched' || m.tbd) continue;                    // tbd 全跳过
if (Number.isNaN(t) || t > nowTs || t < floor) continue;    // 未来场次全跳过
```

同文件注释写的是「完整保鲜仍走启动 / 回前台 / 我的-立即同步」——**与实现直接矛盾**。

对照桌面：启动 0.5s 后 + 每 30 分钟跑 `activeSyncTargets`（含未来 48h + tbd ±3 天）。

**影响**：ESPN 公布 TBD 开球时间、或改期，手机没有任何自动路径更新；桌面 30 分钟内就纠正并弹「计划有变」，手机连该组件都没有。当前 `tbd:true` 共 **940 场（49.6%）**。

---

### P1-6 止损提示在浮层 / 切 tab 时被静默消费（双端）

熬夜止损是这个产品唯一的安全阀，但两端的「是否消费」判断都漏了浮层：

**桌面** [src/App.jsx:587](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/src/App.jsx:587)

```js
blocked: !!(settingsOpen || onboardingOpen || splashOpen || updateModalOpen || standingsState),
```

渲染条件（`:1089`）多排除了 `morningDigestOpen`，但两处都**没有 `paletteOpen`**。于是早晨摘要开着 → `blocked=false` → `markStopLossPrompted()` 立刻写终态 → 横幅按渲染条件不渲染 → **提醒永久丢失**。命令面板开着 → 状态被消费、横幅被 `z-modal` 遮住。

**移动** [mobile/src/lib/useStopLoss.ts:104](/Users/lucky/Desktop/HelloWorld/Git_Project/nightowl-web/mobile/src/lib/useStopLoss.ts:104)：压根没有 `blocked` 参数。`WatchSheet` 是原生 `<Modal>`（永远盖在上面），首页传 `enabled = focused`、切 tab 清空 context —— 两种情况都先写了 `PROMPTED`。

---

## 四、P2

| # | 问题 | 位置 | 证据 / 影响 |
| :-- | :-- | :-- | :-- |
| P2-1 | 手机 deadline 截断被伪装成「已是最新」 | `mobile/src/data/sync/sources.js:90`、`scores.js:499` | deadline 到就 `break` 且不记 error；`attempted` 写死 `true` → `up_to_date` 并推进 `lastCheckedAt`。请求按联赛顺序排列，**截断位置稳定**（永远漏 FL/UCL）。下拉提示「暂无比分更新」，实际没查 |
| P2-2 | 单条脏数据打掉整页 | `src/data/index.js:117`、`server/index.js:347` | `setFixtures` 只校验「非空数组」；`/api/fixtures` 原样返回；下游裸 `m.t.split('T')`（`WeekView.jsx:642`、`SettingsDrawer.jsx:197`）。`main.jsx` 只有一个根边界且只能 reload |
| P2-3 | 本地服务无 Host 校验 + 代理可打内网 | `server/index.js:198`、`proxy.js:58`、`index.js:553`、`PlayerStage.jsx:732` | Origin 校验对「无 Origin 的同源 GET」失效 → DNS rebinding 可读 `/api/fixtures`；`isValidHost` 允许 IP 字面量；抓取结果自动授权 + 比赛中自动起播 = **盲 SSRF**。另 `new URL()` 在 `try` 之外，畸形 Host 头可抛未捕获异常（服务与主进程同进程） |
| P2-4 | 「数据落后 N 天」把休赛日误报成过期 | `server/data-store.js:117`、`useDataHealth.js:72` | `staleHours = now - 最后一场已录比分的**开球时间**`，不是同步时间。休赛 4 天 + 刚同步成功 → 显示「数据落后 3 天」；真实数据里面 04:00 开球的场次在 11:10 时 `staleHours=7.2`，实际约 2 小时前才完赛 |
| P2-5 | 单场重查 / 部分成功把所有待录场次标成「已检查」 | `server/index.js:473`、`:636` | 单场重查传**全部** `fixtures`；后台同步只要任一 source `ok>0` 就全量记录。点一场重查，其它场次数据说明也变成「刚检查过」 |
| P2-6 | 设置页相对时间被 useMemo 冻结 | `src/components/SettingsDrawer.jsx:182` | `Date.now()` 不在依赖里（`[lastSync]`）→ 抽屉开着 20 分钟仍显示「刚刚」。数据新鲜度是本产品的核心可信度指标 |
| P2-7 | 赛程页把 940 场 TBD 摊到占位日期并计入表头 | `src/core/owl.js:209` | `counts` 与分组键都直接 `owlDay(m.t)`，无 `tbd` 判断；`ScheduleView.jsx` 全文零处 `tbd`。实测 **136 个日期组中 57 组含 tbd**，与 `week-risk.js:11`「tbd 不归属任何一晚」冲突 |
| P2-8 | 一次播放失败被记成两次 | `src/components/Player.jsx:117` + `:179` | HLS fatal 与 `art.on('error')` 都进 `handlePlayerError`，每次 `rememberLine` + `count += 1` → 提示「已切换（2/2）」实际只切 1 条，预算被一次故障吃掉 |
| P2-9 | `proxy/allow` 的 `200 + {ok:false}` 当成功 | `src/components/PlayerStage.jsx:530` | 只看 fetch 是否 throw。白名单满 50 条时服务端返回 `ok:false` → 前端照常起播 → 代理 403 → 归因为「线路失败」并耗换线额度 |
| P2-10 | 手机两处文案与事实相反 | `match/[id].tsx:819`、`(tabs)/index.tsx:277` | 前者说「可以重查一次」但手机没有重查入口；后者硬编码「沿用本地数据」，而 `partial_failure` 时补丁已落盘 |
| P2-11 | 预算 +1 落到 7，但没有 7 的档位 | `mobile/src/ui/budgetOptions.ts:8`、`plan.tsx:353` | 选项 `[0,1,2,3,4,5,6,8]`，`+1` 从 6 到 7 → 三个选择器全 `selected=false`，用户以为没生效 |
| P2-12 | Electron 33 已过支持期 | `package.json` | 全量 `npm audit` 34 项（**1 critical / 16 high**），`electron <=42.11.15` 标 high，当前 33.4.11。`tar` critical、`vite 8.3.0`、`electron-builder 25.1.8` 均 high。多为构建期，但 **Electron 会被打进应用** |

---

## 五、P3

| # | 位置 | 问题 |
| :-- | :-- | :-- |
| 1 | `src/hooks/useLiveSnapshot.js:40` | `inFlightRef` 是**全局**在途标记，不区分 matchId → 切场时新场首个 `load()` 被吞，最长得等 30s 轮询 |
| 2 | `src/hooks/useFixturesRefresh.js:23` | 在途 promise 被复用：「立即同步」完成后 `onDataRefresh()` 可能复用到同步**前**的请求，把旧数据写回内存，最长 120s 自愈 |
| 3 | `src/components/PlayerStage.jsx:736` | `/api/live-sources` 失败只 `console.warn`；空态归因「源站推流可能受限」，与设置页「本地服务未启动」双口径 |
| 4 | `src/components/PlayerStage.jsx:750` | 无 `tbd` 分支：940 场待定比赛走 live 分支显示「暂未检索到可用线路」，并真带占位时间去抓源 |
| 5 | `electron/main.cjs:244` | `will-navigate` 未限制协议就 `shell.openExternal`；同文件 `win:open-external` 有 `^https?://` 白名单，两处不一致 |
| 6 | `server/rules.json` | `requestDelayMs` / `maxConcurrentLeagues` 仍未读取（`timeoutMs` 已透传） |
| 7 | `mobile/src/data/sync/espn.js:11` | JSON import 缺 `with { type: 'json' }` → Node 里 import 报 `ERR_IMPORT_ATTRIBUTE_MISSING`，想补行为测试得先改这行 |
| 8 | `mobile/src/app/(tabs)/me.tsx:65` vs `SettingsDrawer.jsx:396` | 补看队列排序口径不同：手机按加入时间、桌面按开球时间 |
| 9 | `src/App.jsx:1126` | `SettingsDrawer` 关闭时不卸载（其他四个弹窗都有 `if (!open) return null`），关着也每 30s 跑 `queueWithMatches` |
| 10 | `mobile/src/ui/Chip.tsx:70` | `hitSlop={6}` 四周外扩，chips 行距 8 → 相邻 chip 命中区重叠 4dp |
| 11 | `mobile/src/lib/usePrematchReminders.ts:80` | 调了 `getLastNotificationResponseAsync()` 但从不 `clearLastNotificationResponse()` |
| 12 | `server/index.js:84` | 静态资源无缓存策略（`index.html` 应 no-cache、hashed assets 应 immutable） |
| 13 | `mobile/src/app/_layout.tsx:31`、`data/fixtures.ts:51` | 2.5s 超时后加载存储 fixtures 只 `setMeta` 不 `bump` → 慢设备短暂显示内置快照 |
| 14 | `mobile/src/components/StopLossBanner.tsx:57` | 「继续看」未带「今晚不再提醒」（无障碍文案有、视觉文案没有） |
| 15 | `src/components/SettingsDrawer.jsx:797` | `Switch` 未接 `describedBy` 指向 `Hint`（`Hint` 是 tooltip 而非屏读文本，故定 P3） |

---

## 六、门禁质量（比缺测试更值得警惕）

### G1 有一条断言方向写反，靠样本恰好不含 tbd 而绿

`tools/test-owl.mjs:98`：

```js
ok('★ upcoming 组不含已结束/进行中/待定场次',
   g.upcoming.every(m => !m.tbd && !isEnded(m) && !['done','finished','live'].includes(stateOf(m, NOW))));
```

实现是「tbd 归 upcoming」，同文件 `:121` 的合成切片断言要求的正是这个。两条断言互相矛盾却同时通过——只因 `NOW = 09-13 12:00` 那晚切片里没有 tbd，是空断言。

实测：`2027-03-15T02:30` → upcoming 20 场**全部**是 tbd；`2026-10-26T02:30` → 12 场里 10 场是 tbd。

### G2 改期窗口的测试只覆盖 ±1 天

`tools/test-scores.mjs:163` 只断言 `has('20260913') && has('20260915')`，**不断言 size**。所以它不是「阻碍修复的固化测试」（扩窗后仍会过），而是**缺一条「实际日期晚 2 天」的用例**——这正是 P1-1 能活到现在的原因。

### G3 手机端零行为测试

`mobile` 的 `check` = `verify:shared + verify:pipeline + audit:touch + typecheck`；无 jest/vitest、无 lint、不跑 `export:android`。`tools/` 下 40+ 测试**零处**引用 `mobile/src`。P1-5、P2-1、P2-10、P2-11 全在这个盲区里。

### G4 `verify:pipeline` 是变更检测器，不是等价性校验

manifest 已把当前漂移写进去（`attempted` 恒真、`deadlineMs`、`quick` 分支），`--write` 一次即洗白。它解决「差异不可见」，没解决「差异是否正确」。编排层 `useSync.ts` / `run.ts` 不在 PAIRS。

### G5 `pretypecheck` 会重写生成物

`npm run check` 最后一步前会跑 `sync:shared + sync:crests + verify:pipeline`，其中 `crests` 没有对应的 verify —— 「桌面加了队徽没提交」不会让 check 失败，只让工作区变脏。

---

## 七、优化批次计划

按「风险低 × 收益高」排序。每批可独立验证、独立提交。

### 批次 1 · 正确性修复（纯逻辑，无 UI 变更，风险最低）

1. `test-owl.mjs:98` 反向断言 + 换成含 tbd 的样本（**先改测试再看实现**）
2. `App.jsx:421` 拆「能否应用补丁」与「来源失败」；删死分支；`partial_failure` 用黄色
3. `recordPendingChecks` 作用域：单场重查只记该场；后台按「目标全部成功」决定
4. `freshness` 的 `staleHours` 改用同步时间；`lastScoreAt` 用「开球 + 120min」
5. `proxy/allow` 检查 `body.ok`

**门禁**：`test:all` + 新增 fake-fetch partial 用例

### 批次 2 · 数据窗口与合并（改动集中，需真实数据验证）

6. 同步查询窗口二阶段扩展（先 ±1，未匹配再 ±4），单场重查同改，手机分支同步
7. 内置 + 用户数据按 id 合并 + `schemaVersion`
8. 补「实际日期晚 2 天」集成回归（用 FL-9-LOR-BRT 的真实数据作 fixture）

**门禁**：`test:all` + `verify:pipeline --write`（人工确认等价）+ `test:online`

### 批次 3 · 播放器与止损（UI 行为，需 render 冒烟）

9. `PlayerStage` 三布局共用 wrapper（修 P1-4）
10. 播放器错误去重（P2-8）
11. 止损 `blocked` 补全 + `blocked` 时不消费（双端）
12. `PlayerStage` 补 `tbd` 分支；`/api/live-sources` 失败复用「本地服务未连接」

**门禁**：`check:render`（新增剧场切换不断流的断言）+ `check:layout` + mobile check

### 批次 4 · 手机同步与文案（触达真实用户）

13. 启动/回前台至少每日一次完整同步
14. deadline 截断返回 `truncated`，不推进 `lastCheckedAt`；`attempted` 改回 `requests>0`
15. 三处文案对齐事实；预算 +1 落到合法档位

**门禁**：mobile `check` + 首次引入 Node 侧行为测试（需先修 G3 的 JSON import）

### 批次 5 · 加固（可并行）

16. Host 白名单（用 `server.address().port`）+ 代理拒私网/回环/链路本地
17. `will-navigate` 协议白名单
18. `setFixtures` / `/api/fixtures` 最小结构校验
19. 静态资源缓存头
20. `requestDelayMs` / `maxConcurrentLeagues` 接线 或 从 rules.json 删除

### 独立轨道 · 需要你拍板

- **P0-1 历史清洗**：force-push，不可逆。三个方案（清洗 / 转私有 / 只轮换上游）见第二章。
- **P2-12 依赖升级**：Electron 33 → 受支持 major，会牵动 render 冒烟与打包，建议单独一批并留出回归时间。
- **P1-2（上一轮）DEFER 命中率**：属产品口径，不建议靠放松阈值。

---

## 八、环境说明（非项目缺陷）

在 WorkBuddy 沙箱内 `npm run build` 会失败于 `vite:prepare-out-dir` → `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`（清空 `dist/crests` 115 文件 > 阈值 50）。换 `--outDir /tmp/...` 构建正常（2.98s）。普通终端与 CI 不受影响。

## 九、合规提示

`server/scraper.js` 是对第三方聚合站房间载荷的解析（无鉴权绕过、无签名逆向），`tv-channels.local.json` 为个人自用签名频道。README 的「不抓取、不代理官方内容」只在回放/集锦层成立。建议在 README / 设置页明确「直播聚合源仅个人自用、可关闭」，并确保公开构建绝不携带 `*.local.json`（当前打包负向规则已覆盖）。
