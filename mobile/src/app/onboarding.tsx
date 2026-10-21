import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Check, ChevronLeft } from 'lucide-react-native';

import { FOLLOWABLE_LEAGUES, leagueColor, leagueName } from '@data/index.js';

import { TeamPicker } from '@/components/TeamPicker';
import {
  notificationsAvailable,
  requestNotificationPermission,
  syncPrematchReminders,
} from '@/lib/reminders';
import { usePrefs, usePrefsStore } from '@/state/prefs';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { colors, fontSize, radius, spacing } from '@/ui/theme';

const STEP_TITLES = ['选择关注联赛', '选择关注球队', '设定熬夜额度'];
const BUDGETS = [0, 1, 2, 3, 4, 5, 6, 8];

export default function OnboardingScreen() {
  const router = useRouter();
  const prefs = usePrefs();
  const setPrefs = usePrefsStore(state => state.setPrefs);
  const toggleLeague = usePrefsStore(state => state.toggleLeague);
  const finishOnboarding = usePrefsStore(state => state.finishOnboarding);
  const [step, setStep] = useState(0);

  const finish = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const wantsNotifications = prefs.notifyBefore15;
    finishOnboarding();
    router.replace('/');
    if (wantsNotifications && notificationsAvailable()) {
      void (async () => {
        const granted = await requestNotificationPermission();
        if (granted) {
          await syncPrematchReminders(usePrefsStore.getState().prefs);
        } else {
          usePrefsStore.getState().setPrefs({ notifyBefore15: false });
        }
      })();
    }
  };

  const next = () => {
    void Haptics.selectionAsync();
    if (step < 2) setStep(value => value + 1);
    else finish();
  };

  const back = () => {
    void Haptics.selectionAsync();
    setStep(value => Math.max(0, value - 1));
  };

  const allLeaguesSelected = prefs.followedLeagues.length === FOLLOWABLE_LEAGUES.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/brand/logo.png')}
            style={styles.logo}
            contentFit="cover"
            accessibilityLabel="夜猫看台"
          />
          <View>
            <Text style={styles.brand}>夜猫看台</Text>
            <Text style={styles.brandSub}>让算法替你决定今晚值不值得熬</Text>
          </View>
        </View>
        <Pressable onPress={finish} hitSlop={10}>
          <Text style={styles.skip}>跳过</Text>
        </Pressable>
      </View>

      <View style={styles.progress}>
        {[0, 1, 2].map(index => (
          <View
            key={index}
            style={[styles.progressBar, index <= step && styles.progressBarActive]}
          />
        ))}
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.step}>第 {step + 1} / 3 步</Text>
        <Text style={styles.title}>{STEP_TITLES[step]}</Text>
      </View>

      {step === 0 ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.description}>
            关注的联赛会获得 +8 夜猫指数。建议只选 2–4 个真正会熬夜看的；全选 6
            个等于没有偏好。
          </Text>
          <View style={styles.leagueGrid}>
            {FOLLOWABLE_LEAGUES.map(code => {
              const active = prefs.followedLeagues.includes(code);
              return (
                <Pressable
                  key={code}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    toggleLeague(code);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  style={[
                    styles.leagueCard,
                    active && styles.leagueCardActive,
                  ]}
                >
                  <View style={[styles.leagueDot, { backgroundColor: leagueColor(code) }]} />
                  <View style={styles.leagueText}>
                    <Text style={styles.leagueName}>{leagueName(code)}</Text>
                    <Text style={styles.leagueCode}>{code}</Text>
                  </View>
                  {active ? (
                    <View style={styles.check}>
                      <Check size={11} color={colors.accentInk} strokeWidth={3} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {allLeaguesSelected ? (
            <Text style={styles.warning}>全选 6 个联赛时 +8 加成为 0，等于没有偏好。</Text>
          ) : null}
        </ScrollView>
      ) : null}

      {step === 1 ? (
        <View style={styles.body}>
          <Text style={[styles.description, styles.bodyPadding]}>
            主队出战的比赛会优先进入「今晚之选」。不设主队也能用，但推荐会少一层偏向。
          </Text>
          <View style={styles.picker}>
            <TeamPicker
              selected={prefs.followedTeams}
              onChange={ids => setPrefs({ followedTeams: ids })}
            />
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.description}>
            每周睡眠预算决定「本周精选」最多能安排几场。零成本场次不占额度，背包最多 5 场。
          </Text>
          <View style={styles.budgetRow}>
            {BUDGETS.map(hours => (
              <Chip
                key={hours}
                selected={prefs.weeklyBudget === hours}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setPrefs({ weeklyBudget: hours });
                }}
              >
                {hours}h
              </Chip>
            ))}
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>你的初始档案</Text>
            <Text style={styles.summaryLine}>
              关注联赛：{prefs.followedLeagues.length} 个 · 关注球队：
              {prefs.followedTeams.length} 支
            </Text>
            <Text style={styles.summaryLine}>
              每周预算：{prefs.weeklyBudget}h · 比分默认隐藏
            </Text>
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>赛前 15 分钟提醒</Text>
              <Text style={styles.switchHint}>
                安装版会请求通知权限；Expo Go 不支持通知原生模块。
              </Text>
            </View>
            <Switch
              value={prefs.notifyBefore15}
              onValueChange={value => setPrefs({ notifyBefore15: value })}
              trackColor={{ false: colors.control, true: colors.accent }}
              thumbColor={prefs.notifyBefore15 ? colors.accentInk : colors.textMuted}
            />
          </View>
        </ScrollView>
      ) : null}

      <View style={styles.footer}>
        {step > 0 ? (
          <Button
            label="上一步"
            variant="secondary"
            onPress={back}
            icon={<ChevronLeft size={16} color={colors.textSecondary} />}
            style={styles.backButton}
          />
        ) : null}
        <Button
          label={step === 2 ? '开始看球' : '下一步'}
          onPress={next}
          style={styles.nextButton}
        />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 38,
    height: 38,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(245,185,66,0.25)',
  },
  brand: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', letterSpacing: 0.4 },
  brandSub: { color: colors.textFaint, fontSize: fontSize.xs, marginTop: 1 },
  skip: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '600' },
  progress: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  progressBar: {
    flex: 1,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.hairline,
  },
  progressBarActive: { backgroundColor: colors.accent },
  titleBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: 4 },
  step: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.6 },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800', letterSpacing: 0.2 },
  body: { flex: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  bodyContent: { paddingBottom: spacing.xl, gap: spacing.md },
  bodyPadding: { paddingHorizontal: spacing.lg },
  description: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 20 },
  leagueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  leagueCard: {
    width: '48%',
    minHeight: 64,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leagueCardActive: { borderColor: colors.accent, backgroundColor: colors.goldSoft },
  leagueDot: { width: 8, height: 8, borderRadius: radius.full },
  leagueText: { flex: 1, gap: 1 },
  leagueName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  leagueCode: { color: colors.textFaint, fontSize: fontSize.xs },
  check: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warning: { color: colors.warn, fontSize: fontSize.xs },
  picker: { flex: 1, minHeight: 0, paddingTop: spacing.sm },
  budgetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  summaryTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  summaryLine: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    padding: spacing.lg,
  },
  switchText: { flex: 1, gap: 3 },
  switchTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  switchHint: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 17 },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  backButton: { flex: 0.8 },
  nextButton: { flex: 1.4 },
});
