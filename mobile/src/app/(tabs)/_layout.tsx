import { Redirect, Tabs } from 'expo-router';

import { usePrefsStore } from '@/state/prefs';
import { AppTabBar } from '@/ui/TabBar';
import { colors } from '@/ui/theme';

export default function TabsLayout() {
  const onboardingDone = usePrefsStore(state => state.prefs.onboardingDone);

  if (!onboardingDone) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
      tabBar={props => <AppTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: '今晚' }} />
      <Tabs.Screen name="schedule" options={{ title: '赛程' }} />
      <Tabs.Screen name="plan" options={{ title: '规划' }} />
      <Tabs.Screen name="me" options={{ title: '我的' }} />
    </Tabs>
  );
}
