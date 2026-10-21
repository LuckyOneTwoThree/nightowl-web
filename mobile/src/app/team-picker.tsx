import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';

import { TeamPicker } from '@/components/TeamPicker';
import { Button } from '@/ui/Button';
import { usePrefsStore } from '@/state/prefs';
import { colors, fontSize, spacing } from '@/ui/theme';

export default function TeamPickerScreen() {
  const router = useRouter();
  const selected = usePrefsStore(state => state.prefs.followedTeams);
  const setPrefs = usePrefsStore(state => state.setPrefs);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.header}>
        <Text style={styles.title}>关注球队</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <X size={20} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <TeamPicker
          selected={selected}
          onChange={ids => setPrefs({ followedTeams: ids })}
        />
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>已选 {selected.length} 支球队</Text>
        <Button label="完成" onPress={() => router.back()} style={styles.done} />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  body: { flex: 1, minHeight: 0, paddingHorizontal: spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.panel,
  },
  footerText: { color: colors.textMuted, fontSize: fontSize.sm },
  done: { minWidth: 108 },
});
