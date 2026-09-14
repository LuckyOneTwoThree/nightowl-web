# 开发文档

面向要改这个项目的人（包括未来的自己）。README 讲「是什么」，这里讲「怎么改、怎么验、怎么发」。

---

## 环境要求

| 项 | 版本 | 说明 |
| :--- | :--- | :--- |
| Node | ≥ 20 | 开发环境（本项目在 mac 上开发，CI 在 Windows 上打包） |
| npm | ≥ 10 | 依赖安装与脚本执行 |
| Python | ≥ 3.9 | 仅图标生成脚本用到（Pillow） |

> **开发环境是 mac、分发目标是 Windows** —— 这个错位是本项目很多工程决策的起点（见「验证阶梯」）。

---

## 命令一览

```bash
npm run dev            # 开发模式：Vite 5173，/api 代理到 3100
npm run build          # 生产构建到 dist/
npm run server         # 只跑本地服务（:3100，只监听 127.0.0.1）
npm run electron:dev   # 桌面外壳 + 开发模式
npm run test:all       # 串行跑全部 13 个测试脚本（提交前必跑）
npm run verify:algo    # 算法回归（与原版的偏差比对）
```

### 单点命令

```bash
npm run test:owl           # 应用层视图模型（今晚/本周/赛程/分区/推荐）
npm run test:stats         # 真实数据统计（近况/攻防/交锋）
npm run test:scraper-match # 直播源队名匹配（离线，含错配回归）
npm run check:scraper      # 直播源抓取实测（联网，含 P0 误配回归）
npm run test:sources       # 数据源健康度（联网）
```

---

## 测试体系

**13 个脚本、271 项断言**，`npm run test:all` 串行执行。它们不是形式化的覆盖率，而是每一条都对应过一次真实事故或一条不能破的纪律：

| 脚本 | 项数 | 守住什么 |
| :--- | ---: | :--- |
| `test:owl` | 46 | 视图模型不变量：分区不丢不重、推荐排除自身、只看未来、排序口径 |
| `test:m3u8` | 31 | M3U8 十类载体的 URI 重写完整性 |
| `test:session` | 27 | 代理会话授权与回收（TTL / revoke 幂等） |
| `test:proxy` | 26 | 白名单拒绝、并发闸门、失败语义 |
| `test:media` | 24 | 媒体类型判定（显式 `kind`，不靠 URL 嗅探） |
| `test:scraper-match` | 22 | 直播源匹配：**只做双方全等，禁止单队兜底** |
| `test:scores` | 19 | 保鲜折算：只写三值状态、比分不全不落库 |
| `test:stats` | 19 | 统计口径：不含本场与未来场次（防剧透） |
| `test:playback` | 18 | 播放链路参数完整性 |
| `test:proxy-timeout` | 13 | 三层超时（响应头 / 流静默 / 排队） |
| `test:team-alias` | 11 | 队名别名一致性与覆盖率 |
| `check:sources` | 8 | 数据源健康度（联网） |
| `check:scraper` | 7 | 抓取实测 + **P0 误配零容忍回归**（联网） |

### 写测试时的两条纪律

1. **断言里不要硬编码场次 ID** —— 数据会被保鲜模块更新，硬编码的样本迟早失效（用动态选样）
2. **匹配函数必须被测试直接调用** —— 曾出现过 `check-scraper` 自己重写了一遍匹配逻辑，结构上不可能发现匹配本身的缺陷

---

## 数据保鲜

### 应用内（推荐）

服务端在启动 3 秒后自动跑一次，之后每 30 分钟按需检查。只有确实存在「已结束但无比分」的场次时才真正拉取；无写权限环境（纯预览）自动跳过。

```bash
# 手动触发（预览不写盘）
curl -X POST http://127.0.0.1:3100/api/scores/sync

# 落盘
curl -X POST -H 'Content-Type: application/json' \
     -d '{"apply":true}' http://127.0.0.1:3100/api/scores/sync

# 数据新鲜度
curl http://127.0.0.1:3100/api/scores/status
```

### 命令行

```bash
node tools/sync-scores.mjs            # 预演（不写盘）
node tools/sync-scores.mjs --apply    # 写入内置快照（发版前的数据更新）
```

### 数据落点（重要）

| 落点 | 路径 | 用途 |
| :--- | :--- | :--- |
| 内置快照 | `src/data/fixtures.json` | 出厂数据，随包分发（只读） |
| 用户数据 | `NIGHTOWL_USER_DATA/fixtures.json` | 运行时保鲜写入（桌面端为 `app.getPath('userData')`；未注入时回落 `server/cache/user-data`，已 gitignore） |

读取优先级：用户数据 > 内置快照。**前端通过 `/api/fixtures` 热替换内存数据**，同步完成后无需重启。

> ⚠️ 新增依赖数据源的模块时，记得走 `src/data/index.js` 的 `getFixtures()`，不要直接 `import fixtures.json` —— 否则会锁在构建期快照上（曾因此出现「左栏有比分、右栏说等待录入」的自相矛盾）。

---

## 队名别名的维护

直播源与比分源都靠别名表把第三方缩写映射到本项目球队 id。

```
server/espn-alias.json          # ESPN 缩写 → 球队 id（按联赛分组 byLeague）
server/openfootball-alias.json  # openfootball 全称 → id（显式 37 条，禁止包含匹配）
server/scraper-alias.json       # 聚合站队名补充（只放机器推不出的写法）
```

**纪律**：

- **别按联赛分组维护** —— 同一缩写在联赛间含义不同：ESPN 的 `MUN` 在英超是曼联、在德甲是拜仁（`FCB`）；`PAR` 是巴黎FC。必须按 `byLeague[league][abbr]` 精确匹配，**不要合并成全局映射**
- **宁漏勿错** —— 补别名前先确认真实含义（拉一次源数据核对 displayName），猜错比缺失危险得多

```bash
npm run check:scraper    # 看当前匹配率与未匹配清单，据此补别名
npm run test:alias       # 别名一致性与覆盖率
```

---

## 打包与发布

### 本地打包自检（改完必做）

```bash
npx electron-builder --win --dir --publish never
node tools/verify-package.mjs release/win-arm64-unpacked/resources/app
```

自检做两件事：扫描产物内 `server/` 与 `electron/` 的**相对 import 是否都可解析**、断言关键运行时文件（`src/core`、`src/data`、`dist`）与打包输入（`build/icon.ico`）存在。

> 这两个检查各自抓到过真问题：一次是 `package.json` 的 `files` 漏了 `src/core`（安装版启动即报 `ERR_MODULE_NOT_FOUND`），一次是自检自己把打包输入写进了产物断言。

### 发布

```bash
git tag v0.1.x && git push origin v0.1.x
```

CI（`.github/workflows/build-windows.yml`）会自动：跑全量测试 → 打包 NSIS → 产物自检 → 发布 GitHub Release（安装包 + `latest.yml` + `.blockmap`）。

**注意两点**：

1. 打包步骤必须保留 `--publish never`，发布职责归 `softprops/action-gh-release`；否则 electron-builder 会凭 `package.json` 的 `publish` 配置再发一次，形成双重发布
2. `latest.yml` 与 `blockmap` 是应用内自动更新（electron-updater）的必需产物，`--publish never` 下照常生成，务必随 Release 一起上传

---

## 「验证阶梯」——本项目的核心经验

因为**开发在 mac、运行在 Windows**，任何只在本地看现象的做法都会漏 bug。实际踩过的问题按层级分布：

| 层级 | 抓到过什么 |
| :--- | :--- |
| 工作区验证（`npm run dev`） | 静置 CPU 占用、字体阻塞渲染 |
| 构建与产物验证 | `files` 漏 `src/core`、Windows 保留设备名 `AUX.png` |
| 真实 Windows CI | 打包输入写进产物断言、默认图标未生效 |
| 用户真机 | 端口回退、安装版模块缺失 |

**结论**：每引入一层新的验证环境，都会翻出上一层看不见的问题。改动涉及打包 / 外壳 / 依赖时，至少走到「产物验证」这一层再提交。

---

## 调试技巧

```bash
# 用 CDP 直连无头浏览器验证真实渲染（无需 GUI）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9222 --user-data-dir=/tmp/chrome about:blank
```

两个易踩的坑：

- **必须带 `--disable-gpu`**，否则 GPU 进程崩溃直接退出（表现为「CDP 端口不通」）
- **`localStorage` 要在同源页面里写** —— 在 `about:blank` 上写对站点无效，首次引导弹窗会一直挡着

```bash
# 跳过首次引导 + 关注一支球队（用于截图验证）
localStorage.setItem('onboardingDone','1');
localStorage.setItem('followedTeams','["ARS"]');
localStorage.setItem('spoilerFree','false');   // 关防剧透看比分
```
