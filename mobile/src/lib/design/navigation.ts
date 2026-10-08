import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

import { fonts, type Tokens } from './tokens';

// React Navigation draws the tab bar, headers and screen backgrounds from this
// theme. Without it, it falls back to the light default and inactive tab icons
// vanish on a dark tab bar (owner item 9).
export function navigationTheme(t: Tokens): Theme {
  const base = t.dark ? DarkTheme : DefaultTheme;
  // Each Inter weight is its own font family, so the weight stays 'normal' to
  // avoid Android drawing a synthetic bold on top.
  const face = (family: string) => ({ fontFamily: family, fontWeight: 'normal' as const });
  return {
    ...base,
    dark: t.dark,
    colors: {
      primary: t.color.primary,
      background: t.color.bg,
      card: t.color.surface,
      text: t.color.text,
      border: t.color.border,
      notification: t.color.danger,
    },
    fonts: {
      regular: face(fonts.regular),
      medium: face(fonts.medium),
      bold: face(fonts.semibold),
      heavy: face(fonts.bold),
    },
  };
}

/** Colours for the bottom tab bar; the contrast test checks these. */
export function tabBarColors(t: Tokens) {
  return {
    background: t.color.surface,
    border: t.color.border,
    active: t.color.primary,
    inactive: t.color.text3,
    badge: t.color.danger,
    onBadge: t.dark ? t.color.onPrimary : '#FFFFFF',
  };
}
