import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';

import { sleepTier } from '@core/engine.js';
import { colors, fontScale, fontSize, radius, spacing, tierColor, withAlpha, weight } from '@/ui/theme';

/**
 * 一周风险带
 *
 * 问题：柱状图只回答「哪晚消耗大」，回答不了「到几点、会不会越线」。
 * 对熬夜的人来说后者才是决策依据 —— 「周六 4.5h」不如「周六要看到 05:45，
 * 比你 00:30 的底线晚 5 小时」直接。
 *
 * 所以这里把「一晚」画成时间轴上的一段：7 行共用同一条横向坐标（18:00 → 08:00），
 * 一眼能看出哪晚拖得最晚、有没有跨过那条竖线。竖线是睡眠底线，位置来自 core。
 */

export type RiskSegment = {
  id: string;
  t: string;
  startMin: number;
  endMin: number;
  endClock: string;
};

export type RiskFloor = {
  nightMin: number;
  clock: string;
  wakeTime: string;
  minSleep: number;
  isWeekend?: boolean;
  assumed: boolean;
};

export type RiskBand = {
  date: string;
  weekday: number;
  cost: number;
  count: number;
  segments: RiskSegment[];
  firstStartMin: number | null;
  latestEndMin: number | null;
  latestEndClock: string | null;
  floor?: RiskFloor | null;
  blocked?: boolean;
  belowFloor: boolean;
  overMinutes: number;
  current: boolean;
  empty: boolean;
};

export type WeekRisk = {
  floor: RiskFloor | null;
  weekendFloor?: RiskFloor | null;
  domain: { startMin: number; endMin: number; ticks: Array<{ min: number; label: string }> };
  bands: RiskBand[];
  worst: { date: string; weekday: number; latestEndMin: number; latestEndClock: string } | null;
  riskNights: number;
  tbdCount: number;
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const ROW_HEIGHT = 34;
const TRACK_HEIGHT = 10;
const MAX_LANES = 2;

/**
 * 同开球的多场比赛不能完全叠在一条线上：后画的色块会盖住先画的，
 * 那晚的睡眠档位就只剩最后一个可见。按开始时间装箱到最多两条泳道，
 * 让「同一时段有两场」这件事在图上说得出来。
 */
function placeSegments(segments: RiskSegment[]): { placed: Array<{ seg: RiskSegment; lane: number }>; lanes: number } {
  const laneEnds: number[] = [];
  const placed = segments.map(seg => {
    let lane = laneEnds.findIndex(end => end <= seg.startMin);
    if (lane === -1) {
      if (laneEnds.length < MAX_LANES) {
        lane = laneEnds.length;
        laneEnds.push(seg.endMin);
      } else {
        lane = MAX_LANES - 1;
        laneEnds[lane] = Math.max(laneEnds[lane], seg.endMin);
      }
    } else {
      laneEnds[lane] = seg.endMin;
    }
    return { seg, lane };
  });
  return { placed, lanes: Math.max(1, Math.min(MAX_LANES, laneEnds.length)) };
}

function weekdayOf(index: number) {
  return `周${WEEKDAYS[Math.max(0, Math.min(6, index))]}`;
}

function fmtOver(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} 分钟`;
  return mins ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
}

export function WeekRiskBand({
  risk,
  selectedDate,
  onSelectDate,
  weekWord = '本周',
}: {
  risk: WeekRisk;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  weekWord?: string;
}) {
  const { domain, floor, weekendFloor, bands } = risk;
  const hasDistinctWeekend = Boolean(weekendFloor && floor && weekendFloor.clock !== floor.clock);
  const span = Math.max(1, domain.endMin - domain.startMin);
  const pct = (min: number) => `${((min - domain.startMin) / span) * 100}%`;

  const headline = (() => {
    if (!risk.worst) return `${weekWord}没有可安排的场次`;
    const worstDay = weekdayOf(risk.worst.weekday);
    const tail = `最晚到 ${risk.worst.latestEndClock}（${worstDay}）`;
    if (!floor) return tail;
    if (risk.riskNights > 0) return `${risk.riskNights} 晚越过底线 · ${tail}`;
    return `没有越线 · ${tail}`;
  })();

  /* 一周没有任何已定开球时间的场次（历史周、休赛周）时，7 行空轨道只是噪音 */
  if (!risk.worst) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.headline}>{headline}</Text>
        {risk.tbdCount > 0 ? (
          <Text style={styles.note}>
            另有 {risk.tbdCount} 场开球时间未定，连属于哪一晚都不知道，没有画进来。
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={[styles.headline, risk.riskNights > 0 && styles.headlineWarn]}>{headline}</Text>
        {floor ? (
          <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.legendLine} />
            <Text style={styles.legendText}>
              {hasDistinctWeekend
                ? `底线 平日 ${floor.clock} · 周末 ${weekendFloor?.clock}`
                : `底线 ${floor.clock}`}
              {floor.assumed ? '（默认）' : ''}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.axisRow}>
        <View style={styles.dayCol} />
        <View style={styles.trackCol}>
          {domain.ticks.map((tick, index) => (
            <Text
              key={tick.min}
              // 刻度位置由数据算出来，下面的色块不会跟着字变大，所以这里封顶
              maxFontSizeMultiplier={fontScale.micro}
              style={[
                styles.tick,
                { left: pct(tick.min) },
                index === 0 && styles.tickFirst,
                index === domain.ticks.length - 1 && styles.tickLast,
              ]}
            >
              {tick.label}
            </Text>
          ))}
        </View>
        <View style={styles.endCol} />
      </View>

      {bands.map(band => {
        const selected = selectedDate === band.date;
        const rowFloor = band.floor ?? floor;
        const { placed, lanes } = placeSegments(band.segments);
        const laneHeight = lanes > 1 ? (TRACK_HEIGHT - 2) / lanes : TRACK_HEIGHT;
        const laneTop = (lane: number) => (lanes > 1 ? lane * (laneHeight + 2) : 0);
        const label = band.empty
          ? `${weekdayOf(band.weekday)}${band.blocked ? '（已设禁看夜）' : ''}，暂无已定开球时间的场次`
          : [
              weekdayOf(band.weekday),
              band.blocked ? '已设禁看夜' : '',
              `${band.count} 场`,
              `最晚到 ${band.latestEndClock}`,
              band.belowFloor ? `越过底线 ${fmtOver(band.overMinutes)}` : '未越线',
              band.current ? '今夜的比赛' : '',
            ]
              .filter(Boolean)
              .join('，');

        return (
          <Pressable
            key={band.date}
            onPress={() => onSelectDate(selected ? null : band.date)}
            hitSlop={{ top: 5, bottom: 5 }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            style={({ pressed }) => [
              styles.row,
              selected && styles.rowSelected,
              band.blocked && styles.rowBlocked,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.dayCol}>
              <View style={[styles.nowDot, band.current && styles.nowDotOn]} />
              <Text
                style={[
                  styles.dayText,
                  band.current && styles.dayTextNow,
                  band.blocked && styles.dayTextBlocked,
                ]}
              >
                {WEEKDAYS[band.weekday]}
              </Text>
            </View>

            <View style={styles.trackCol}>
              <View style={styles.track}>
                {placed.map(({ seg, lane }) => {
                  const tier = sleepTier(seg.t);
                  const tailStart = rowFloor ? Math.max(seg.startMin, rowFloor.nightMin) : null;
                  const hasTail = tailStart != null && seg.endMin > tailStart;
                  return (
                    <View key={seg.id}>
                      <View
                        style={[
                          styles.segment,
                          {
                            top: laneTop(lane),
                            height: laneHeight,
                            left: pct(seg.startMin),
                            width: pct(seg.endMin - seg.startMin),
                            backgroundColor: tierColor(tier.tier),
                            opacity: band.blocked ? 0.35 : 1,
                          },
                        ]}
                      />
                      {hasTail ? (
                        <View
                          style={[
                            styles.segment,
                            styles.segmentOver,
                            {
                              top: laneTop(lane),
                              height: laneHeight,
                              left: pct(tailStart as number),
                              width: pct(seg.endMin - (tailStart as number)),
                              opacity: band.blocked ? 0.35 : 1,
                            },
                          ]}
                        />
                      ) : null}
                    </View>
                  );
                })}
                {band.count === 0 ? <View style={styles.emptyLine} /> : null}
                {rowFloor ? <View style={[styles.floorLine, { left: pct(rowFloor.nightMin) }]} /> : null}
              </View>
            </View>

            <View style={styles.endCol}>
              <View style={styles.endTop}>
                {band.blocked ? <Text style={styles.blockedTag}>禁</Text> : null}
                {band.belowFloor && !band.blocked ? <TriangleAlert size={11} color={colors.warn} /> : null}
                <Text
                  style={[
                    styles.endTime,
                    band.belowFloor && !band.blocked && styles.endTimeWarn,
                    (band.empty || band.blocked) && styles.endTimeEmpty,
                  ]}
                >
                  {band.latestEndClock ?? '—'}
                </Text>
              </View>
              <Text style={styles.endCount}>
                {band.blocked ? '禁看' : band.count > 0 ? `${band.count} 场` : '—'}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {floor?.assumed ? (
        <Text style={styles.note}>
          未设作息，按默认 {floor.wakeTime} 起床 / {floor.minSleep}h 睡眠画的线；改完作息后底线才属于你。
        </Text>
      ) : null}
      {risk.tbdCount > 0 ? (
        <Text style={styles.note}>
          另有 {risk.tbdCount} 场开球时间未定，连属于哪一晚都不知道，没有画进来。
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: { gap: spacing.xs },
  headline: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  headlineWarn: { color: colors.warn },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: {
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: withAlpha(colors.text, 0.42),
  },
  legendText: { color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  axisRow: { flexDirection: 'row', alignItems: 'flex-end', minHeight: 14 },
  dayCol: { width: 18, alignItems: 'center', justifyContent: 'center', gap: 2 },
  nowDot: { width: 3, height: 3, borderRadius: radius.pill, backgroundColor: 'transparent' },
  nowDotOn: { backgroundColor: colors.accent },
  dayText: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: weight.title },
  dayTextNow: { color: colors.accent },
  dayTextBlocked: { color: colors.textFaint, textDecorationLine: 'line-through' },
  trackCol: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  tick: {
    position: 'absolute',
    top: 0,
    width: 52,
    marginLeft: -26,
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  tickFirst: { marginLeft: 0, textAlign: 'left' },
  tickLast: { marginLeft: -52, textAlign: 'right' },
  endCol: { width: 54, alignItems: 'flex-end', justifyContent: 'center', gap: 1 },
  endTop: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  blockedTag: {
    color: colors.warn,
    fontSize: 10,
    fontWeight: weight.title,
    backgroundColor: 'rgba(224,168,46,0.14)',
    paddingHorizontal: 3,
    borderRadius: 3,
    overflow: 'hidden',
  },
  endTime: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: weight.title,
    fontVariant: ['tabular-nums'],
  },
  endTimeWarn: { color: colors.warn },
  endTimeEmpty: { color: colors.textFaint, fontWeight: weight.body },
  endCount: { color: colors.textFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    borderRadius: radius.control,
    paddingHorizontal: 2,
  },
  rowSelected: {
    backgroundColor: withAlpha(colors.accent, 0.08),
  },
  rowBlocked: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  track: { height: TRACK_HEIGHT, justifyContent: 'center' },
  segment: {
    position: 'absolute',
    borderRadius: 3,
  },
  segmentOver: {
    backgroundColor: colors.warn,
  },
  emptyLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (TRACK_HEIGHT - 1) / 2,
    height: 1,
    backgroundColor: colors.hairline,
  },
  floorLine: {
    position: 'absolute',
    top: -4,
    width: 2,
    height: TRACK_HEIGHT + 8,
    borderRadius: 1,
    backgroundColor: withAlpha(colors.text, 0.42),
  },
  note: { color: colors.textFaint, fontSize: fontSize.xs, lineHeight: 16 },
  pressed: { opacity: 0.8 },
});
