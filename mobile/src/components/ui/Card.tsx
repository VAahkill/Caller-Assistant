import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';

export type CardTone = 'default' | 'primary' | 'warning' | 'danger' | 'success' | 'info';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  tone?: CardTone;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function cardColors(t: ReturnType<typeof useTokens>, tone: CardTone) {
  const c = t.color;
  switch (tone) {
    case 'primary':
      return { bg: c.primaryContainer, fg: c.onPrimaryContainer, accent: c.primary };
    case 'warning':
      return { bg: c.warningContainer, fg: c.onWarningContainer, accent: c.warning };
    case 'danger':
      return { bg: c.dangerContainer, fg: c.onDangerContainer, accent: c.danger };
    case 'success':
      return { bg: c.successContainer, fg: c.onSuccessContainer, accent: c.success };
    case 'info':
      return { bg: c.infoContainer, fg: c.onInfoContainer, accent: c.info };
    default:
      return { bg: c.surface, fg: c.text, accent: c.primary };
  }
}

/** A rounded surface. In dark mode it is separated by tone, in light mode by a soft shadow. */
export function Card({ children, onPress, tone = 'default', padded = true, style, accessibilityLabel, testID }: CardProps) {
  const t = useTokens();
  const colors = cardColors(t, tone);
  const base = [
    styles.card,
    {
      backgroundColor: colors.bg,
      borderRadius: t.radius.lg,
      padding: padded ? t.space.lg : 0,
      borderColor: t.dark || tone !== 'default' ? 'transparent' : t.color.border,
    },
    tone === 'default' ? t.elevation.level1 : null,
    style,
  ];
  if (!onPress) {
    return (
      <View style={base} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      android_ripple={{ color: t.color.surface3 }}
      style={({ pressed }) => [base, { opacity: pressed ? 0.92 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
