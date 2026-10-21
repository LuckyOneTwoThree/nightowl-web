import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, fontSize, radius, spacing } from './theme';

type Tone = 'default' | 'accent' | 'warn' | 'live' | 'muted';

type Props = {
  children: ReactNode;
  tone?: Tone;
  selected?: boolean;
  icon?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

const TONE_COLORS: Record<Tone, { fg: string; bg: string; border: string }> = {
  default: { fg: colors.textSecondary, bg: colors.panel, border: colors.hairline },
  accent: { fg: colors.accent, bg: colors.goldSoft, border: colors.accent },
  warn: { fg: colors.warn, bg: 'rgba(224,168,46,0.10)', border: colors.warn },
  live: { fg: colors.live, bg: 'rgba(226,86,79,0.10)', border: colors.live },
  muted: { fg: colors.textFaint, bg: 'transparent', border: colors.hairline },
};

export function Chip({
  children,
  tone = 'default',
  selected = false,
  icon,
  onPress,
  style,
}: Props) {
  const palette = selected
    ? { fg: colors.text, bg: colors.raised, border: colors.accent }
    : TONE_COLORS[tone];
  const content = (
    <View
      style={[
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.label, { color: palette.fg }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={6}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 32,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: { fontSize: fontSize.xs, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
