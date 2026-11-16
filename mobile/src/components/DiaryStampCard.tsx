import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DIARY_NOTE_MAX_LEN,
  DIARY_STAMPS,
  MODE_META,
  STAMP_META,
  WATCH_MODES,
} from '@core/diary.js';
import type { DiaryEntry } from '@/state/diary';
import { colors, fontSize, radius, spacing, weight } from '@/ui/theme';

type Props = {
  matchId: string;
  entry: DiaryEntry | null;
  defaultMode?: 'live' | 'second_half' | 'replay';
  onSave: (patch: Partial<DiaryEntry> & { matchId: string }) => void;
  onRemove?: (matchId: string) => void;
  onOpenReport?: () => void;
  compact?: boolean;
};

export function DiaryStampCard({
  matchId,
  entry,
  defaultMode = 'live',
  onSave,
  onRemove,
  onOpenReport,
  compact = false,
}: Props) {
  const [noteState, setNoteState] = useState<{
    matchId: string;
    editing: boolean;
    text: string;
  }>(() => ({ matchId, editing: false, text: entry?.note || '' }));

  const scoped =
    noteState.matchId === matchId
      ? noteState
      : { matchId, editing: false, text: entry?.note || '' };
  const activeMode = entry?.mode || defaultMode;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>观赛情绪印章</Text>
        <View style={styles.modeRow}>
          {(WATCH_MODES as ReadonlyArray<keyof typeof MODE_META>).map(mode => {
            const on = activeMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() =>
                  onSave({
                    matchId,
                    mode,
                    stamp: entry?.stamp || 'epic',
                    note: entry?.note || '',
                  })
                }
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.modeBtn, on && styles.modeBtnOn]}
              >
                <Text style={[styles.modeText, on && styles.modeTextOn]} numberOfLines={1}>
                  {MODE_META[mode].shortLabel}
                </Text>
              </Pressable>
            );
          })}
          {onOpenReport ? (
            <Pressable
              onPress={onOpenReport}
              accessibilityRole="button"
              style={styles.reportBtn}
            >
              <Text style={styles.reportText} numberOfLines={1}>赛季账单</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.stampRow}>
        {(DIARY_STAMPS as ReadonlyArray<keyof typeof STAMP_META>).map(stampId => {
          const meta = STAMP_META[stampId];
          const active = entry?.stamp === stampId;
          return (
            <Pressable
              key={stampId}
              onPress={() => {
                if (active && onRemove) {
                  onRemove(matchId);
                } else {
                  onSave({
                    matchId,
                    mode: activeMode,
                    stamp: stampId,
                    note: entry?.note || '',
                  });
                }
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.stampBtn,
                active &&
                  (meta.tone === 'gold'
                    ? styles.stampGold
                    : meta.tone === 'teal'
                      ? styles.stampTeal
                      : meta.tone === 'danger'
                        ? styles.stampDanger
                        : styles.stampMuted),
              ]}
            >
              <Text style={[styles.stampText, active && styles.stampTextActive]} numberOfLines={1}>
                {meta.glyph} {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {entry ? (
        <View style={styles.noteArea}>
          {scoped.editing ? (
            <View style={styles.noteInputRow}>
              <TextInput
                value={scoped.text}
                onChangeText={t => setNoteState({ matchId, editing: true, text: t })}
                maxLength={DIARY_NOTE_MAX_LEN}
                placeholder="记一句熬夜感受（最多 60 字）"
                placeholderTextColor={colors.textFaint}
                style={styles.noteInput}
                returnKeyType="done"
                onSubmitEditing={() => {
                  onSave({
                    matchId,
                    mode: activeMode,
                    stamp: entry.stamp,
                    note: scoped.text,
                  });
                  setNoteState({ matchId, editing: false, text: scoped.text });
                }}
              />
              <Pressable
                onPress={() => {
                  onSave({
                    matchId,
                    mode: activeMode,
                    stamp: entry.stamp,
                    note: scoped.text,
                  });
                  setNoteState({ matchId, editing: false, text: scoped.text });
                }}
                accessibilityRole="button"
                style={styles.saveNoteBtn}
              >
                <Text style={styles.saveNoteText}>保存</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setNoteState({ matchId, editing: true, text: entry.note || '' })}
              accessibilityRole="button"
              style={styles.noteToggleBtn}
            >
              <Text style={styles.noteToggleText} numberOfLines={1}>
                {entry.note ? `“${entry.note}” · 点击修改` : '+ 写一句熬夜短评'}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    padding: spacing.md,
    gap: spacing.sm,
  },
  wrapCompact: {
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: weight.title,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  modeBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.control,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  modeBtnOn: {
    borderColor: colors.accent,
    backgroundColor: colors.goldSoft,
  },
  modeText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: weight.label,
  },
  modeTextOn: {
    color: colors.accent,
    fontWeight: weight.title,
  },
  reportBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.control,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.control,
  },
  reportText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: weight.label,
  },
  stampRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  stampBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stampGold: {
    borderColor: colors.accent,
    backgroundColor: colors.goldSoft,
  },
  stampTeal: {
    borderColor: colors.resource,
    backgroundColor: 'rgba(68, 226, 205, 0.14)',
  },
  stampDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  stampMuted: {
    borderColor: colors.control,
    backgroundColor: colors.raised,
  },
  stampText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  stampTextActive: {
    color: colors.text,
    fontWeight: weight.title,
  },
  noteArea: {
    marginTop: 2,
  },
  noteToggleBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  noteToggleText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  noteInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  noteInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.card,
    color: colors.text,
    paddingHorizontal: spacing.sm,
    fontSize: fontSize.xs,
  },
  saveNoteBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveNoteText: {
    color: colors.accentInk,
    fontSize: fontSize.xs,
    fontWeight: weight.title,
  },
});
