import { ActivityIndicator, Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';

export type IconButtonVariant = 'plain' | 'tonal' | 'filled' | 'danger' | 'inverse';

export interface IconButtonProps {
  icon: IconName;
  /** Read by TalkBack; required because the button has no visible text. */
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  onPressIn?: (e: GestureResponderEvent) => void;
  onPressOut?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  variant?: IconButtonVariant;
  size?: number;
  iconSize?: number;
  color?: string;
  selected?: boolean;
  loading?: boolean;
  disabled?: boolean;
  haptics?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  label,
  onPress,
  onPressIn,
  onPressOut,
  onLongPress,
  variant = 'plain',
  size = 40,
  iconSize,
  color,
  selected,
  loading,
  disabled,
  haptics = true,
  testID,
  style,
}: IconButtonProps) {
  const t = useTokens();
  const c = t.color;
  const palette = {
    plain: { bg: 'transparent', fg: c.text2 },
    tonal: { bg: c.surface2, fg: c.text },
    filled: { bg: c.primary, fg: c.onPrimary },
    danger: { bg: c.dangerContainer, fg: c.onDangerContainer },
    inverse: { bg: c.onHeroOverlay, fg: c.onHero },
  }[variant];
  const fg = color ?? (selected ? c.primary : palette.fg);
  const slop = Math.max(0, (t.hit - size) / 2);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, selected: !!selected, busy: !!loading }}
      disabled={disabled || loading}
      hitSlop={slop}
      onPress={(e) => {
        if (haptics) haptic.tap();
        onPress?.(e);
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onLongPress={onLongPress}
      android_ripple={{ color: c.surface3, borderless: true, radius: size / 2 + 4 }}
      style={({ pressed }) => [
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: selected && variant === 'plain' ? c.primaryContainer : palette.bg,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <View pointerEvents="none">
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          <Icon name={icon} size={iconSize ?? Math.round(size * 0.55)} color={fg} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
