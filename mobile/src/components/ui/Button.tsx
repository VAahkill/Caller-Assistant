import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityState,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import type { Tokens } from '../../lib/design/tokens';
import { haptic } from '../../lib/haptics';
import { Text } from './Text';

export type ButtonVariant = 'filled' | 'tonal' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  /** Shows a spinner and ignores presses. */
  loading?: boolean;
  /** Briefly shows a tick and `successTitle` after an action worked. */
  success?: boolean;
  successTitle?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  haptics?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 48, lg: 56 };
const PAD: Record<ButtonSize, number> = { sm: 14, md: 20, lg: 24 };

export function buttonColors(t: Tokens, variant: ButtonVariant) {
  const c = t.color;
  switch (variant) {
    case 'filled':
      return { bg: c.primary, fg: c.onPrimary, border: c.primary, ripple: 'rgba(255,255,255,0.2)' };
    case 'tonal':
      return { bg: c.primaryContainer, fg: c.onPrimaryContainer, border: c.primaryContainer, ripple: c.surface3 };
    case 'outline':
      return { bg: 'transparent', fg: c.primary, border: c.borderStrong, ripple: c.surface3 };
    case 'ghost':
      return { bg: 'transparent', fg: c.primary, border: 'transparent', ripple: c.surface3 };
    case 'destructive':
      return { bg: c.dangerContainer, fg: c.onDangerContainer, border: c.dangerContainer, ripple: c.surface3 };
  }
}

export function Button({
  title,
  onPress,
  variant = 'filled',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  success = false,
  successTitle = 'Done',
  disabled = false,
  fullWidth = false,
  haptics = true,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const t = useTokens();
  const scale = useRef(new Animated.Value(1)).current;
  const colors = buttonColors(t, variant);
  const inactive = disabled || loading;
  const showSuccess = success && !loading;
  const fg = showSuccess && (variant === 'outline' || variant === 'ghost') ? t.color.success : colors.fg;
  const label = showSuccess ? successTitle : title;
  const iconSize = size === 'sm' ? 16 : 20;
  const a11yState: AccessibilityState = { disabled: inactive, busy: loading };

  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();

  return (
    <Animated.View style={[{ transform: [{ scale }] }, fullWidth && styles.full, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityHint={accessibilityHint}
        accessibilityState={a11yState}
        disabled={inactive}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        onPress={(e) => {
          if (haptics) haptic.tap();
          onPress?.(e);
        }}
        android_ripple={{ color: colors.ripple, borderless: false }}
        style={({ pressed }) => [
          styles.base,
          {
            minHeight: HEIGHT[size],
            paddingHorizontal: PAD[size],
            borderRadius: size === 'sm' ? t.radius.pill : t.radius.md,
            backgroundColor: colors.bg,
            borderColor: colors.border,
            borderWidth: variant === 'outline' ? 1 : 0,
            opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
          },
        ]}
      >
        <View style={styles.row}>
          {loading ? (
            <ActivityIndicator testID={testID ? `${testID}-spinner` : 'button-spinner'} size="small" color={fg} />
          ) : showSuccess ? (
            <Icon name="checkmark-circle" size={iconSize} color={fg} />
          ) : icon ? (
            <Icon name={icon} size={iconSize} color={fg} />
          ) : null}
          <Text variant={size === 'sm' ? 'footnote' : 'button'} weight="semibold" color={fg} numberOfLines={1}>
            {label}
          </Text>
          {iconRight && !loading && !showSuccess ? <Icon name={iconRight} size={iconSize} color={fg} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  full: { alignSelf: 'stretch' },
});
