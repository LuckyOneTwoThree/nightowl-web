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
  live: '#E2564F',
  resource: '#45BFAE',
  warn: '#E0A82E',
  danger: '#F2776B',
  resultInk: '#000000',
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

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  xxxl: 24,
  full: 999,
} as const;

export const fontSize = {
  xxs: 10,
  xs: 11,
  sm: 12,
  md: 13,
  base: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  display: 44,
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
