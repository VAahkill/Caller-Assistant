import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { useTokens } from '../../lib/design/theme';

export function Skeleton({ width = '100%', height = 14, radius }: { width?: DimensionValue; height?: number; radius?: number }) {
  const t = useTokens();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (!alive || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch((e: unknown) => console.warn("Couldn't read the reduce-motion setting", e));
    return () => {
      alive = false;
      loop?.stop();
    };
  }, [pulse]);
  return (
    <Animated.View
      style={{ width, height, borderRadius: radius ?? t.radius.sm, backgroundColor: t.color.surface3, opacity: pulse }}
    />
  );
}

/** Placeholder rows shaped like list items while the first load runs. */
export function SkeletonRows({ rows = 3, avatar = true }: { rows?: number; avatar?: boolean }) {
  const t = useTokens();
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      testID="skeleton"
      style={[styles.card, { backgroundColor: t.color.surface, borderRadius: t.radius.lg }]}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          {avatar ? <Skeleton width={40} height={40} radius={20} /> : null}
          <View style={styles.lines}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="85%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  lines: { flex: 1, gap: 8 },
});
