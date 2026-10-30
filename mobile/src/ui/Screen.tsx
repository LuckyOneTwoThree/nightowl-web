import { useEffect, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from './theme';
import { durations, easeOut } from './motion';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
  edges?: Array<'top' | 'bottom' | 'left' | 'right'>;
  overlay?: ReactNode;
};

export function Screen({
  children,
  scroll = false,
  padded = true,
  refreshing = false,
  onRefresh,
  contentContainerStyle,
  edges = ['top'],
  overlay = null,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (!alive || reduce) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: durations.base,
          easing: easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: durations.base,
          easing: easeOut,
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => {
      alive = false;
    };
  }, [opacity, translateY]);

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <Animated.View style={[styles.flex, { opacity, transform: [{ translateY }] }]}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            padded && styles.padded,
            contentContainerStyle,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
                colors={[colors.accent]}
                progressBackgroundColor={colors.panel}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, padded && styles.padded]}>{children}</View>
      )}
      {overlay}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
});
