import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react-native';

import { colors, fontSize, radius, spacing } from '@/ui/theme';

const TEST_URL =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8';

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [withHeaders, setWithHeaders] = useState(false);

  useKeepAwake();

  const player = useVideoPlayer(
    { uri: TEST_URL, headers: { 'X-NightOwl-Phase0': '1' } },
    instance => {
      instance.loop = true;
      instance.play();
    }
  );

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  useEffect(() => {
    player.replace({
      uri: TEST_URL,
      headers: withHeaders ? { 'X-NightOwl-Phase0': '1' } : undefined,
    });
    player.play();
  }, [player, withHeaders]);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
      />

      <Pressable
        onPress={() => router.back()}
        style={[styles.back, { top: insets.top + spacing.sm, left: insets.left + spacing.md }]}
        accessibilityLabel="返回"
      >
        <ChevronLeft size={20} color={colors.text} />
        <Text style={styles.backText}>返回</Text>
      </Pressable>

      <View
        style={[
          styles.banner,
          { bottom: insets.bottom + spacing.md, left: insets.left + spacing.md },
        ]}
      >
        <Text style={styles.bannerTitle}>Phase 0 · HLS 直连</Text>
        <Text style={styles.bannerText}>
          Apple 官方测试流 · 自定义请求头 {withHeaders ? '已开启' : '已关闭'}
        </Text>
        <Pressable onPress={() => setWithHeaders(value => !value)} style={styles.headerToggle}>
          <SlidersHorizontal size={14} color={colors.accent} />
          <Text style={styles.headerToggleText}>切换请求头</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  back: {
    position: 'absolute',
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11, 14, 21, 0.72)',
    borderWidth: 1,
    borderColor: colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  backText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  banner: {
    position: 'absolute',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(11, 14, 21, 0.78)',
    borderWidth: 1,
    borderColor: colors.hairline,
    gap: 2,
  },
  bannerTitle: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.8 },
  bannerText: { color: colors.textSecondary, fontSize: fontSize.xs },
  headerToggle: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerToggleText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '600' },
});
