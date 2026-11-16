import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Laptop, Smartphone, Wifi } from 'lucide-react-native';

import { getFixtures } from '@data/index.js';
import { mondayOfWall, nightOf } from '@core/engine.js';
import { buildSyncBundle } from '@core/sync-bundle.js';
import type { StreamLine } from '@/data/useLiveSources';
import { useAppStore } from '@/state/app';
import { useDiaryStore } from '@/state/diary';
import { usePlayerStore } from '@/state/player';
import { usePrefs, usePrefsStore, type Prefs } from '@/state/prefs';
import { useWatchLaterStore } from '@/state/queue';
import { toast } from '@/state/toast';
import { useWeekOverridesStore } from '@/state/weekOverrides';
import type { Match } from '@/types';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { colors, fontSize, radius, spacing, weight } from '@/ui/theme';

type HandoffLine = {
  id: string;
  name?: string;
  label?: string;
  url?: string;
  kind?: string;
  isDirect?: boolean;
  proxyRequired?: boolean;
};

type SyncResponse = {
  ok: boolean;
  error?: string;
  merged?: {
    prefsUpdatedAt?: number;
    prefs?: Partial<Prefs>;
    weekUpdatedAtByWeek?: Record<string, number>;
    weekOverridesByWeek?: Record<string, unknown>;
    watchLater?: unknown[];
    revealedIds?: string[];
    diary?: unknown;
  };
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('连接桌面端超时（请确认同一 Wi-Fi 且未被防火墙拦截）');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type InfoResponse = {
  ok: boolean;
  mode?: 'sync' | 'handoff';
  hasHandoff?: boolean;
  error?: string;
};

type HandoffResponse = {
  ok: boolean;
  error?: string;
  handoff?: {
    matchId: string;
    title?: string;
    lines?: HandoffLine[];
  };
};

function parsePairUriInput(raw: string): {
  host?: string;
  port?: string;
  token?: string;
  mode?: string;
} | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('nightowl://')) {
    try {
      const normalized = trimmed.replace('nightowl://', 'https://nightowl.local/');
      const u = new URL(normalized);
      return {
        host: u.searchParams.get('host') || undefined,
        port: u.searchParams.get('port') || undefined,
        token: u.searchParams.get('token') || undefined,
        mode: u.searchParams.get('mode') || undefined,
      };
    } catch {
      return null;
    }
  }
  const hostPort = /^(\d{1,3}(?:\.\d{1,3}){3}|[a-zA-Z0-9.-]+):(\d{2,5})$/.exec(trimmed);
  if (hostPort) {
    return { host: hostPort[1], port: hostPort[2] };
  }
  return null;
}

export default function PairScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    host?: string;
    port?: string;
    token?: string;
    mode?: string;
  }>();

  const prefs = usePrefs();
  const prefsUpdatedAt = usePrefsStore(state => state.prefsUpdatedAt);
  const applySyncedPrefs = usePrefsStore(state => state.applySyncedPrefs);
  const watchLater = useWatchLaterStore(state => state.items);
  const replaceItems = useWatchLaterStore(state => state.replaceItems);
  const revealedMap = useAppStore(state => state.revealedIds);
  const mergeRevealed = useAppStore(state => state.mergeRevealed);
  const diary = useDiaryStore(state => state.diary);
  const importDiary = useDiaryStore(state => state.importDiary);
  const weekOverridesByWeek = useWeekOverridesStore(state => state.byWeek);
  const weekUpdatedAtByWeek = useWeekOverridesStore(state => state.updatedAtByWeek);
  const replaceByWeek = useWeekOverridesStore(state => state.replaceByWeek);
  const startPlayer = usePlayerStore(state => state.start);

  const [host, setHost] = useState(params.host ? String(params.host) : '');
  const [port, setPort] = useState(params.port ? String(params.port) : '');
  const [pin, setPin] = useState('');
  const [token, setToken] = useState(params.token ? String(params.token) : '');
  const [mode, setMode] = useState<'sync' | 'handoff'>(
    params.mode === 'handoff' ? 'handoff' : 'sync'
  );
  const [uriPaste, setUriPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (params.host) setHost(String(params.host));
    if (params.port) setPort(String(params.port));
    if (params.token) setToken(String(params.token));
    if (params.mode === 'handoff') setMode('handoff');
  }, [params.host, params.port, params.token, params.mode]);

  const handlePasteUri = (text: string) => {
    setUriPaste(text);
    const parsed = parsePairUriInput(text);
    if (!parsed) return;
    if (parsed.host) setHost(parsed.host);
    if (parsed.port) setPort(parsed.port);
    if (parsed.token) setToken(parsed.token);
    if (parsed.mode === 'handoff') setMode('handoff');
    else if (parsed.mode === 'sync') setMode('sync');
  };

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const parsedPortNum = Number(port.trim());
  const portValid = Number.isInteger(parsedPortNum) && parsedPortNum >= 1 && parsedPortNum <= 65535;
  const canSubmit = host.trim().length > 0 && portValid && (pin.trim().length === 6 || token.trim().length > 0);

  const handleSync = async () => {
    const cleanHost = host.trim();
    const cleanPort = port.trim();
    const portNum = Number(cleanPort);
    const cleanPin = pin.trim();
    const cleanToken = token.trim();
    if (!cleanHost || !cleanPort) {
      setErrorMsg('请填写桌面端显示的局域网 IP 和端口');
      return;
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setErrorMsg('请输入合法端口（1–65535）');
      return;
    }
    if (!cleanToken && cleanPin.length !== 6) {
      setErrorMsg('请输入桌面端的 6 位配对口令（或通过配对链接填入 Token）');
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    setStatusMsg('正在连接桌面端临时配对服务…');

    const baseUrl = `http://${cleanHost}:${portNum}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cleanToken) headers['X-Pair-Token'] = cleanToken;
    if (cleanPin) headers['X-Pair-Pin'] = cleanPin;

    try {
      // 1. 先询问会话信息，判断是否为接力播控模式
      let resolvedMode: 'sync' | 'handoff' = mode;
      let hasHandoff = false;
      try {
        const infoRes = await fetchWithTimeout(`${baseUrl}/pair/info`, { method: 'GET', headers });
        const infoJson = (await infoRes.json().catch(() => ({}))) as InfoResponse;
        if (infoRes.ok && infoJson.ok) {
          if (infoJson.mode === 'handoff') resolvedMode = 'handoff';
          hasHandoff = Boolean(infoJson.hasHandoff);
        } else if (infoRes.status === 401 || infoRes.status === 410) {
          throw new Error(infoJson.error || '配对口令无效或会话已过期');
        }
      } catch (err) {
        if (
          err instanceof Error &&
          (err.message.includes('口令') || err.message.includes('过期') || err.message.includes('超时'))
        ) {
          throw err;
        }
      }

      // 2. 构建手机本地包并发起双向无损合并
      const revealedList = Object.keys(revealedMap).filter(k => revealedMap[k]);
      const localBundle = buildSyncBundle(
        {
          prefsUpdatedAt,
          prefs,
          weekUpdatedAtByWeek,
          weekOverridesByWeek,
          watchLater,
          revealedIds: revealedList,
          diary,
        },
        Date.now()
      );

      const syncRes = await fetchWithTimeout(`${baseUrl}/pair/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(localBundle),
      });
      const syncJson = (await syncRes.json().catch(() => ({}))) as SyncResponse;
      if (!syncRes.ok || !syncJson.ok || !syncJson.merged) {
        throw new Error(syncJson.error || `同步失败（HTTP ${syncRes.status}）`);
      }

      const merged = syncJson.merged;
      if (merged.prefs) applySyncedPrefs(merged.prefs, merged.prefsUpdatedAt);
      if (merged.weekOverridesByWeek) {
        const minKey = mondayOfWall(nightOf(Date.now())) as string;
        replaceByWeek(merged.weekOverridesByWeek, minKey, merged.weekUpdatedAtByWeek);
      }
      if (Array.isArray(merged.watchLater)) {
        replaceItems(merged.watchLater);
      }
      if (Array.isArray(merged.revealedIds)) {
        mergeRevealed(merged.revealedIds);
      }
      if (merged.diary) {
        importDiary(merged.diary);
      }

      // 3. 如为「回被窝手机接力」，继续拉取播控接力信息并跳去播放/选线
      if (resolvedMode === 'handoff' || hasHandoff) {
        const handoffRes = await fetchWithTimeout(`${baseUrl}/pair/handoff`, { method: 'GET', headers });
        const handoffJson = (await handoffRes.json().catch(() => ({}))) as HandoffResponse;
        if (handoffRes.ok && handoffJson.ok && handoffJson.handoff?.matchId) {
          const { matchId, lines = [] } = handoffJson.handoff;
          const match = (getFixtures() as Match[]).find(m => m.id === matchId);
          const directPlayable: StreamLine[] = lines
            .filter(line => line.isDirect && line.url && !line.proxyRequired)
            .map(line => ({
              id: line.id,
              name: line.name || line.label || '桌面线路',
              url: String(line.url),
              kind: line.kind || 'm3u8',
              isDirect: true,
            }));

          toast.success('同步完成，正在接力打开本场比赛');
          if (match && directPlayable.length > 0) {
            startPlayer({
              match,
              lines: directPlayable,
              activeId: directPlayable[0].id,
            });
            router.replace('/player');
            return;
          }
          router.replace({
            pathname: '/match/[id]',
            params: { id: matchId, watch: '1' },
          });
          return;
        }
      }

      if (!mountedRef.current) return;
      setStatusMsg('同步成功：已合并主队关注、本周微调、补看清单与观赛印章');
      toast.success('局域网同步完成');
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : '无法连接到桌面端，请确认处于同一 Wi-Fi';
      setErrorMsg(msg);
      setStatusMsg(null);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
        >
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>局域网同步与被窝接力</Text>
          <Text style={styles.subtitle}>零云端 · 同一 Wi-Fi 下与桌面端双向合并</Text>
        </View>
      </View>

      <Card style={styles.heroCard}>
        <View style={styles.heroIcons}>
          <Laptop size={18} color={colors.accent} />
          <Wifi size={16} color={colors.resource} />
          <Smartphone size={18} color={colors.accent} />
        </View>
        <Text style={styles.heroDesc}>
          在桌面端「设置 → 局域网一扫同步」或播放页「手机接力」开启 120 秒临时端口后，用系统相机扫码或复制链接 / 填入下方地址与 6 位口令。
        </Text>
      </Card>

      <View style={styles.section}>
        <SectionHeader title="快捷粘贴配对链接" />
        <Card style={styles.formCard}>
          <TextInput
            value={uriPaste}
            onChangeText={handlePasteUri}
            placeholder="粘贴 nightowl://pair?... 或 192.168.x.x:端口"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="手动输入配对参数" />
        <Card style={styles.formCard}>
          <Text style={styles.fieldLabel}>桌面端局域网 IP</Text>
          <TextInput
            value={host}
            onChangeText={setHost}
            placeholder="例如 192.168.1.24"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>临时端口</Text>
          <TextInput
            value={port}
            onChangeText={setPort}
            placeholder="例如 54321"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>6 位一次性配对口令</Text>
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder="桌面端弹窗中的 6 位数字"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.pinInput}
          />

          <Text style={styles.fieldLabel}>配对模式</Text>
          <SegmentedControl
            value={mode}
            onChange={v => setMode(v === 'handoff' ? 'handoff' : 'sync')}
            options={[
              { key: 'sync', label: '双向数据同步' },
              { key: 'handoff', label: '接力当前比赛' },
            ]}
          />
          <Text style={styles.modeHint}>
            {mode === 'handoff'
              ? '合并偏好、补看与印章后，自动切入桌面端正在播放或查看的本场比赛。'
              : '与桌面端双向合并主队关注、本周规划微调、补看清单与观赛印章。'}
          </Text>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          {statusMsg ? <Text style={styles.statusText}>{statusMsg}</Text> : null}

          <Button
            label={mode === 'handoff' ? '同步并接力看球' : '发起局域网双向合并'}
            onPress={() => void handleSync()}
            disabled={!canSubmit || busy}
            loading={busy}
            style={styles.submitBtn}
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  backBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: weight.title },
  subtitle: { color: colors.textMuted, fontSize: fontSize.xs },
  heroCard: {
    gap: spacing.sm,
    backgroundColor: colors.panel,
  },
  heroIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroDesc: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  section: { gap: spacing.xs },
  formCard: { gap: spacing.sm },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: weight.label,
  },
  input: {
    minHeight: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
  },
  pinInput: {
    minHeight: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.panel,
    color: colors.accent,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.lg,
    fontWeight: weight.title,
    letterSpacing: 6,
  },
  modeHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    lineHeight: 17,
  },
  errorText: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 18 },
  statusText: { color: colors.resource, fontSize: fontSize.xs, lineHeight: 18 },
  submitBtn: { marginTop: spacing.xs, minHeight: 44 },
  pressed: { opacity: 0.78 },
});
