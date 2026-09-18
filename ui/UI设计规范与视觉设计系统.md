# 夜猫看台 · 桌面端 UI 设计规范与视觉设计系统（Design System）

> **适用范围**：夜猫看台桌面工作台（Owl Match Station）
> **适配目标**：1440×900 / 1920×1080 桌面宽屏（PC / Mac）
> **设计哲学**：**深夜极客 · 墨黑沉浸 · 极高信息密度 · 真实数据可达 · 零眩光护眼**

---

## 一、产品核心页面架构（三大主视图 + 一个全局抽屉）

拒绝将所有功能强行缝合在单页内。桌面工作台采用 **顶栏 Tab 切换三大主心智**（**本章于 2026-09-12 修订**：Tab 由左栏上移至顶栏，作为唯一导航入口；删除左栏重复 Tab 与 56px 左侧图标 rail），右栏 62% 作为常驻的观赛大屏与战术情报中枢：

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Top Bar 顶栏] 52px (macOS pl-20 避让): Logo + [🌙 今晚 | 📊 本周 | 📅 赛程] + 北京时间 + 关注球队 + [⚙ 偏好设置]                     │
├───────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┤
│ 【左栏 38% 决策与列表区】 (min-w-[420px], max-w-[520px]) │ 【右栏 62% 沉浸观赛大屏与情报区】 (flex-1)                      │
│                                                       │                                                              │
│ ┌─ [筛选 / 搜索 / 排序]  │ 1. [大屏播放容器 (16:9 比例)]                                │
│ │                                                     │    • 主选：极清 ArtPlayer (1080p)                      │
│ │ 模式 A (今晚 Tonight):                              │    • 兜底：沙箱内嵌 Webview (去广告拦截)                    │
│ │   • 今晚唯一焦点 Hero 卡 (大)                       │    • 赛前/休赛：开球倒计时与赛前情报                      │
│ │   • 今晚比赛切片 (仅当晚 3~6 场，清爽直出)           │                                                              │
│ │                                                     │ 2. [多线路快速切换台 (Stream Switcher)]                       │
│ │ 模式 B (本周 Week):                                 │    • [线路1 咪咕原画] [线路2 官方高清] [线路3 英文原声]       │
│ │   • 本周睡眠预算调节滑块 (0~8.0h)                   │    • [线路4 备用内嵌] [↗ 直达原站]                          │
│ │   • 0-1 背包 DP 最优组合 + 零成本顺带分区                    │                                                              │
│ │   • 本周跨联赛焦点战 Top 5 + 雷区避坑榜             │ 3. [真实数据情报板 (Match Intelligence)]                     │
│ │                                                     │    • 🌙 S0-S4 睡眠损耗量化与档位提示                         │
│ │ 模式 C (赛程 Schedule):                             │    • ⚔️ 经典德比背景 (`rivalries.json`)                      │
│ │   • 七大联赛药丸筛选 + 主队筛选 + 防剧透            │    • 🌟 连续剧故事线看点 (`storylines.json`)                 │
│ │   • 全季 1,897 场日历虚拟滚动长列表 (空间 100% 释放)  │    • 🏷️ 赛季身份标签 (`teams.tag`)                    │
└─┴─────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┘
```

---

## 二、色彩系统（Design Tokens）

深夜关灯场景下，UI 建立在 **深空墨黑、暗曜石、琥珀金、单一连续睡眠色阶与语义状态色** 的层级体系上。
代码唯一事实来源：`src/index.css`（定义色值）与 `tailwind.config.js`（暴露工具类）。

### 2.1 背景与表面层级（Elevation Surfaces）

| Token 名 | 色值 (HEX) | Tailwind 类 | 语义说明 |
| :--- | :--- | :--- | :--- |
| `bg-app` | `#0b0e15` | `bg-app` | 全局视窗最底层底色（深空墨黑，吸光护眼） |
| `surface-panel` | `#0f131d` | `bg-surface-panel` | 侧栏底色、顶栏背景、大型容器基底 |
| `surface-card` | `#131825` | `bg-surface-card` | 标准卡片底色（列表项、Hero 卡、情报面板） |
| `surface-raised` | `#181f30` | `bg-surface-raised` | 悬停态、选中态高亮层、浮层内容底色 |
| `surface-press` | `#1f283d` | `bg-surface-press` | 按钮与可点击条目按下态 |
| `surface-accent` | `#1f1a10` | `bg-surface-accent` | 品牌金微暗背景容器（胶囊、选中药丸、高亮底） |
| `stage-bg` | `#07090e` | `bg-stage-bg` | 观赛大屏与播放器深邃视窗底色 |

### 2.2 描边与文本层级

| Token 名 | 色值 (HEX/RGBA) | Tailwind 类 | 语义说明 |
| :--- | :--- | :--- | :--- |
| `line-hairline` | `rgba(255, 255, 255, 0.06)` | `border-line-hairline` | 1px 极细分界线，用于大区隔与卡片边缘 |
| `line-control` | `rgba(255, 255, 255, 0.12)` | `border-line-control` | 控件描边、按钮边界、强分割线 |
| `text-primary` | `#edf1f7` | `text-text-primary` | 主标题、队名、关键比分、最高层级文字 |
| `text-secondary` | `#bfc8d6` | `text-text-secondary` | 正文、主要看点、常规可读文字 |
| `text-muted` | `#7d8899` | `text-text-muted` | 次要说明、开球时刻、辅助元信息 |
| `text-faint` | `#7c8798` | `text-text-faint` | 弱提示文字（在 `#0b0e15` 上对比度达 5.03:1，通过 WCAG AA） |

### 2.3 品牌与语义状态色（Brand & Status Colors）

> [!CAUTION]
> **各司其职，严禁混用**：
> 1. `accent`（琥珀金）是全站唯一品牌色，只用于当屏最高优先级行动点与核心指数，严禁当装饰条到处涂刷；
> 2. `live` 独占进行中红点与分钟数；
> 3. `resource` 独占睡眠预算与额度；
> 4. `warn`/`danger` 为系统级异常（延期/起播失败/雷区），**严禁用于睡眠档位**！

| Token 名 | 色值 (HEX) | Tailwind 类 | 语义说明 |
| :--- | :--- | :--- | :--- |
| `accent` | `#f5b942` | `text-accent`, `bg-accent` | **品牌主色·琥珀金**：今晚之选高光、夜猫指数、核心 CTA |
| `accent-ink` | `#1A1204` | `text-accent-ink` | 品牌金按钮之上的高对比度反色字 |
| `live` | `#e2564f` | `text-live`, `bg-live` | **直播进行中**：实时红点（LiveDot）、进行中分钟数 |
| `resource` | `#45bfae` | `text-resource`, `bg-resource` | **睡眠预算额度**：周视图预算条与额度占用专用色 |
| `warn` | `#e0a82e` | `text-warn`, `bg-warn` | **系统警告**：德比对决弱警示、聚合源延迟 |
| `danger` | `#e0483c` | `text-danger`, `bg-danger` | **系统危险/错误**：比赛延期、起播失败、熬夜重度代价预警 |

---

## 三、睡眠成本 S0~S4 连续色阶体系（独占 SleepBadge）

睡眠档位采用从“零代价”到“高代价”的单向连续色阶，彻底解绑此前互不相干的散乱色系。

| 档位 | 标签 | 成本 | 颜色 Token | 色值 (HEX) | 适用开球时间（北京时间） |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **S0** | `S0 零成本` | 0.0h | `tier-0` | `#35a06f` | 白天至 22:30 之前 |
| **S1** | `S1 轻度` | 1.0h | `tier-1` | `#6bb37a` | 22:30–00:30 |
| **S2** | `S2 黄金修仙` | 2.5h | `tier-2` | `#d4a028` | 00:30–02:30 黄金档 |
| **S3** | `S3 重度` | 3.5h | `tier-3` | `#e88a3a` | 02:30–04:00 深夜死线档 |
| **S4** | `S4 极限` | 4.5h | `tier-4` | `#c83d32` | 04:00–07:00 黎明档 |

> [!IMPORTANT]
> **设计纪律铁律**：
> - 睡眠档位视觉**独占 `SleepBadge` 组件**，禁止使用 `Chip` 表达睡眠档位；
> - `Chip(tone="warn"|"danger")` 仅用于表达系统级非正常状态。

---

## 四、macOS 桌面避让与无滚动条约束

1. **macOS 交通灯安全区**：
   - 顶栏左侧设置 `pl-20`（约 80px），避让系统红黄绿关闭/最小化按钮；
   - 顶栏增加 `-webkit-app-region: drag`，内部按钮声明 `no-drag`；
2. **严禁外层滚动条与零 CLS**：
   - `html, body` 声明 `h-screen w-screen overflow-hidden`；
   - 主舞台高度在赛前态与开播态之间严格等高（基准 `aspectRatio: 16/9` 与 `maxH` 恒定），杜绝起播跳动；
   - 列表长内容在容器内局部滚动并应用细滚动条（`scrollbar-thin`）。

---

## 五、真实数据可达性铁律（严禁愿望字段）

UI 界面中展示的数据**必须 100% 存在于本地数据层与算法输出中**：
- ✅ **允许展示**：
  - 双方队名、队徽、联赛名、北京开球时间、已赛比分（`fixtures.full.json`）
  - S0-S4 睡眠档位、夜猫指数、星级（`engine.js` 运行时输出）
  - 德比对决名（如“北伦敦德比”、“米兰德比”，来自 `rivalries.json`）
  - 焦点故事线与关键节点（来自 `storylines.json`）
  - 球队**赛季身份**标签（来自 `teams.json` 的 `tag` 字段，实有值仅「卫冕冠军」「升班马」两种，**且仅 17/111 队有** → 无标签时回落显示联赛名 + 轮次）
  - 真实比赛数据统计（`stats.js` 计算的已赛胜率、得失球、近5场走势、H2H 历史交锋）
  - 线路名称（来自抓取源原始文案）
- ❌ **严禁编造**：
  - 严禁出现 `xG` / 预期进球率（全库无 xG 数据）
  - 严禁出现控球率 / 传球精度 / 成功率等技术统计（无统计级数据）
  - 严禁出现阵型、首发阵容、球员位置图（无球员级数据）
  - 严禁出现"节律扰动""认知负荷""免疫力恢复"等生理模型指标（无医学模型）
  - 严禁出现码率 / 帧率 / 线路延迟（无结构化元数据）

---

## 六、视觉系统 Token 对照表（Single Source of Truth）

```javascript
// tailwind.config.js 语义映射
export default {
  colors: {
    'bg-app': 'rgb(var(--bg-app-rgb) / <alpha-value>)',
    'surface-panel': 'rgb(var(--surface-panel-rgb) / <alpha-value>)',
    'surface-card': 'rgb(var(--surface-card-rgb) / <alpha-value>)',
    'surface-raised': 'rgb(var(--surface-raised-rgb) / <alpha-value>)',
    'surface-press': 'rgb(var(--surface-press-rgb) / <alpha-value>)',
    'surface-accent': 'rgb(var(--accent-soft-rgb) / <alpha-value>)',
    'stage-bg': 'rgb(var(--stage-bg-rgb) / <alpha-value>)',
    'line-hairline': 'rgb(var(--line-hairline-rgb) / <alpha-value>)',
    'line-control': 'rgb(var(--line-control-rgb) / <alpha-value>)',
    'text-primary': 'rgb(var(--text-primary-rgb) / <alpha-value>)',
    'text-secondary': 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
    'text-muted': 'rgb(var(--text-muted-rgb) / <alpha-value>)',
    'text-faint': 'rgb(var(--text-faint-rgb) / <alpha-value>)',
    accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
    live: 'rgb(var(--live-rgb) / <alpha-value>)',
    resource: 'rgb(var(--resource-rgb) / <alpha-value>)',
    warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
    danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
    'tier-0': 'rgb(var(--tier-0-rgb) / <alpha-value>)',
    'tier-1': 'rgb(var(--tier-1-rgb) / <alpha-value>)',
    'tier-2': 'rgb(var(--tier-2-rgb) / <alpha-value>)',
    'tier-3': 'rgb(var(--tier-3-rgb) / <alpha-value>)',
    'tier-4': 'rgb(var(--tier-4-rgb) / <alpha-value>)'
  }
};
```

