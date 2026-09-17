/**
 * Tailwind 配置 · 视觉 token 唯一来源
 *
 * token 值定义在 src/index.css 的 :root 块（含设计纪律注释）。
 * 本文件只负责把变量暴露成工具类，不发明新值。
 *
 * 约定：
 *   - 颜色一律走下方语义名，组件里出现 `emerald-500` 之类的 Tailwind 原生色即为回归。
 *   - 字号只有 fontSize 里这 8 档，`text-[13px]` 之类的任意值同理。
 *   - 圆角规范：sm(2px) 柱条 · DEFAULT(4px) 小标签 · md(6px) 控件/按钮 ·
 *     lg(8px) 列表条目 · xl(12px) 核心模块大卡 · 2xl(16px) 浮层弹窗 · 3xl(24px) 视觉徽章 · full(9999px) 队徽/圆环。
 *   - 阴影两档：shadow-card 卡片 · shadow-pop 浮层。发光类阴影已废除。
 *   - 层叠只用 zIndex 的命名档（overlay / pop / scrim / drawer / modal），
 *     组件里出现 `z-[999]` 之类的数字即为回归。
 */

/** 把 index.css 里的 `--x-rgb` 变量暴露成支持 `/透明度` 修饰符的颜色 */
const alpha = name => `rgb(var(--${name}-rgb) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    /* 覆盖默认字号刻度：只允许下面这几档 */
    fontSize: {
      '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px 元信息 / 标签，可读性下限
      xs: ['0.75rem', { lineHeight: '1.125rem' }], // 12px 列表正文
      sm: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px 队名 / 小标题
      base: ['0.9375rem', { lineHeight: '1.5rem' }], // 15px 卡片标题
      lg: ['1.0625rem', { lineHeight: '1.5rem' }], // 17px 模态标题
      xl: ['1.25rem', { lineHeight: '1.75rem' }], // 20px 关键数字
      '2xl': ['1.75rem', { lineHeight: '2rem' }], // 28px 倒计时
      '3xl': ['2.125rem', { lineHeight: '2.5rem' }] // 34px
    },
    /* 统一圆角设计规范刻度（从微控件到浮层弹窗的严格阶梯）：
       sm(2px) 赛果块/微小条柱 · DEFAULT(4px) 小标签 · md(6px) 按钮/输入框/胶囊控件 ·
       lg(8px) 列表条目/抽屉内嵌模块 · xl(12px) 核心卡片模块(Hero/播放器/情报/后续赛程) ·
       2xl(16px) 浮层弹窗(UpdateModal/Onboarding) · 3xl(24px) 视觉徽章/开屏图腾 ·
       full(9999px) 队徽/圆环/状态点/进度条 */
    borderRadius: {
      none: '0',
      sm: '2px',
      DEFAULT: '4px',
      md: '6px',
      lg: '8px',
      xl: '12px',
      '2xl': '16px',
      '3xl': '24px',
      full: '9999px'
    },
    extend: {
      /* spacing 扩展：默认刻度有 0.5/1.5/2.5/3.5 但没有 6.5，
         此前 ScheduleView 三个导航按钮写 h-6.5 w-6.5 不生成 CSS，按钮无固定尺寸。 */
      spacing: {
        '6.5': '1.625rem'
      },
      colors: {
        /* 表面层级 */
        'bg-app': alpha('bg-app'),
        'surface-panel': alpha('surface-panel'),
        'surface-card': alpha('surface-card'),
        'surface-raised': alpha('surface-raised'),
        'surface-press': alpha('surface-press'),
        'surface-accent': alpha('accent-soft'),
        'stage-bg': alpha('stage-bg'),

        /* 描边 */
        'line-hairline': alpha('line-hairline'),
        'line-control': alpha('line-control'),

        /* 文本 */
        'text-primary': alpha('text-primary'),
        'text-secondary': alpha('text-secondary'),
        'text-muted': alpha('text-muted'),
        'text-faint': alpha('text-faint'),

        /* 品牌 */
        accent: alpha('accent'),
        'accent-ink': '#1A1204',

        /* 语义状态 */
        live: alpha('live'),
        resource: alpha('resource'),
        warn: alpha('warn'),
        danger: alpha('danger'),

        /* 睡眠档位 S0→S4：连续色阶 */
        'tier-0': alpha('tier-0'),
        'tier-1': alpha('tier-1'),
        'tier-2': alpha('tier-2'),
        'tier-3': alpha('tier-3'),
        'tier-4': alpha('tier-4'),

        /* 赛果 */
        'result-win': alpha('result-win'),
        'result-draw': alpha('result-draw'),
        'result-loss': alpha('result-loss'),

        /* 联赛识别色（仅列表左色条） */
        'league-pl': '#A8559F',
        'league-pd': '#E07A45',
        'league-sa': '#4FA97F',
        'league-bl': '#D05561',
        'league-fl': '#5B8AD0',
        'league-ucl': '#7C8FE8',
        'league-scg': '#6B7686'
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)'
      },
      fontFamily: {
        headline: ['Hanken Grotesk', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Be Vietnam Pro', 'system-ui', '-apple-system', 'sans-serif'],
        /* mono 只用于需要列对齐的数字，不用于中文正文 */
        num: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      /* 层叠：只有浮层类组件用得上，且只准用这几档命名值。
         此前抽屉 z-[110]、引导 z-[120]、遮罩 z-[100] 各写一份数字，
         谁都可能顺手加个 z-[999] 把顺序彻底打乱。
         开屏画面要盖在所有浮层（含引导/更新弹窗）之上，故给最高档。 */
      zIndex: {
        overlay: '20', // 播放器内的标题渐变条
        pop: '50', // Hint 气泡
        scrim: '100', // 遮罩
        drawer: '110', // 设置抽屉
        modal: '120', // 首次引导 / 更新弹窗
        splash: '200' // 开屏画面（须高于一切浮层）
      },
      keyframes: {
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' }
        }
      },
      animation: {
        'live-pulse': 'live-pulse 1.8s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
