import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { CalendarDays, MoonStar, SlidersHorizontal, UserRound } from 'lucide-react-native';

import { liveCountAt } from '@core/owl.js';
import { useNow } from '@/lib/useNow';
import { useDataRev } from '@/state/app';

import { colors, fontSize, radius, spacing } from './theme';

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
            {focused ? <View style={styles.activeBar} /> : null}
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              {meta.icon(color)}
              {route.name === 'index' && liveCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{liveCount > 9 ? '9+' : liveCount}</Text>
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
    paddingTop: 8,
    paddingHorizontal: spacing.sm,
  },
  tab: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
  },
  pressed: { opacity: 0.7 },
  activeBar: {
    position: 'absolute',
    top: 0,
    width: 22,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  label: { fontSize: fontSize.xs, fontWeight: '600' },
  labelActive: { fontWeight: '700' },
  iconWrap: {
    position: 'relative',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  iconWrapActive: {
    backgroundColor: colors.goldSoft,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.live,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 2,
    borderColor: colors.panel,
  },
  badgeText: { color: '#FFFFFF', fontSize: fontSize.xs, fontWeight: '800' },
});
