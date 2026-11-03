import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react-native';

import { useToastStore, type ToastKind } from '@/state/toast';

import { durations } from './motion';
import { colors, fontSize, radius, spacing, weight, withAlpha } from './theme';

/**
 * 全局提示条。
 *
 * 挂在根布局上，避免每个页面各写一份（并且各写一个绿色勾）。失败状态停留更久、
 * 带两倍于成功的存活时间 —— 成功只需扫一眼，失败要读完还能点到「重试」。
 */
const TONE: Record<ToastKind, { color: string; ttl: number }> = {
  success: { color: colors.success, ttl: 3200 },
  info: { color: colors.textSecondary, ttl: 3200 },
  error: { color: colors.danger, ttl: 6000 },
};

function ToneIcon({ kind, color }: { kind: ToastKind; color: string }) {
  if (kind === 'success') return <CheckCircle2 size={15} color={color} />;
  if (kind === 'error') return <AlertCircle size={15} color={color} />;
  return <Info size={15} color={color} />;
}

export function ToastHost() {
  const current = useToastStore(state => state.current);
  const dismiss = useToastStore(state => state.dismiss);
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(6)).current;
  const id = current?.id;

  useEffect(() => {
    if (!id) return undefined;
    fade.stopAnimation();
    rise.stopAnimation();
    fade.setValue(0);
    rise.setValue(6);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: durations.fast, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: durations.fast, useNativeDriver: true }),
    ]).start();

    const ttl = TONE[current?.kind ?? 'info'].ttl;
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: durations.fast, useNativeDriver: true }),
        Animated.timing(rise, { toValue: 6, duration: durations.fast, useNativeDriver: true }),
      ]).start(() => dismiss(id));
    }, ttl);

    return () => clearTimeout(timer);
  }, [id]);

  if (!current) return null;
  const tone = TONE[current.kind];
  const actions = current.actions ?? [];

  return (
    <View style={styles.host} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.card,
          { borderColor: withAlpha(tone.color, 0.42), marginBottom: insets.bottom + 72 },
          { opacity: fade, transform: [{ translateY: rise }] },
        ]}
        accessibilityLiveRegion={current.kind === 'error' ? 'assertive' : 'polite'}
      >
        <View style={styles.row}>
          <ToneIcon kind={current.kind} color={tone.color} />
          <Text style={styles.message} numberOfLines={3}>
            {current.message}
          </Text>
        </View>
        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map(action => (
              <Pressable
                key={action.label}
                onPress={() => {
                  dismiss(current.id);
                  action.onPress();
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [
                  styles.action,
                  action.primary && styles.actionPrimary,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.actionText, action.primary && styles.actionTextPrimary]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  card: {
    maxWidth: 520,
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  message: { flex: 1, color: colors.text, fontSize: fontSize.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
  },
  actionPrimary: { backgroundColor: withAlpha(colors.accent, 0.14) },
  actionText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: weight.title },
  actionTextPrimary: { color: colors.accent },
  pressed: { opacity: 0.7 },
});
