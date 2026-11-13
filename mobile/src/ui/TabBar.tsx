import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { CalendarDays, MoonStar, SlidersHorizontal, UserRound } from 'lucide-react-native';

import { liveCountAt } from '@core/owl.js';
import { useNow } from '@/lib/useNow';
import { useDataRev } from '@/state/app';
import { useWatchLaterStore } from '@/state/queue';

import { colors, fontSize, radius, spacing, weight } from './theme';

type TabMeta = {
  label: string;
  icon: (color: string) => ReactNode;
};

const META: Record<string, TabMeta> = {
  index: { label: '今晚', icon: color => <MoonStar size={21} color={color} strokeWidth={1.8} /> },
  schedule: {
    label: '赛程',
    icon: color => <CalendarDays size={21} color={color} strokeWidth={1.8} />,
  },
  plan: {
    label: '规划',
    icon: color => <SlidersHorizontal size={21} color={color} strokeWidth={1.8} />,
  },
  me: { label: '我的', icon: color => <UserRound size={21} color={color} strokeWidth={1.8} /> },
};

type TabBarProps = {
  state: {
    index: number;
    routes: Array<{ key: string; name: string; params?: object }>;
  };
  navigateToTab: (routeKey: string) => void;
};

export function AppTabBar({ state, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const now = useNow(60_000);
  const rev = useDataRev();
  const liveCount = useMemo(() => liveCountAt(now) as number, [now, rev]);
  const pendingQueueCount = useWatchLaterStore(
    s => s.items.filter(item => item.status !== 'watched').length
  );

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const meta = META[route.name];
        if (!meta) return null;
        const focused = state.index === index;
        const color = focused ? colors.accent : colors.textFaint;

        const onPress = () => {
          void Haptics.selectionAsync();
          if (!focused) navigateToTab(route.key);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.label}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            {focused ? <View style={styles.activeIndicator} /> : null}
            <View style={styles.iconWrap}>
              {meta.icon(color)}
              {route.name === 'index' && liveCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{liveCount > 9 ? '9+' : liveCount}</Text>
                </View>
              ) : route.name === 'me' && pendingQueueCount > 0 ? (
                <View style={[styles.badge, styles.badgeQueue]}>
                  <Text style={[styles.badgeText, styles.badgeQueueText]}>
                    {pendingQueueCount > 9 ? '9+' : pendingQueueCount}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, { color }, focused && styles.labelActive]}>
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: 6,
    paddingHorizontal: spacing.sm,
  },
  tab: {
    flex: 1,
    height: 54,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.control,
  },
  activeIndicator: {
    position: 'absolute',
    top: -6,
    width: 24,
    height: 2.5,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  pressed: { opacity: 0.72 },
  label: { fontSize: fontSize.xs, fontWeight: weight.label },
  labelActive: { fontWeight: weight.title },
  iconWrap: {
    position: 'relative',
    width: 36,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.live,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.panel,
  },
  badgeText: {
    color: colors.resultInk,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  badgeQueue: { backgroundColor: colors.accent },
  badgeQueueText: { color: colors.accentInk },
});
