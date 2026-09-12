/** Tailwind 配置 · 视觉 token 来源：ui/UI设计规范与视觉设计系统.md §二，支持双模态自适应 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 背景与表面层级（CSS 变量驱动，全功能支持 /10, /60, /95 等透明度修饰符）
        'bg-app': 'rgb(var(--bg-app-rgb) / <alpha-value>)',
        'surface-panel': 'rgb(var(--surface-panel-rgb) / <alpha-value>)',
        'surface-card': 'rgb(var(--surface-card-rgb) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover-rgb) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--surface-elevated-rgb) / <alpha-value>)',
        'surface-highlight': 'rgb(var(--surface-highlight-rgb) / <alpha-value>)',
        'border-subtle': 'rgb(var(--border-subtle-rgb) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong-rgb) / <alpha-value>)',
        'stage-bg': 'rgb(var(--stage-bg-rgb) / <alpha-value>)',

        // 语义文本颜色
        'text-primary': 'rgb(var(--text-primary-rgb) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted-rgb) / <alpha-value>)',
        'text-dim': 'rgb(var(--text-dim-rgb) / <alpha-value>)',

        // 品牌与功能强调色
        'primary-gold': 'rgb(var(--primary-gold-rgb) / <alpha-value>)',
        'primary-gold-dim': 'var(--primary-gold-dim)',
        'live-red': '#E24B4A',
        'accent-teal': '#44E2CD',
        'accent-purple': '#CEB5FF',
        'warning-amber': '#F59E0B',
        'danger-orange': '#FF7A45',
        'sleep-extreme': '#9333EA'
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        elevated: 'var(--shadow-elevated)',
        'gold-glow': '0 0 16px rgba(255, 184, 0, 0.25)'
      },
      fontFamily: {
        headline: ['Hanken Grotesk', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Be Vietnam Pro', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      borderWidth: { hairline: '1px' },
      keyframes: {
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' }
        },
        'gold-flash': {
          '0%, 100%': { borderColor: 'rgba(255,184,0,0.25)' },
          '50%': { borderColor: 'rgba(255,184,0,0.9)' }
        }
      },
      animation: {
        'live-pulse': 'live-pulse 1.6s ease-in-out infinite',
        'gold-flash': 'gold-flash 1.8s ease-in-out 2'
      }
    }
  },
  plugins: []
};
