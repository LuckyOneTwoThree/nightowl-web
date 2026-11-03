import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bjClock } from '@core/format.js';
import type { Match } from '@/types';

import { colors, fontSize, spacing, weight } from './theme';

export type DecisionStripData = {
  verdict: 'recommended' | 'neutral' | 'defer' | 'unknown';
  reason: string;
  endAt: number | null;
  costMinutes: number | null;
  remainingMinutes: number | null;
  alternativeId: string | null;
  sleepKnown: boolean;
  resultHidden: boolean;
};

const VERDICT_COPY: Record<DecisionStripData['verdict'], { label: string; color: string }> = {
  recommended: { label: '值得熬', color: colors.accent },
  neutral: { label: '可看可不看', color: colors.textSecondary },
  defer: { label: '建议换一场', color: colors.live },
  unknown: { label: '暂时无法判断', color: colors.textFaint }
};

function hoursOf(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function Cell({
  label,
  value,
  tone,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  tone?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, tone ? { color: tone } : null]} numberOfLines={1}>
        {value}
      </Text>
    </>
  );
  if (!onPress) return <View style={styles.cell}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // 单元格本体只有两行字（约 24dp），靠外扩补到 44dp；相邻格子都是不接手势的 View，
      // 重叠不会抢走别的动作。
      hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * 决策条 · 移动端两行两列
 *
 * 与桌面同一份语义（core/decision-strip.js），只是把四段折成 2×2。
 * 同一屏只出现一次，指数仍只在 Hero 顶部展示。
 */
export function DecisionStrip({
  decision,
  match,
  alternativeLabel,
  onSelectAlternative,
}: {
  decision: DecisionStripData | null;
  match: Match;
  alternativeLabel?: string | null;
  onSelectAlternative?: () => void;
}) {
  if (!decision) return null;
  const verdict = VERDICT_COPY[decision.verdict] ?? VERDICT_COPY.unknown;
  const endLabel =
    match.tbd || decision.endAt == null ? '待定' : `${bjClock(decision.endAt, false)} 结束`;
  const costLabel = !decision.sleepKnown
    ? '未开睡眠账本'
    : decision.costMinutes && decision.costMinutes > 0
      ? `欠 ${hoursOf(decision.costMinutes)}`
      : '不欠睡眠';

  return (
    <View style={styles.wrap} accessibilityLabel={`今晚决策结论，${verdict.label}，${endLabel}，${costLabel}`}>
      <View style={styles.row}>
        <Cell label="结论" value={verdict.label} tone={verdict.color} />
        <Cell label="结束" value={endLabel} tone={match.tbd ? colors.textMuted : undefined} />
      </View>
      <View style={styles.row}>
        <Cell
          label="睡眠代价"
          value={costLabel}
          tone={decision.sleepKnown && decision.costMinutes ? colors.text : colors.textMuted}
        />
        <Cell
          label="同夜替代"
          value={alternativeLabel || '—'}
          tone={alternativeLabel ? colors.accent : colors.textFaint}
          onPress={alternativeLabel ? onSelectAlternative : undefined}
          accessibilityLabel={alternativeLabel ? `换到 ${alternativeLabel}` : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingTop: spacing.sm,
    gap: 6,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1, minWidth: 0, gap: 1 },
  label: { color: colors.textFaint, fontSize: fontSize.xs },
  value: { fontSize: fontSize.sm, fontWeight: weight.title, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 }
});
