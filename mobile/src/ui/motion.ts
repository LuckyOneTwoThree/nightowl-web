import { Easing } from 'react-native';

export const durations = {
  fast: 120,
  base: 180,
  slow: 280,
} as const;

export const easeOut = Easing.out(Easing.cubic);
