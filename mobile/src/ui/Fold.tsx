import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import { animateLayout } from '@/lib/layoutAnimation';

import { colors, fontSize, radius, spacing, weight, withAlpha } from './theme';

type Props = {
  title: string;
  /** 收起时的一行摘要 —— 没有摘要的抽屉等于让用户猜里面有没有东西 */
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * 折叠抽屉（三级披露的第三层）
 *
 * 与桌面 `intel/primitives.jsx: Block({ fold })` 同一职责：默认收起，
 * 收起时用一行摘要说明「里面有什么」，展开后才铺开正文。
 * 摘要是必需的 —— 空标题抽屉会让用户永远不点开。
 */
export function Fold({ title, summary, children, defaultOpen = false, style }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={[styles.card, style]}>
      <Pressable
        onPress={() => {
          animateLayout();
          setOpen(value => !value);
        }}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}，${summary}${open ? '，已展开' : '，已收起'}`}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {!open ? (
            <Text style={styles.summary} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </View>
        {open ? (
          <ChevronUp size={16} color={colors.textMuted} />
        ) : (
          <ChevronDown size={16} color={colors.textMuted} />
        )}
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: withAlpha(colors.text, 0.06),
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  headerText: { flex: 1, minWidth: 0, gap: 1 },
  title: { color: colors.text, fontSize: fontSize.sm, fontWeight: weight.title },
  summary: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    lineHeight: 15,
  },
  body: { paddingBottom: spacing.lg, gap: spacing.sm },
  pressed: { opacity: 0.7 },
});
