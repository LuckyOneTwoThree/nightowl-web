# 夜猫看台 · Android 客户端

把桌面端的观赛决策工作台压缩成一部手机：**赛前 3 秒做决定，赛后 10 秒看结果**。

同一套夜猫指数、睡眠成本分档与背包规划，四 Tab（今晚 / 赛程 / 规划 / 我的）+ 比赛详情 + 球队页 + 全局搜索；支持离线赛程、比分保鲜、实时比分、原生 HLS 播放、PiP、防剧透与赛前本地提醒。

> 桌面端（Windows / Electron）见[仓库根目录 README](../README.md)。本目录只包含 Android 客户端。

- **平台**：Android（`arm64-v8a`），未上架应用商店，通过 EAS 内测 APK 侧载
- **技术栈**：Expo SDK 58 · React Native 0.88 · React 19 · Expo Router · TypeScript
- **定位**：个人自用与技术研究；不提供后端、不做远程代理、不托管任何视频

---

## 功能

| 模块 | 能力 |
| :--- | :--- |
| **今晚** | 唯一推荐 + 推荐理由；进行中置顶；已结束默认折叠；防剧透 |
| **赛程** | 固定日期条 + 全季视图；联赛筛选；粘性日期分组；开球时间 / 状态 |
| **规划** | 周视图、睡眠预算、背包最优组合、雷区与替代场次 |
| **比赛详情** | 决策情报（熬夜代价 / 指数归因）与数据视角（近 5 场 / 赛季攻防 / 交锋）；实时比分与关键事件；分享；赛前提醒 |
| **观看** | 原生 HLS 直链播放、线路切换、断流自动换线、PiP、横屏；官方平台入口；官方集锦 |
| **球队页** | 关注球队、下一场、近期状态、赛季数据、未来与近期赛程 |
| **我的** | 关注球队 / 联赛、每周预算、防剧透、通知权限与测试、实时事件开关、数据同步状态 |
| **搜索** | 球队与比赛统一搜索 |
| **离线优先** | 内置全量赛程快照；本地持久化；启动与回前台按需增量同步 |

### 与桌面端的差异

| 能力 | Windows 桌面 | Android 手机 |
| :--- | :--- | :--- |
| 决策算法 | 唯一权威实现 | 构建时同步同一份纯函数 core，不 fork |
| 直播播放 | 本机 `127.0.0.1` 代理 + 内联播放器 | 原生播放器**直连** HLS，不做代理 |
| 直播源 | 抓取 + 本地代理 + 保底频道 | 只抓取公开直链；**不内置任何签名频道** |
| 通知 | 赛前 + 进球 / 红牌 / 终场 | 仅赛前 15 分钟本地提醒（APK） |
| 集锦 / 回放 | 官方链接 + 系统浏览器 | 相同，不代理、不下载 |
| 命令面板 / 多栏 | 支持 | 无，改为四 Tab + 搜索 |
| 平台范围 | Windows x64 | Android arm64 |

---

## 环境要求

| 项 | 要求 |
| :--- | :--- |
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| 真机 | Android，`arm64-v8a` |
| Expo 账号 | 仅云构建（EAS）需要；本地 `expo start` 不需要 |
| Android Studio / Java | **不需要**，正式 APK 走 EAS 云构建 |

> 当前开发机没有 Android SDK，Android 原生能力（通知、PiP、明文 HTTP、HLS）以 EAS 构建出的 APK 在真机上验收。Expo Go 只用于 UI 与数据预览。

---

## 快速开始

```bash
cd mobile
npm install
npm start
```

`prestart` 会自动执行共享层与队徽同步。启动后可以用 Expo Go 扫码预览页面与数据，但**通知、PiP 等原生能力必须用开发版或预览版 APK 验证**。

### 提交前检查

```bash
npm run verify:shared    # 桌面端 core/data 与 mobile 生成副本是否一致
npm run typecheck        # TypeScript
npm run export:android   # 生成 Android JS bundle（不是 APK，用于验证打包阶段）
```

---

## 构建 APK

先登录 Expo 账号（只有首次需要）：

```bash
cd mobile
npx eas-cli@latest login
```

### 内测 APK（推荐）

```bash
npm run eas:preview
```

- `preview` profile：内部分发、`apk`、`arm64-v8a`
- 构建完成后 EAS 会给出下载链接，可直接在 Android 真机安装
- 通知开关通过 `EXPO_PUBLIC_NOTIFICATIONS_ENABLED=1` 在构建期打开（见 `eas.json`）

### 开发版（需要 Metro）

```bash
npm run eas:dev
# 安装开发版 APK 后：
npx expo start --dev-client
```

> `app.json` 里的 `extra.eas.projectId` 与 `owner` 指向本项目。Fork 后请执行 `npx eas-cli@latest init` 换成自己的 EAS 项目，否则无法构建。
>
> EAS 管理的签名密钥保存在云端，不要提交任何 `.jks` / `.keystore` / 证书文件。

---

## 共享算法层（重要）

手机端不复制算法，也不允许手改生成文件。以下路径均由桌面端生成：

```
src/shared/core/        ← ../src/core
src/shared/data/        ← ../src/data
src/shared/server/      ← ../server/{espn,openfootball,scraper,highlights}-alias.json
                          ../server/{watch-sources,rules}.json
src/data/sync/tz.js     ← ../server/sources/tz.mjs
assets/crests/          ← ../public/crests
src/data/crests.ts      ← 由队徽目录生成
```

```bash
npm run sync:shared     # 重新生成 core / data / server / tz
npm run sync:crests     # 重新生成队徽与 require 映射
npm run verify:shared   # 漂移检查；不一致时 CI / 提交前必须失败
```

**改动顺序**：先改桌面端 `src/core` / `src/data` / `server/*.json`，再同步到手机端；不要在 `mobile/src/shared` 里直接改。`prestart`、`pretypecheck`、`preexport:android` 会自动跑同步。

路径别名：

- `@core/*` → `src/shared/core/*`
- `@data/*` → `src/shared/data/*`
- `@/*` → `src/*`

---

## 数据与离线策略

- **内置快照**：赛程与球队数据随包分发，首次启动无需联网
- **本地持久化**：用户数据写入应用文档目录 `nightowl-fixtures.json` + `nightowl-meta.json`；损坏或数量异常时回退内置快照
- **比分保鲜**：ESPN 主源 + openfootball 副源；只写入通过校验的比分补丁，写盘失败不会冒充「已是最新」
- **同步时机**：启动后延迟同步一次；回前台且距上次检查超过 10 分钟再检查
- **实时比分**：进行中比赛每 30 秒拉取 ESPN 比分、分钟与进球 / 红黄牌；页面不可见时暂停
- **集锦**：TheSportsDB 元数据只索引**官方 YouTube** 视频，用系统浏览器打开；没有索引时回退官方平台搜索深链

手机端**不包含**桌面端的本地流代理、签名保底频道与远程服务。`TV_SPORTS_CHANNELS` 固定为空数组。

---

## 通知

- 仅**本地**赛前 15 分钟提醒：今日推荐 + 关注球队未来 7 天内的比赛，最多 30 条
- 通知由系统排程，不依赖后端；App 被杀后仍会触发（受 Android 省电策略影响）
- 点击通知通过 `matchId` 深链回到比赛详情
- 在「我的 → 测试通知（10 秒）」验证权限、通道与系统弹窗
- 通知文案**不含比分**，避免破坏防剧透

构建期门禁：

```ts
process.env.EXPO_PUBLIC_NOTIFICATIONS_ENABLED === '1' &&
Constants.executionEnvironment !== 'storeClient'
```

`expo-notifications` 采用动态导入，Expo Go 不会加载该原生模块；因此 Expo Go 里通知入口会降级，正式验证请安装 EAS 的 development / preview APK。

Android 侧建议为应用关闭电池优化，并允许「闹钟和提醒」权限；否则精确提醒可能被系统延后。

---

## 播放器与直链

- `expo-video` 原生播放 HLS，自定义 `User-Agent`；不经过任何中转服务
- 只展示 `isDirect` 且格式受支持的线路；线路面板可手动切换
- 播放器收到致命错误时按 `autoSwitchDecision` 自动尝试下一条线路，最多 2 次
- 支持画中画（PiP）、全屏与横屏；播放期间保持屏幕常亮
- 第三方直链随时可能失效；失败时回退官方平台入口或集锦，不下载、不转码、不录制
- `app.json` 开启 `usesCleartextTraffic`，用于兼容仍使用 HTTP 的第三方流；这不是对内容可用性的承诺

---

## 目录结构

```
mobile/
  src/app/          Expo Router 路由
    (tabs)/         今晚 / 赛程 / 规划 / 我的
    match/[id]      比赛详情（情报 / 数据 / 观看）
    team/[id]       球队页
    player          原生 HLS 播放器
    search          全局搜索
    team-picker     关注球队选择
    onboarding      首次引导
  src/components/   WatchSheet / TeamPicker / LiveTimeline
  src/data/         赛程持久化、ESPN/openfootball 同步、实时比分、集锦、直链抓取
  src/lib/          通知调度与提醒同步
  src/shared/       由桌面端生成的 core / data / server（禁止手改）
  src/state/        Zustand：偏好 / 播放会话 / 同步状态
  src/ui/           设计系统与基础组件
  scripts/          sync-shared / verify-shared / sync-crests
  assets/brand/     应用图标与开屏品牌图
  assets/crests/    111 支队徽（由 public/crests 同步）
```

---

## 真机验收清单

发版前至少完整走一遍：

- [ ] 首次引导 → 选择球队 → 四个 Tab 正常
- [ ] 赛程页日期条不塌陷，全季列表可滚动，联赛筛选生效
- [ ] 比赛详情：赛前 / 进行中 / 已结束三种状态的操作区不重复
- [ ] 防剧透开启时比分与集锦入口被遮挡，可主动揭晓
- [ ] 进行中比赛实时比分、分钟与事件更新；离开页面后停止轮询
- [ ] 直链播放、线路切换、断流自动换线、PiP、横屏返回后恢复竖屏
- [ ] 通知权限、测试通知、赛前提醒、点击通知回到正确比赛
- [ ] 顶部安全区、底部手势条不遮挡内容
- [ ] 断网启动仍可浏览内置赛程；恢复网络后同步正常

---

## 常见问题

**Expo Go 启动报 `Cannot find native module 'ExpoTopicSubscriptionModule'`**

Expo Go 的原生模块版本可能落后于 SDK 58。请安装 EAS 构建的 development / preview APK，或使用与 SDK 58 匹配的 Expo Go 版本。

**「我的」里测试通知没有反应**

先确认安装的是 EAS APK（不是 Expo Go），再检查系统通知权限、通知渠道、精确闹钟与电池优化；部分国产 ROM 需要单独允许自启动 / 后台运行。

**直链能抓到但播放失败**

常见原因是上游 UA 校验、链过期或 HTTP 被系统策略拦截。先换线路；仍失败就使用官方入口。App 不会为了「能播」而代理或下载视频。

**`verify:shared` 报 drift**

桌面端 core/data 已变更而手机端副本未更新：

```bash
npm run sync:shared
```

**`npm install` 报 peer dependency 冲突**

仓库内 `mobile/.npmrc` 已设置 `legacy-peer-deps=true`；请确认在 `mobile/` 目录安装。

---

## 边界与合规

- 仅用于**个人学习与技术研究**，遵守所在地区法律法规及各内容平台用户协议
- 不提供、不托管、不存储、不转码任何直播或点播视频；不绕过任何技术保护措施
- 直播直链来自第三方公开索引，可用性与合法性由来源方负责；App 只做本机直连播放
- 集锦与回放只跳转官方平台 / 官方 YouTube 频道，由系统浏览器打开
- 不内置个人签名频道、账号 Cookie 或任何密钥；`server/tv-channels.local.json` 不会进入移动端
- 比赛数据、球队名称与队徽版权归各自权利人所有
