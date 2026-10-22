import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, withAlpha } from './theme';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'panel' | 'raised';
};

export function Card({ children, style, tone = 'default' }: Props) {
  return (
    <View
      style={[
        styles.card,
        tone === 'panel' && styles.panel,
        tone === 'raised' && styles.raised,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: withAlpha(colors.text, 0.06),
    backgroundColor: colors.card,
    padding: spacing.lg,
  },
  panel: { backgroundColor: colors.panel },
  raised: { backgroundColor: colors.raised },
});
