import type { ViewStyle } from 'react-native';

export const colors = {
  bg: '#0B0E15',
  panel: '#0F131C',
  card: '#141924',
  raised: '#1A202E',
  press: '#232B3B',
  stage: '#070A10',
  hairline: '#1C2331',
  control: '#2A3444',
  text: '#F2F5F9',
  textSecondary: '#BFC8D6',
  textMuted: '#94A0B2',
  textFaint: '#8A95A6',
  accent: '#F5B942',
  accentInk: '#1A1204',
  goldSoft: 'rgba(245, 185, 66, 0.12)',
  live: '#E86A62',
  resource: '#45BFAE',
  warn: '#E0A82E',
  danger: '#F2776B',
  resultInk: '#000000',
  resultWin: '#35A06F',
  resultDraw: '#6B7686',
  resultLoss: '#C9524C',
  dangerSoft: 'rgba(242, 119, 107, 0.12)',
  success: '#35A06F',
  overlay: 'rgba(0, 0, 0, 0.68)',
  tier: ['#3FB37F', '#6BB37A', '#D4A028', '#E88A3A', '#F07068'],
  league: {
    PL: '#A8559F',
    PD: '#E07A45',
    SA: '#4FA97F',
    BL: '#D05561',
    FL: '#5B8AD0',
    UCL: '#7C8FE8',
    SCG: '#6B7686',
  },
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/**
 * 圆角只有三档 + 胶囊。
 *
 * 原来的 sm/md/lg/xl/xxl/xxxl 六档在实际使用里几乎退化成了随机数：同类控件
 * （按钮）分别出现过 12 和 8，同一种卡片出现过 20 和 16。档位多不等于精细，
 * 只等于每次新写一个组件都要重新猜一次。
 *
 *   control 8  控件：按钮、输入框、分段、行内小元素
 *   card   16  卡片：列表容器、Hero、面板
 *   overlay 20 浮层：Sheet、弹层
 *   pill      胶囊：状态 chip、圆点、细条（只用于状态，不用于容器）
 */
export const radius = {
  control: 8,
  card: 16,
  overlay: 20,
  pill: 999,
} as const;

/**
 * 字重角色制。
 *
 * 此前 700 / 800 一共出现 105 次，几乎等于「所有想强调的地方都加粗」——
 * 结果是没有任何东西真的突出。层级改由字号与等宽数字承担：
 * 正文 400、标签与队名 500、标题与比分 600，不再有更粗的档。
 */
export const weight = {
  body: '400',
  label: '500',
  title: '600',
} as const;

export const fontSize = {
  // 手机端可读性下限：微字也保持 11px。
  xs: 11,
  sm: 12,
  md: 13,
  base: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  display: 44,
} as const;

/**
 * 系统字号放大。
 *
 * 正文、队名、比分不设上限，跟着系统走；它们的容器一律用 minHeight 而不是 height，
 * 字大了盒子跟着长。只有一类文字必须封顶：尺寸被数据或几何锁死的微文字
 * （坐标轴刻度、徽章里的数字）—— 它们旁边那些色块、圆点不会跟着变大，
 * 文字放大只会糊到邻居身上。封顶放在 1.3 倍，是「还能塞进去」与「尽量跟手」的折中。
 */
export const fontScale = {
  micro: 1.3,
} as const;

export const shadows: Record<'card' | 'pop', ViewStyle> = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  pop: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
};

export function tierColor(tier: number): string {
  return colors.tier[Math.max(0, Math.min(colors.tier.length - 1, tier))];
}

export function leagueColor(code: string): string {
  return colors.league[code as keyof typeof colors.league] || colors.league.SCG;
}

export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return `rgba(148, 160, 178, ${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
