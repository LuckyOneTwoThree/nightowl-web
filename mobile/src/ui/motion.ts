import { Easing } from 'react-native';

/**
 * 动效只服务三件事：浮层进退、状态变化、列表重排。
 *
 * 全部落在 160–220ms：低于 160 会显得跳，高于 220 会让人等。
 * 抖动式入场（每张卡各自 delay）刻意不做——那不是动效，是加载慢的借口。
 */
export const durations = {
  fast: 160,
  base: 200,
  slow: 220,
} as const;

export const easeOut = Easing.out(Easing.cubic);
