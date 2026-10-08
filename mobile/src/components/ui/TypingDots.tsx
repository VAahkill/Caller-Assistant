import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

import { useTokens } from '../../lib/design/theme';

/** Three dots that rise in turn: someone is typing, thinking or translating. */
export function TypingDots({ color, size = 7 }: { color?: string; size?: number }) {
  const t = useTokens();
  const [dots] = useState(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]);
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (!alive || reduce) return;
        loop = Animated.loop(
          Animated.stagger(
            160,
            dots.map((d) =>
              Animated.sequence([
                Animated.timing(d, { toValue: 1, duration: 280, useNativeDriver: true }),
                Animated.timing(d, { toValue: 0, duration: 280, useNativeDriver: true }),
                Animated.delay(200),
              ]),
            ),
          ),
        );
        loop.start();
      })
      .catch((e: unknown) => console.warn("Couldn't read the reduce-motion setting", e));
    return () => {
      alive = false;
      loop?.stop();
    };
  }, [dots]);
  const fill = color ?? t.color.text2;
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: fill,
            opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 14 },
});
