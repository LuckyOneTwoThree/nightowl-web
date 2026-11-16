import { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import {
  buildSeasonReport,
  DIARY_STAMPS,
  MODE_META,
  STAMP_META,
  WATCH_MODES,
} from '@core/diary.js';
import { getFixtures, teamName } from '@data/index.js';
import type { DiaryState } from '@/state/diary';
import type { Prefs } from '@/state/prefs';
import { Button } from '@/ui/Button';
import { colors, fontSize, radius, spacing, weight } from '@/ui/theme';

type Props = {
  open: boolean;
  diary: DiaryState;
  prefs: Prefs;
  revealedIds: string[];
  onClose: () => void;
};

const NIGHT_HOURS = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

export function SeasonReportModal({ open, diary, prefs, revealedIds, onClose }: Props) {
  const fixtures = getFixtures();
  const report = useMemo(
    () => buildSeasonReport(diary, fixtures, prefs, revealedIds),
    [diary, fixtures, prefs, revealedIds]
  );

  const maxBucket = Math.max(1, ...report.safeSummary.hourBuckets);

  const handleShareText = () => {
    const teamLines = report.teamRecords
      .slice(0, 3)
      .map(
        r =>
          `${teamName(r.teamId)}: 陪看 ${r.watched} 场` +
          (r.decided > 0 ? ` (${r.w}胜${r.d}平${r.l}负 · ${r.winRate}%)` : ' (待揭晓)')
      )
      .join('\n');
    const msg = [
      `【夜猫看台 · 我的熬夜赛季账单】`,
      `称号：${report.persona.title}`,
      `${report.persona.detail}`,
      `累计盖章：${report.safeSummary.totalWatched} 场（其中 S3/S4 守夜 ${report.safeSummary.lateNightCount} 场）`,
      `血赚名局：${report.outcomeSummary.worthItCount} 场 · 0-0 闷平：${report.outcomeSummary.dullDrawCount} 场`,
      teamLines ? `主队记录：\n${teamLines}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    void Share.share({ title: '我的熬夜赛季账单', message: msg });
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.badge}>NIGHT OWL · 本地战报</Text>
              <Text style={styles.title}>{report.persona.title}</Text>
              <Text style={styles.subtitle}>{report.persona.detail}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
              <Text style={styles.closeText}>关闭</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner}>
            <View style={styles.statGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>累计盖章</Text>
                <Text style={styles.statValue}>{report.safeSummary.totalWatched}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>S3/S4 守夜</Text>
                <Text style={[styles.statValue, styles.statGold]}>
                  {report.safeSummary.lateNightCount}
                </Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>血赚名局</Text>
                <Text style={[styles.statValue, styles.statTeal]}>
                  {report.outcomeSummary.worthItCount}
                </Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>0-0 催眠</Text>
                <Text style={styles.statValue}>{report.outcomeSummary.dullDrawCount}</Text>
              </View>
            </View>

            {report.outcomeSummary.maskedBySpoilerCount > 0 ? (
              <View style={styles.spoilerBanner}>
                <Text style={styles.spoilerText}>
                  防剧透护盾已隔离 {report.outcomeSummary.maskedBySpoilerCount} 场未揭晓补看赛果。
                </Text>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>熬夜出勤时段热力（北京时间）</Text>
              <Svg width="100%" height={78} viewBox="0 0 300 78">
                {NIGHT_HOURS.map((hr, idx) => {
                  const count = report.safeSummary.hourBuckets[hr] || 0;
                  const barH = Math.max(6, Math.round((count / maxBucket) * 44));
                  const x = 6 + idx * 29;
                  const y = 52 - barH;
                  return (
                    <ViewSvgBar
                      key={hr}
                      x={x}
                      y={y}
                      height={barH}
                      active={count > 0}
                      label={String(hr).padStart(2, '0')}
                    />
                  );
                })}
              </Svg>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>观赛方式与印章分布</Text>
              {(WATCH_MODES as ReadonlyArray<keyof typeof MODE_META>).map(mode => (
                <View key={mode} style={styles.kvRow}>
                  <Text style={styles.kvLabel}>{MODE_META[mode].label}</Text>
                  <Text style={styles.kvValue}>{report.safeSummary.byMode[mode] || 0} 场</Text>
                </View>
              ))}
              <View style={styles.divider} />
              {(DIARY_STAMPS as ReadonlyArray<keyof typeof STAMP_META>).map(id => {
                const meta = STAMP_META[id];
                return (
                  <View key={id} style={styles.kvRow}>
                    <Text style={styles.kvLabel}>
                      {meta.glyph} {meta.label}
                    </Text>
                    <Text style={styles.kvValue}>{report.safeSummary.byStamp[id] || 0} 场</Text>
                  </View>
                );
              })}
            </View>

            {report.teamRecords.length > 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>主队深夜陪看记录</Text>
                {report.teamRecords.map(rec => (
                  <View key={rec.teamId} style={styles.kvRow}>
                    <Text style={styles.kvLabel}>{teamName(rec.teamId)}</Text>
                    <Text style={styles.kvValue}>
                      陪看 {rec.watched} 场
                      {rec.decided > 0 ? ` · ${rec.w}胜${rec.d}平${rec.l}负 (${rec.winRate}%)` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Button label="分享文本战报" variant="secondary" onPress={handleShareText} />
            <Button label="完成" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ViewSvgBar({
  x,
  y,
  height,
  active,
  label,
}: {
  x: number;
  y: number;
  height: number;
  active: boolean;
  label: string;
}) {
  return (
    <>
      <Rect
        x={x}
        y={y}
        width={18}
        height={height}
        rx={3}
        fill={active ? colors.accent : colors.control}
      />
      <SvgText
        x={x + 9}
        y={68}
        fill={colors.textFaint}
        fontSize={10}
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.overlay,
    borderTopRightRadius: radius.overlay,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    paddingTop: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  headerText: { flex: 1, gap: 3 },
  badge: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: weight.title,
  },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: weight.title },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 17 },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: { color: colors.textMuted, fontSize: fontSize.sm },
  scroll: { flexGrow: 0 },
  scrollInner: { padding: spacing.lg, gap: spacing.md },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    width: '48%',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: 4,
  },
  statLabel: { color: colors.textMuted, fontSize: fontSize.xs },
  statValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  statGold: { color: colors.accent },
  statTeal: { color: colors.resource },
  spoilerBanner: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255, 184, 0, 0.3)',
    backgroundColor: colors.goldSoft,
    padding: spacing.sm,
  },
  spoilerText: { color: colors.accent, fontSize: fontSize.xs, lineHeight: 17 },
  sectionCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: weight.title,
    marginBottom: 4,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 3,
  },
  kvLabel: { color: colors.textSecondary, fontSize: fontSize.xs, flexShrink: 0 },
  kvValue: {
    flexShrink: 1,
    textAlign: 'right',
    color: colors.text,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginVertical: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});
