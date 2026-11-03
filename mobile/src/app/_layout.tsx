import 'react-native-gesture-handler';

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as ScreenOrientation from 'expo-screen-orientation';

import { useBootstrap } from '@/data/useBootstrap';
import { getFixtures } from '@data/index.js';
import { useMorningDigest } from '@/lib/useMorningDigest';
import { useNow } from '@/lib/useNow';
import { usePrefs } from '@/state/prefs';
import { useAppStore, useDataRev } from '@/state/app';
import { useWatchLaterStore } from '@/state/queue';
import { useMorningDigestStore } from '@/state/morningDigest';
import { MorningDigestSheet } from '@/components/MorningDigestSheet';
import { useSyncOnLaunch } from '@/data/sync/useSync';
import { usePrematchReminders } from '@/lib/usePrematchReminders';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { ToastHost } from '@/ui/Toast';
import { colors } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const bootstrapReady = useBootstrap();
  const [timedOut, setTimedOut] = useState(false);
  const ready = bootstrapReady || timedOut;

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return <View style={styles.boot} />;

  return <AppShell />;
}

function AppShell() {
  useSyncOnLaunch();
  usePrematchReminders();
  const router = useRouter();
  const pathname = usePathname();
  const prefs = usePrefs();
  const now = useNow(30_000);
  const rev = useDataRev();
  const queueItems = useWatchLaterStore(state => state.items);
  const revealedIds = useAppStore(state => state.revealedIds);
  const revealMatch = useAppStore(state => state.revealMatch);
  const markWatched = useWatchLaterStore(state => state.markWatched);
  const fixtures = useMemo(() => getFixtures(), [rev]);
  const digest = useMorningDigest(
    queueItems,
    fixtures,
    now,
    prefs,
    !pathname.includes('onboarding')
  );
  // 「我的」页的「看摘要」发出递增信号，由这里唯一的摘要实例响应。
  // 不把 digest.open 放进依赖（每次渲染 identity 都变），只在信号变化时调用一次。
  const digestOpenSignal = useMorningDigestStore(state => state.openSignal);
  useEffect(() => {
    if (digestOpenSignal > 0) digest.open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digestOpenSignal]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ErrorBoundary>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="match/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="team/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="standings/[league]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="search"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="team-picker"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="onboarding"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="player"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="debug/player"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
        </Stack>
        <MorningDigestSheet
          visible={digest.visible}
          items={digest.items}
          revealedIds={revealedIds}
          onReveal={revealMatch}
          onMarkRead={markWatched}
          onOpenMatch={id => {
            digest.close();
            router.push({ pathname: '/match/[id]', params: { id } });
          }}
          onClose={digest.close}
        />
        <ToastHost />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  boot: { flex: 1, backgroundColor: colors.bg },
});
