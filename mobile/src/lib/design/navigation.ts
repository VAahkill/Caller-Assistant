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

export const TAB_BAR_BASE_HEIGHT = 64;

/** Bottom tab bar options shared by the tab layout and its test. */
export function tabBarOptions(t: Tokens, bottomInset: number) {
  const c = tabBarColors(t);
  return {
    headerShown: false,
    tabBarActiveTintColor: c.active,
    tabBarInactiveTintColor: c.inactive,
    tabBarActiveBackgroundColor: 'transparent',
    tabBarStyle: {
      backgroundColor: c.background,
      borderTopColor: c.border,
      height: TAB_BAR_BASE_HEIGHT + bottomInset,
      paddingTop: 6,
      paddingBottom: bottomInset + 6,
      elevation: 0,
    },
    tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, fontWeight: 'normal' as const },
    tabBarBadgeStyle: { backgroundColor: c.badge, color: c.onBadge, fontFamily: fonts.semibold, fontSize: 11 },
    tabBarHideOnKeyboard: true,
    sceneStyle: { backgroundColor: t.color.bg },
  };
}

/** Header look for stack screens: flat, on the page background, Inter titles. */
export function stackOptions(t: Tokens) {
  return {
    headerStyle: { backgroundColor: t.color.bg },
    headerShadowVisible: false,
    headerTintColor: t.color.text,
    headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 17, fontWeight: 'normal' as const, color: t.color.text },
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: t.color.bg },
    animation: 'slide_from_right' as const,
  };
}
