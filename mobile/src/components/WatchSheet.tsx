import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ExternalLink, Play, Radio, RefreshCw, WifiOff } from 'lucide-react-native';

import { leagueName, teamName } from '@data/index.js';
import { countdown as engineCountdown, ts } from '@core/engine.js';
import { hm, humanCountdownShort, liveMinute } from '@core/format.js';
import { sourceUrlFor } from '@core/watch-sources.js';
import watchSources from '../shared/server/watch-sources.json';

import { useHighlights } from '@/data/useHighlights';
import { useLiveSources } from '@/data/useLiveSources';
import { usePlayerStore } from '@/state/player';
import { Crest } from '@/ui/Crest';
import { Skeleton } from '@/ui/Skeleton';
import { Sheet } from '@/ui/Sheet';
import { colors, fontSize, radius, spacing } from '@/ui/theme';
import type { LiveData } from '@/data/useLiveMatch';
import type { Match } from '@/types';

type Source = {
  id: string;
  name: string;
  kind: string;
  homeUrl?: string | null;
  note?: string;
  searchTemplate?: string | null;
  replayTemplate?: string | null;
  highlightTemplate?: string | null;
  leagues?: string[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  match: Match;
  now: number;
  live?: LiveData | null;
  isDone: boolean;
  isLive: boolean;
  spoilerFree: boolean;
  revealed: boolean;
  onReveal: () => void;
};

export function WatchSheet({
  visible,
  onClose,
  match,
  now,
  live,
  isDone,
  isLive,
  spoilerFree,
  revealed,
  onReveal,
}: Props) {
  const router = useRouter();
  const {
    data: sourceData,
    loading: sourceLoading,
    error: sourceError,
    reload: reloadSources,
  } = useLiveSources(match, visible && !isDone);

  const directLines = (sourceData?.lines || []).filter(line => line.isDirect && line.url);
  const fetchingSources = sourceLoading || (!sourceData && !sourceError);
  const playLine = (line: (typeof directLines)[number]) => {
    usePlayerStore.getState().start({ match, lines: directLines, activeId: line.id });
    onClose();
    router.push('/player');
  };

  const hiddenBySpoiler = isDone && spoilerFree && !revealed;
  const {
    data: highlights,
    loading: highlightsLoading,
    error: highlightsError,
    reload: reloadHighlights,
  } = useHighlights(match, visible && isDone && !hiddenBySpoiler);

  const sources = ((watchSources.official || []) as Source[]).filter(
    source => source.kind === 'deeplink'
  );

  const replayLinks = isDone
    ? sources
        .map(source => ({
          source,
          url: sourceUrlFor(source as never, match as never, { replay: true }),
        }))
        .filter(item => !!item.url)
    : [];

  const highlightLinks = isDone
    ? sources
        .map(source => ({
          source,
          url: sourceUrlFor(source as never, match as never, { highlight: true }),
        }))
        .filter(item => !!item.url && !replayLinks.some(replay => replay.url === item.url))
    : [];

  const liveLinks = !isDone
    ? sources
        .map(source => ({
          source,
          url: sourceUrlFor(source as never, match as never),
        }))
        .filter(item => !!item.url)
    : [];

  const title = isDone ? '回放与集锦' : isLive ? '观看直播' : '官方观赛入口';
  const countdown = engineCountdown(ts(match.t), now);
  const minute = liveMinute(ts(match.t), now);

  return (
    <Sheet visible={visible} onClose={onClose} title={title} scroll>
      <View style={styles.matchup}>
        <Crest id={match.h} size={30} />
        <Text style={styles.teamName} numberOfLines={1}>
          {teamName(match.h)}
        </Text>
        <Text style={styles.vs}>vs</Text>
        <Crest id={match.a} size={30} />
        <Text style={styles.teamName} numberOfLines={1}>
          {teamName(match.a)}
        </Text>
      </View>
      <Text style={styles.matchMeta}>
        {leagueName(match.l)} · {hm(match.t)}
      </Text>

      <View style={[styles.status, isLive && styles.statusLive]}>
        {isLive ? (
          <>
            <View style={styles.liveLeft}>
              <View style={styles.liveDot} />
              <Radio size={14} color={colors.live} />
              <Text style={styles.liveText}>
                {live?.statusText || '比赛已开始'}
                {live?.minuteLabel ? ` · ${live.minuteLabel}` : ` · ${minute}'`}
                {live?.score && live.score.h != null
                  ? ` · ${live.score.h}-${live.score.a}`
                  : ''}
              </Text>
            </View>
            <Text style={styles.liveBadge}>直播中</Text>
          </>
        ) : isDone ? (
          <>
            <Text style={styles.statusText}>已结束</Text>
            <Text style={styles.statusHint}>官方回放 / 集锦</Text>
          </>
        ) : (
          <>
            <Text style={styles.statusText}>距开球 {humanCountdownShort(countdown)}</Text>
            <Text style={styles.statusHint}>{hm(match.t)} 开球</Text>
          </>
        )}
      </View>

      {hiddenBySpoiler ? (
        <View style={styles.spoilerCard}>
          <Text style={styles.spoilerTitle}>比分尚未揭晓</Text>
          <Text style={styles.spoilerText}>
            回放与集锦可能包含比分。揭晓后再展示入口。
          </Text>
          <Pressable onPress={onReveal} style={styles.spoilerButton}>
            <Text style={styles.spoilerButtonText}>揭晓并查看</Text>
          </Pressable>
        </View>
      ) : null}

      {!isDone ? (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>直链线路</Text>
            <Pressable
              onPress={() => void reloadSources()}
              hitSlop={8}
              disabled={sourceLoading}
              accessibilityLabel="刷新直链"
            >
              {sourceLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <RefreshCw size={14} color={colors.textMuted} />
              )}
            </Pressable>
          </View>

          {fetchingSources ? (
            <View style={styles.skeletonList}>
              <Skeleton height={48} />
              <Skeleton height={48} />
            </View>
          ) : directLines.length > 0 ? (
            directLines.map(line => (
              <Pressable
                key={line.id}
                onPress={() => playLine(line)}
                style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`播放 ${line.name}`}
              >
                <Play size={16} color={colors.accent} />
                <View style={styles.linkText}>
                  <Text style={styles.linkName} numberOfLines={1}>
                    {line.name}
                  </Text>
                  <Text style={styles.linkNote}>
                    {line.kind === 'm3u8' ? 'HLS 直链' : line.kind.toUpperCase()} · 点击播放
                  </Text>
                </View>
                <Text style={styles.playText}>播放</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyDirect}>
              <WifiOff size={16} color={colors.textMuted} />
              <Text style={styles.emptyDirectText}>
                {sourceError ? '直链抓取暂时不可用' : '暂未匹配到直链'}
              </Text>
              <Pressable onPress={() => void reloadSources()} hitSlop={8}>
                <Text style={styles.playText}>重试</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.note}>
            直链来自公开索引，可能随时失效；播放器内置自动换线。App 不代理、不下载、不转码视频。
          </Text>
        </View>
      ) : null}

      {isDone && !hiddenBySpoiler ? (
        <>
          <SourceSection
            title="官方回放"
            links={replayLinks}
            emptyText="暂无官方回放入口"
          />
          {highlightLinks.length > 0 ? (
            <SourceSection title="官方集锦" links={highlightLinks} emptyText="" />
          ) : null}
        </>
      ) : null}

      {!isDone ? (
        <SourceSection
          title={isLive ? '官方直播入口' : '官方平台'}
          links={liveLinks}
          emptyText="暂无可用官方入口，稍后再试。"
        />
      ) : null}

      {isDone && !hiddenBySpoiler ? (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>YouTube 集锦</Text>
            <Pressable
              onPress={() => void reloadHighlights()}
              hitSlop={8}
              disabled={highlightsLoading}
              accessibilityLabel="刷新 YouTube 集锦"
            >
              {highlightsLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <RefreshCw size={14} color={colors.textMuted} />
              )}
            </Pressable>
          </View>

          {highlightsLoading || (!highlights && !highlightsError) ? (
            <Skeleton height={48} />
          ) : highlights?.videos?.length ? (
            highlights.videos.map(video => (
              <Pressable
                key={video.id}
                onPress={() => {
                  void Linking.openURL(video.url).catch(() => {});
                }}
                style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
                accessibilityRole="link"
                accessibilityLabel="打开 YouTube 官方集锦"
              >
                <Play size={16} color={colors.accent} />
                <View style={styles.linkText}>
                  <Text style={styles.linkName} numberOfLines={1}>
                    {teamName(match.h)} vs {teamName(match.a)} · 官方集锦
                  </Text>
                  <Text style={styles.linkNote}>YouTube · 在浏览器打开</Text>
                </View>
                <ExternalLink size={16} color={colors.textFaint} />
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>
              暂未索引到本场 YouTube 集锦，可先用上方官方入口。
            </Text>
          )}
          <Text style={styles.note}>
            视频来自官方频道；App 不代理、不下载视频。
          </Text>
        </View>
      ) : null}

      <Text style={styles.note}>
        直链由手机原生播放器打开；App 不代理、不下载、不转码任何视频。官方平台可能需要登录或会员。
      </Text>
    </Sheet>
  );
}

function SourceSection({
  title,
  links,
  emptyText,
}: {
  title: string;
  links: Array<{ source: Source; url: string }>;
  emptyText: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {links.length > 0 ? (
        links.map(({ source, url }) => (
          <Pressable
            key={`${title}-${source.id}`}
            onPress={() => {
              void Linking.openURL(url).catch(() => {});
            }}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            accessibilityRole="link"
            accessibilityLabel={`打开 ${source.name}`}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkName}>{source.name}</Text>
              <Text style={styles.linkNote} numberOfLines={1}>
                {source.note || '官方平台入口'}
              </Text>
            </View>
            <ExternalLink size={16} color={colors.textFaint} />
          </Pressable>
        ))
      ) : (
        <Text style={styles.emptyText}>{emptyText}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  matchup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  teamName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  vs: { color: colors.textFaint, fontSize: fontSize.xs },
  matchMeta: { color: colors.textFaint, fontSize: fontSize.xs, marginBottom: spacing.md },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  statusLive: {
    borderColor: 'rgba(226,86,79,0.35)',
    backgroundColor: 'rgba(226,86,79,0.10)',
  },
  liveLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.live },
  liveText: { color: colors.live, fontSize: fontSize.sm, fontWeight: '700' },
  liveBadge: { color: colors.live, fontSize: fontSize.xs, fontWeight: '700' },
  statusText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  statusHint: { color: colors.textFaint, fontSize: fontSize.xs },
  section: { gap: spacing.xs, marginBottom: spacing.md },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  linkText: { flex: 1, gap: 2 },
  linkName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  linkNote: { color: colors.textFaint, fontSize: fontSize.xs },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm, paddingVertical: spacing.sm },
  playText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  skeletonList: { gap: spacing.sm },
  emptyDirect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyDirectText: { flex: 1, color: colors.textMuted, fontSize: fontSize.sm },
  spoilerCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  spoilerTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  spoilerText: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
  spoilerButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
  },
  spoilerButtonText: { color: colors.accentInk, fontSize: fontSize.sm, fontWeight: '700' },
  note: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  pressed: { opacity: 0.75 },
});
