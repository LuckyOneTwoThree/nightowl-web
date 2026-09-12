/** Tailwind 配置 · 视觉 token 来源：ui/UI设计规范与视觉设计系统.md §二 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 背景与表面层级
        'bg-app': '#0A0D14',
        'surface-panel': '#0E121B',
        'surface-card': '#131722',
        'surface-hover': '#1A2030',
        'surface-elevated': '#1E2538',
        'surface-highlight': '#1A2133',
        'border-subtle': '#232A3B',
        'border-strong': '#333E56',
        // 品牌与功能强调色
        'primary-gold': '#FFB800',
        'live-red': '#E24B4A',
        'accent-teal': '#44E2CD',
        'accent-purple': '#CEB5FF',
        'warning-amber': '#F59E0B',
        'danger-orange': '#FF7A45',
        'sleep-extreme': '#9333EA'
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
