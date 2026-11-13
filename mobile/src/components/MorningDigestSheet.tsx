import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { leagueName, teamName } from '@data/index.js';
import { evalOne } from '@core/owl.js';
import { hm } from '@core/format.js';
import { completedWatchHint } from '@core/reveal.js';
import { usePrefs } from '@/state/prefs';
import type { Match } from '@/types';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Crest } from '@/ui/Crest';
import { colors, fontSize, radius, spacing, weight } from '@/ui/theme';

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
  const prefs = usePrefs();
  const [confirmAll, setConfirmAll] = useState(false);
  useEffect(() => {
    if (!visible) setConfirmAll(false);
  }, [visible]);

  const firstPending = items.find(entry => entry.match && entry.item.status !== 'watched');

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
            <Pressable onPress={onClose} hitSlop={15} accessibilityRole="button" accessibilityLabel="关闭补看摘要">
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
                const ev = match ? (evalOne(match, prefs) as { ev: unknown }).ev : null;
                const watchHint =
                  !shown && hasScore
                    ? (completedWatchHint as (m: Match, ev?: unknown) => {
                        level: string;
                        label: string;
                        shortLabel: string;
                      } | null)(match, ev)
                    : null;
                return (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardTop}>
                      <Text style={styles.meta}>
                        {match
                          ? `${leagueName(match.l)} · ${match.tbd ? '时间待定' : hm(match.t)}`
                          : item.id}
                      </Text>
                      <Text style={styles.meta}>{item.status === 'watched' ? '已看' : '待补看'}</Text>
                    </View>
                    <Pressable
                      onPress={() => match && onOpenMatch(match.id)}
                      disabled={!match}
                      accessibilityRole={match ? 'button' : undefined}
                      accessibilityLabel={
                        match ? `查看 ${teamName(match.h)} 对 ${teamName(match.a)} 详情` : undefined
                      }
                      style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
                    >
                      {match ? <Crest id={match.h} size={30} /> : null}
                      <View style={styles.cardText}>
                        <Text style={styles.matchTitle} numberOfLines={1}>
                          {match ? `${teamName(match.h)} vs ${teamName(match.a)}` : '比赛数据已移除'}
                        </Text>
                        <Text style={styles.meta}>
                          {match
                            ? match.st === 'done'
                              ? `已终场${watchHint ? ` · ${watchHint.label}` : ''}`
                              : '比分待录'
                            : '本地赛程中没有这场比赛'}
                        </Text>
                      </View>
                      {match ? (
                        <Text style={[styles.score, !shown && styles.scoreHidden]}>
                          {shown ? (hasScore ? match.sc : '待录') : '•• - ••'}
                        </Text>
                      ) : null}
                    </Pressable>
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
              {firstPending?.match ? (
                <>
                  <Button label="稍后" variant="secondary" onPress={onClose} />
                  <Button
                    label="开始依序补看"
                    onPress={() => onOpenMatch(firstPending.match!.id)}
                  />
                </>
              ) : (
                <Button label="稍后再看" onPress={onClose} />
              )}
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
  },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: weight.title },
  subtitle: { color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 17 },
  close: { color: colors.textMuted, fontSize: fontSize.sm, paddingTop: 2 },
  scroll: { flexGrow: 0 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.xs },
  emptyTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: weight.title },
  card: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.card, padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.textFaint, fontSize: fontSize.xs },
  cardMain: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.78 },
  cardText: { flex: 1, gap: 2 },
  matchTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: weight.title },
  score: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.title, fontVariant: ['tabular-nums'] },
  scoreHidden: { color: colors.textFaint, letterSpacing: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  footerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
