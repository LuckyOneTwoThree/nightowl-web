import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { leagueName, teamName } from '@data/index.js';
import { hm } from '@core/format.js';
import type { Match } from '@/types';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { colors, fontSize, radius, spacing } from '@/ui/theme';

type DigestItem = {
  item: { id: string; status: string };
  match: Match | null;
};

type Props = {
  visible: boolean;
  items: DigestItem[];
  revealedIds: Record<string, boolean>;
  onReveal: (id: string) => void;
  onMarkRead: (id: string) => void;
  onOpenMatch: (id: string) => void;
  onClose: () => void;
};

export function MorningDigestSheet({
  visible,
  items,
  revealedIds,
  onReveal,
  onMarkRead,
  onOpenMatch,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [confirmAll, setConfirmAll] = useState(false);
  useEffect(() => {
    if (!visible) setConfirmAll(false);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>昨晚补看</Text>
                <Chip>{items.length} 场</Chip>
              </View>
              <Text style={styles.subtitle}>比分默认隐藏；逐场揭晓后查看。</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="关闭补看摘要">
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {items.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>昨晚的补看已经清空</Text>
                <Text style={styles.subtitle}>可以在比赛详情继续加入「明早补看」。</Text>
              </View>
            ) : (
              items.map(({ item, match }) => {
                const shown = !!match && !!revealedIds[match.id];
                const hasScore = !!match?.sc && match.st === 'done';
                return (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardTop}>
                      <Text style={styles.meta}>
                        {match ? `${leagueName(match.l)} · ${hm(match.t)}` : item.id}
                      </Text>
                      <Text style={styles.meta}>{item.status === 'watched' ? '已看' : '待补看'}</Text>
                    </View>
                    <View style={styles.cardMain}>
                      {match ? <Crest id={match.h} size={30} /> : null}
                      <View style={styles.cardText}>
                        <Text style={styles.matchTitle} numberOfLines={1}>
                          {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                        </Text>
                        <Text style={styles.meta}>
                          {match ? (match.st === 'done' ? '已终场' : '比分待录') : '本地赛程中没有这场比赛'}
                        </Text>
                      </View>
                      {match ? (
                        <Text style={[styles.score, !shown && styles.scoreHidden]}>
                          {shown ? (hasScore ? match.sc : '待录') : '•• - ••'}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.actions}>
                      {match && !shown ? (
                        <Button label="揭晓" variant="secondary" onPress={() => onReveal(match.id)} />
                      ) : null}
                      {match ? (
                        <Button label="查看" variant="ghost" onPress={() => onOpenMatch(match.id)} />
                      ) : null}
                      <Button label="已看" variant="ghost" onPress={() => onMarkRead(item.id)} />
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.meta}>{confirmAll ? '再点一次确认全部揭晓' : '不着急，稍后也能从补看队列进入'}</Text>
            <View style={styles.footerActions}>
              <Button
                label={confirmAll ? '确认揭晓' : '全部揭晓'}
                variant="ghost"
                onPress={() => {
                  if (!confirmAll) {
                    setConfirmAll(true);
                    return;
                  }
                  for (const { match } of items) if (match) onReveal(match.id);
                  setConfirmAll(false);
                }}
              />
              <Button label="稍后再看" onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.xxxl,
    borderTopRightRadius: radius.xxxl,
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
  },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 17 },
  close: { color: colors.textMuted, fontSize: fontSize.sm, paddingTop: 2 },
  scroll: { flexGrow: 0 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.xs },
  emptyTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: '700' },
  card: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.card, padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.textFaint, fontSize: fontSize.xs },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardText: { flex: 1, gap: 2 },
  matchTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  score: { color: colors.text, fontSize: fontSize.md, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreHidden: { color: colors.textFaint, letterSpacing: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  footerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
