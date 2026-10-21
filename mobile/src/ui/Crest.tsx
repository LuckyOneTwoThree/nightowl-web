import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { teamColor } from '@data/index.js';

import { crestSource } from '@/data/crests';
import { radius } from './theme';

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return `rgba(148, 160, 178, ${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function Crest({ id, size = 36 }: { id: string; size?: number }) {
  const source = crestSource(id);
  if (source) {
    return (
      <Image
        source={source}
        style={{ width: size, height: size }}
        contentFit="contain"
        transition={120}
        accessibilityLabel={id}
      />
    );
  }

  const color = teamColor(id) || '#64748B';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(color, 0.16),
        borderWidth: 1,
        borderColor: withAlpha(color, 0.55),
      }}
    >
      <Text
        style={{
          color,
          fontSize: Math.max(9, Math.round(size * 0.28)),
          fontWeight: '700',
          letterSpacing: 0.2,
        }}
      >
        {id}
      </Text>
    </View>
  );
}
