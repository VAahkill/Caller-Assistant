import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import { accentsDark, accentsLight, dark, light, type Accent, type Palette } from './palette';

export type Scheme = 'light' | 'dark';

// 4-point spacing scale. 16 is the screen gutter, 12 between cards, 8 inside one.
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  x3: 32,
  x4: 40,
  x5: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

// Minimum touch target (Material: 48dp).
export const hit = 48;

export const motion = {
  press: 150,
  enter: 220,
  exit: 180,
  toast: 4000,
  toastWithAction: 6000,
  spring: { damping: 18, stiffness: 220, mass: 1 },
} as const;

// Inter weights embedded in the app (see app.json expo-font plugin).
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type FontWeightName = keyof typeof fonts;

export interface TypeStyle {
  size: number;
  lineHeight: number;
  weight: FontWeightName;
  letterSpacing?: number;
  uppercase?: boolean;
}

export const type = {
  largeTitle: { size: 30, lineHeight: 38, weight: 'bold', letterSpacing: -0.4 },
  title1: { size: 24, lineHeight: 32, weight: 'bold', letterSpacing: -0.2 },
  title2: { size: 20, lineHeight: 28, weight: 'semibold' },
  headline: { size: 17, lineHeight: 24, weight: 'semibold' },
  body: { size: 16, lineHeight: 24, weight: 'regular' },
  bodyStrong: { size: 16, lineHeight: 24, weight: 'semibold' },
  callout: { size: 15, lineHeight: 22, weight: 'medium' },
  subhead: { size: 14, lineHeight: 20, weight: 'regular' },
  footnote: { size: 13, lineHeight: 18, weight: 'regular' },
  caption: { size: 12, lineHeight: 16, weight: 'medium' },
  overline: { size: 12, lineHeight: 16, weight: 'semibold', letterSpacing: 0.6, uppercase: true },
  button: { size: 15, lineHeight: 20, weight: 'semibold' },
  tab: { size: 12, lineHeight: 16, weight: 'medium' },
} satisfies Record<string, TypeStyle>;

export type TextVariant = keyof typeof type;

// Telugu, Tamil and Devanagari stack vowel signs above and below the line, so
// any text in those scripts gets at least 1.6x line height.
export const INDIC_LINE_HEIGHT = 1.6;

export function textStyle(variant: TextVariant): TextStyle {
  const t: TypeStyle = type[variant];
  return {
    fontFamily: fonts[t.weight],
    fontSize: t.size,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    textTransform: t.uppercase ? 'uppercase' : undefined,
  };
}

export interface Elevation {
  level0: ViewStyle;
  level1: ViewStyle;
  level2: ViewStyle;
  level3: ViewStyle;
}

// Dark mode separates surfaces by tone, so shadows only appear in light mode.
function elevation(scheme: Scheme): Elevation {
  if (scheme === 'dark') {
    return { level0: {}, level1: {}, level2: {}, level3: { elevation: 6, shadowColor: '#000' } };
  }
  const shadow = (opacity: number, r: number, y: number, androidElevation: number): ViewStyle =>
    Platform.select<ViewStyle>({
      android: { elevation: androidElevation, shadowColor: '#1B1F3B' },
      default: {
        shadowColor: '#1B1F3B',
        shadowOpacity: opacity,
        shadowRadius: r,
        shadowOffset: { width: 0, height: y },
      },
    });
  return {
    level0: {},
    level1: shadow(0.06, 8, 2, 1),
    level2: shadow(0.1, 16, 6, 3),
    level3: shadow(0.16, 24, 10, 8),
  };
}

export interface Tokens {
  scheme: Scheme;
  dark: boolean;
  color: Palette;
  accents: Accent[];
  space: typeof space;
  radius: typeof radius;
  elevation: Elevation;
  motion: typeof motion;
  hit: number;
}

const cache: Partial<Record<Scheme, Tokens>> = {};

export function makeTokens(scheme: Scheme): Tokens {
  const hit_ = cache[scheme];
  if (hit_) return hit_;
  const tokens: Tokens = {
    scheme,
    dark: scheme === 'dark',
    color: scheme === 'dark' ? dark : light,
    accents: scheme === 'dark' ? accentsDark : accentsLight,
    space,
    radius,
    elevation: elevation(scheme),
    motion,
    hit,
  };
  cache[scheme] = tokens;
  return tokens;
}

/** Stable accent for a name or number, so a caller keeps the same avatar colour. */
export function accentFor(tokens: Tokens, key: string): Accent {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return tokens.accents[h % tokens.accents.length];
}
