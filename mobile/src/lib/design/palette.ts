// Semantic colours for both themes. Every text/background pair used by the
// components is checked for WCAG contrast in design.test.ts.

export interface Palette {
  bg: string; // screen background
  surface: string; // cards, tab bar, sheets
  surface2: string; // raised rows, inputs, caller bubbles
  surface3: string; // pressed states, skeletons
  border: string;
  borderStrong: string;
  text: string;
  text2: string; // secondary text
  text3: string; // tertiary text, inactive tab labels
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  success: string;
  successContainer: string;
  onSuccessContainer: string;
  warning: string;
  warningContainer: string;
  onWarningContainer: string;
  danger: string;
  dangerContainer: string;
  onDangerContainer: string;
  info: string;
  infoContainer: string;
  onInfoContainer: string;
  inverseSurface: string; // toasts
  inverseText: string;
  inversePrimary: string;
  inverseSuccess: string;
  inverseDanger: string;
  bubbleCaller: string;
  bubbleAssistant: string;
  bubbleYou: string;
  translation: string; // tint behind the translated line in a bubble
  scrim: string;
  overlay: string; // faint wash for tags on any surface
  onHeroOverlay: string; // buttons on the hero gradient
  heroFrom: string; // Today hero gradient
  heroTo: string;
  onHero: string;
  onHero2: string;
  heroSuccess: string; // status dots on the hero
  heroWarning: string;
}

export const dark: Palette = {
  bg: '#090B10',
  surface: '#161A24',
  surface2: '#1C212C',
  surface3: '#252B38',
  border: '#2E3546',
  borderStrong: '#3D4559',
  text: '#ECEEF4',
  text2: '#A9B0C0',
  text3: '#8A92A6',
  primary: '#8C94FF',
  onPrimary: '#090B10',
  primaryContainer: '#2A2F62',
  onPrimaryContainer: '#DADDFF',
  success: '#3DD68C',
  successContainer: '#0F2E20',
  onSuccessContainer: '#9FF0C6',
  warning: '#F5B544',
  warningContainer: '#3A2C0E',
  onWarningContainer: '#FFD98F',
  danger: '#FF7A7A',
  dangerContainer: '#3D1717',
  onDangerContainer: '#FFC2C2',
  info: '#6CC4FF',
  infoContainer: '#0E2A3D',
  onInfoContainer: '#B8E2FF',
  inverseSurface: '#ECEEF4',
  inverseText: '#12141C',
  inversePrimary: '#4F46E5',
  inverseSuccess: '#0E7340',
  inverseDanger: '#B92323',
  bubbleCaller: '#1C212C',
  bubbleAssistant: '#2A2F62',
  bubbleYou: '#173A2B',
  translation: 'rgba(140, 148, 255, 0.10)',
  scrim: 'rgba(0, 0, 0, 0.6)',
  overlay: 'rgba(255, 255, 255, 0.08)',
  onHeroOverlay: 'rgba(255, 255, 255, 0.16)',
  heroFrom: '#3A3F9E',
  heroTo: '#1A1D45',
  onHero: '#FFFFFF',
  onHero2: '#D3D6FF',
  heroSuccess: '#3DD68C',
  heroWarning: '#F5B544',
};

export const light: Palette = {
  bg: '#F5F6FA',
  surface: '#FFFFFF',
  surface2: '#F0F1F6',
  surface3: '#E6E8F0',
  border: '#DDE0EA',
  borderStrong: '#B9BED0',
  text: '#12141C',
  text2: '#4E5568',
  text3: '#61687C',
  primary: '#4F46E5',
  onPrimary: '#FFFFFF',
  primaryContainer: '#DCDFFE',
  onPrimaryContainer: '#1E1A6B',
  success: '#0E7340',
  successContainer: '#DDF5E8',
  onSuccessContainer: '#0B4F2E',
  warning: '#8F5400',
  warningContainer: '#FFF1D6',
  onWarningContainer: '#5C3700',
  danger: '#B92323',
  dangerContainer: '#FDE3E3',
  onDangerContainer: '#7A1414',
  info: '#0B6BAF',
  infoContainer: '#DDEFFC',
  onInfoContainer: '#073E66',
  inverseSurface: '#1C1F2A',
  inverseText: '#F3F4F8',
  inversePrimary: '#A9AFFF',
  inverseSuccess: '#3DD68C',
  inverseDanger: '#FF7A7A',
  bubbleCaller: '#F0F1F6',
  bubbleAssistant: '#E5E7FF',
  bubbleYou: '#DDF5E8',
  translation: 'rgba(79, 70, 229, 0.07)',
  scrim: 'rgba(18, 20, 28, 0.45)',
  overlay: 'rgba(0, 0, 0, 0.06)',
  onHeroOverlay: 'rgba(255, 255, 255, 0.18)',
  heroFrom: '#5048E5',
  heroTo: '#2E2A8F',
  onHero: '#FFFFFF',
  onHero2: '#E0E2FF',
  heroSuccess: '#3DD68C',
  heroWarning: '#F5B544',
};

// Tinted tiles for avatars and setting icons, picked by a stable hash.
export interface Accent {
  bg: string;
  fg: string;
}

export const accentsDark: Accent[] = [
  { bg: '#2A2F62', fg: '#C9CDFF' },
  { bg: '#163A33', fg: '#8FE5CF' },
  { bg: '#3A2A12', fg: '#F7C97A' },
  { bg: '#3B1D2E', fg: '#F5A9CF' },
  { bg: '#13304A', fg: '#9CD3FF' },
  { bg: '#2E2346', fg: '#D2B8FF' },
  { bg: '#1F3518', fg: '#B5E59A' },
  { bg: '#3D2019', fg: '#FFB49E' },
];

export const accentsLight: Accent[] = [
  { bg: '#E3E5FF', fg: '#2F2A9E' },
  { bg: '#D9F3EC', fg: '#0D5B49' },
  { bg: '#FCEBD0', fg: '#7A4A00' },
  { bg: '#FBE0EE', fg: '#8A1F55' },
  { bg: '#DCEEFD', fg: '#0E4C7A' },
  { bg: '#ECE3FD', fg: '#4F2A99' },
  { bg: '#E3F4DA', fg: '#2F5E14' },
  { bg: '#FDE4DC', fg: '#8A2E14' },
];
