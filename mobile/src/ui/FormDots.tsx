import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius } from './theme';

type Item = { result: 'W' | 'D' | 'L' };

/** 近 5 场赛果点：比赛详情与球队页共用，避免尺寸/颜色再次漂移。 */
export function FormDots({ form, size = 24 }: { form: Item[]; size?: number }) {
  return (
    <View style={styles.row}>
      {form.map((item, index) => (
        <View
          key={`${item.result}-${index}`}
          style={[
            styles.dot,
            {
              width: size,
              height: size,
              backgroundColor:
                item.result === 'W'
                  ? colors.resultWin
                  : item.result === 'L'
                    ? colors.resultLoss
                    : colors.resultDraw,
            },
          ]}
        >
          <Text style={styles.text}>{item.result}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  dot: {
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: colors.resultInk, fontSize: fontSize.xs, fontWeight: '700' },
});
