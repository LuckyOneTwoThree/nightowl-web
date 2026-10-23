import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ChevronLeft, ListVideo, RefreshCw } from 'lucide-react-native';

import { autoSwitchDecision } from '@core/line-switch.js';
import { teamName } from '@data/index.js';

import { usePlayerStore } from '@/state/player';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { Match } from '@/types';
import type { StreamLine } from '@/data/useLiveSources';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default function PlayerScreen() {
  const router = useRouter();
  const session = usePlayerStore(state => state.session);
  const setActive = usePlayerStore(state => state.setActive);
  const clear = usePlayerStore(state => state.clear);

  useEffect(() => () => clear(), [clear]);

  if (!session) {
    return <EmptyPlayer onBack={() => router.back()} message="没有可播放的线路" />;
  }

  const lines = session.lines.filter(line => line.isDirect && line.url);
  const active =
    lines.find(line => line.id === session.activeId) ?? lines[0] ?? null;

  if (!active) {
    return <EmptyPlayer onBack={() => router.back()} message="当前线路不是原生可播放格式" />;
  }

  return (
    <PlayerView
      key={session.match.id}
      match={session.match}
      lines={lines}
      active={active}
      onSelect={setActive}
      onBack={() => router.back()}
    />
  );
}

function PlayerView({
  match,
  lines,
  active,
  onSelect,
  onBack,
}: {
  match: Match;
  lines: StreamLine[];
  active: StreamLine;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [panelOpen, setPanelOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hudVisible, setHudVisible] = useState(true);
  const hudOpacity = useRef(new Animated.Value(1)).current;
  const attemptsRef = useRef(0);
  const firstSourceRef = useRef(true);
  const stateRef = useRef({ lines, activeId: active.id });
  stateRef.current = { lines, activeId: active.id };

  useKeepAwake();

  useEffect(() => {
    Animated.timing(hudOpacity, {
      toValue: hudVisible || panelOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [hudVisible, panelOpen, hudOpacity]);

  useEffect(() => {
    if (!hudVisible || panelOpen) return undefined;
    const timer = setTimeout(() => setHudVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [hudVisible, panelOpen, active.id]);

  const player = useVideoPlayer(
    {
      uri: active.url,
      headers: { 'User-Agent': USER_AGENT },
      contentType: active.kind === 'm3u8' ? 'hls' : undefined,
    },
    instance => {
      instance.loop = false;
      instance.play();
    }
  );

  useEffect(() => {
    if (firstSourceRef.current) {
      firstSourceRef.current = false;
      return;
    }
    player.replace({
      uri: active.url,
      headers: { 'User-Agent': USER_AGENT },
      contentType: active.kind === 'm3u8' ? 'hls' : undefined,
    });
    player.play();
  }, [active.id, player, active.url, active.kind]);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'error') return;
    const current = stateRef.current;
    const decision = autoSwitchDecision({
      lines: current.lines,
      activeId: current.activeId,
      attempts: attemptsRef.current,
      maxAttempts: 2,
    }) as { switch: boolean; line?: StreamLine; reason?: string };

    if (decision.switch && decision.line) {
      attemptsRef.current += 1;
      setNotice(`线路异常，已切换到 ${decision.line.name}`);
      onSelect(decision.line.id);
    } else {
      setNotice('线路不可用，请选择其他线路或返回官方入口');
      setPanelOpen(true);
    }
  });

  const selectLine = (id: string) => {
    attemptsRef.current = 0;
    setPanelOpen(false);
    onSelect(id);
  };

  return (
    <View
      style={styles.root}
      onTouchStart={() => {
        if (!hudVisible) setHudVisible(true);
      }}
    >
      <StatusBar hidden />
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
      />

      <Animated.View
        pointerEvents={hudVisible || panelOpen ? 'box-none' : 'none'}
        style={[
          styles.topBar,
          { top: insets.top + spacing.sm, opacity: hudOpacity },
        ]}
      >
        <Pressable onPress={onBack} style={styles.topButton} accessibilityLabel="返回">
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <View style={styles.titlePill}>
          <View style={styles.liveDot} />
          <Text style={styles.title} numberOfLines={1}>
            {teamName(match.h)} vs {teamName(match.a)} · {active.name}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setHudVisible(true);
            setPanelOpen(value => !value);
          }}
          style={styles.topButton}
          accessibilityLabel="选择线路"
        >
          <ListVideo size={18} color={colors.text} />
        </Pressable>
      </Animated.View>

      {notice ? (
        <View style={[styles.notice, { bottom: insets.bottom + 96 }]}>
          <RefreshCw size={14} color={colors.accent} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {panelOpen ? (
        <View
          style={[
            styles.panel,
            {
              paddingBottom: insets.bottom + spacing.md,
              maxHeight: 260,
            },
          ]}
        >
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>切换线路</Text>
            <Text style={styles.panelHint}>{lines.length} 条可播放</Text>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {lines.map(line => {
              const selected = line.id === active.id;
              return (
                <Pressable
                  key={line.id}
                  onPress={() => selectLine(line.id)}
                  style={({ pressed }) => [
                    styles.lineRow,
                    selected && styles.lineRowActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.lineText}>
                    <Text style={styles.lineName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text style={styles.lineMeta}>
                      {line.kind === 'm3u8' ? 'HLS 直链' : line.kind.toUpperCase()}
                    </Text>
                  </View>
                  {selected ? <Text style={styles.current}>当前</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function EmptyPlayer({ onBack, message }: { onBack: () => void; message: string }) {
  return (
    <View style={styles.emptyRoot}>
      <StatusBar style="light" />
      <Text style={styles.emptyText}>{message}</Text>
      <Pressable onPress={onBack} style={styles.emptyButton}>
        <ChevronLeft size={16} color={colors.accentInk} />
        <Text style={styles.emptyButtonText}>返回</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  topBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11,14,21,0.72)',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titlePill: {
    flex: 1,
    height: 34,
    maxWidth: 340,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11,14,21,0.78)',
    borderWidth: 1,
    borderColor: colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.live,
  },
  title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1 },
  notice: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11,14,21,0.9)',
    borderWidth: 1,
    borderColor: colors.control,
  },
  noticeText: { color: colors.textSecondary, fontSize: fontSize.xs },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,19,28,0.98)',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  panelTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  panelHint: { color: colors.textFaint, fontSize: fontSize.xs },
  lineRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  lineRowActive: { backgroundColor: colors.goldSoft },
  lineText: { flex: 1, gap: 2 },
  lineName: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  lineMeta: { color: colors.textFaint, fontSize: fontSize.xs },
  current: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  emptyRoot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.base },
  emptyButton: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyButtonText: { color: colors.accentInk, fontSize: fontSize.md, fontWeight: '700' },
});
