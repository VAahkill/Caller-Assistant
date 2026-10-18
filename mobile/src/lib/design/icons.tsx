import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { useTokens } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** The only icon primitive in the app: Ionicons, tinted from the theme. */
export function Icon({
  name,
  size = 22,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTokens();
  return (
    <Ionicons
      name={name}
      size={size}
      color={color ?? t.color.text}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

// Outline when idle, filled when selected, as Material and iOS tab bars do.
export const TAB_ICONS = {
  index: { idle: 'home-outline', active: 'home' },
  inbox: { idle: 'file-tray-full-outline', active: 'file-tray-full' },
  tasks: { idle: 'call-outline', active: 'call' },
  assistant: { idle: 'headset-outline', active: 'headset' },
  settings: { idle: 'settings-outline', active: 'settings' },
} as const satisfies Record<string, { idle: IconName; active: IconName }>;
