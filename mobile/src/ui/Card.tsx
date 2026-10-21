import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from './theme';

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
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.lg,
  },
  panel: { backgroundColor: colors.panel },
  raised: { backgroundColor: colors.raised },
});
