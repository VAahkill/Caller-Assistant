import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { accentFor } from '../../lib/design/tokens';
import { Text } from './Text';

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (/^\+?\d/.test(words[0])) return '';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export interface AvatarProps {
  /** Contact name, or a number when there is no name. */
  name: string;
  size?: number;
  /** Shown instead of initials, e.g. 'bicycle-outline' for delivery. */
  icon?: IconName;
  /** A small ring for VIP callers. */
  ring?: boolean;
}

export function Avatar({ name, size = 40, icon, ring }: AvatarProps) {
  const t = useTokens();
  const accent = accentFor(t, name || '?');
  const text = icon ? '' : initials(name);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: accent.bg,
          borderWidth: ring ? 2 : 0,
          borderColor: t.color.warning,
        },
      ]}
    >
      {text ? (
        <Text variant={size >= 48 ? 'headline' : 'footnote'} weight="semibold" color={accent.fg} maxFontSizeMultiplier={1.2}>
          {text}
        </Text>
      ) : (
        <Icon name={icon ?? 'person'} size={Math.round(size * 0.48)} color={accent.fg} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
