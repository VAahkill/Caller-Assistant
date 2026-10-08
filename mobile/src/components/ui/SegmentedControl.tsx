import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';
import { Text } from './Text';

export interface Segment<T extends string> {
  value: T;
  label: string;
  badge?: number;
}

export interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel?: string;
}

/** Two to four mutually exclusive views, e.g. Messages | Calls. */
export function SegmentedControl<T extends string>({ segments, value, onChange, accessibilityLabel }: SegmentedControlProps<T>) {
  const t = useTokens();
  const c = t.color;
  const [width, setWidth] = useState(0);
  const index = Math.max(0, segments.findIndex((s) => s.value === value));
  const x = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.spring(x, { toValue: index, useNativeDriver: true, damping: 20, stiffness: 260, mass: 1 }).start();
  }, [index, x]);

  const segWidth = width / segments.length;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 8);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: c.surface2, borderRadius: t.radius.md }]}
    >
      {width > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: segWidth,
              backgroundColor: t.dark ? c.surface3 : c.surface,
              borderRadius: t.radius.sm + 2,
              transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, segWidth] }) }],
            },
            t.elevation.level1,
          ]}
        />
      ) : null}
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={s.badge ? `${s.label}, ${s.badge} new` : s.label}
            onPress={() => {
              if (active) return;
              haptic.tap();
              onChange(s.value);
            }}
            style={styles.segment}
          >
            <Text variant="footnote" weight="semibold" color={active ? 'text' : 'text2'}>
              {s.label}
            </Text>
            {s.badge ? (
              <View style={[styles.badge, { backgroundColor: c.primary }]}>
                <Text variant="caption" color={c.onPrimary} tabular>
                  {s.badge > 99 ? '99+' : s.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, minHeight: 44 },
  thumb: { position: 'absolute', top: 4, bottom: 4, left: 4 },
  segment: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 36 },
  badge: { borderRadius: 999, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
});
