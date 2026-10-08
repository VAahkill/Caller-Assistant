import { contrast } from '../contrast';
import { navigationTheme, tabBarColors } from '../navigation';
import type { Palette } from '../palette';
import { accentFor, makeTokens, textStyle, type as typeScale } from '../tokens';

const schemes = ['dark', 'light'] as const;

describe.each(schemes)('%s theme', (scheme) => {
  const t = makeTokens(scheme);
  const c = t.color;
  const ratio = (fg: keyof Palette, bg: keyof Palette, base?: keyof Palette) =>
    contrast(c[fg], c[bg], base ? c[base] : undefined);

  test('inactive tab labels and icons are readable on the tab bar (>= 4.5:1)', () => {
    const tab = tabBarColors(t);
    expect(contrast(tab.inactive, tab.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tab.active, tab.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tab.onBadge, tab.badge)).toBeGreaterThanOrEqual(3);
  });

  test('navigation theme uses the app palette, not the light default', () => {
    const nav = navigationTheme(t);
    expect(nav.dark).toBe(scheme === 'dark');
    expect(nav.colors.card).toBe(c.surface);
    expect(nav.colors.text).toBe(c.text);
    expect(nav.colors.background).toBe(c.bg);
    expect(nav.fonts.regular.fontFamily).toBe('Inter_400Regular');
  });

  const textPairs: [keyof Palette, keyof Palette, (keyof Palette)?][] = [];
  for (const bg of ['bg', 'surface', 'surface2'] as const) {
    for (const fg of ['text', 'text2', 'text3', 'primary', 'success', 'warning', 'danger', 'info'] as const) {
      textPairs.push([fg, bg]);
    }
  }
  textPairs.push(
    ['text', 'surface3'],
    ['text2', 'surface3'],
    ['onPrimary', 'primary'],
    ['onPrimaryContainer', 'primaryContainer'],
    ['primary', 'primaryContainer'],
    ['success', 'successContainer'],
    ['onSuccessContainer', 'successContainer'],
    ['warning', 'warningContainer'],
    ['onWarningContainer', 'warningContainer'],
    ['danger', 'dangerContainer'],
    ['onDangerContainer', 'dangerContainer'],
    ['info', 'infoContainer'],
    ['onInfoContainer', 'infoContainer'],
    ['inverseText', 'inverseSurface'],
    ['inversePrimary', 'inverseSurface'],
    ['inverseSuccess', 'inverseSurface'],
    ['inverseDanger', 'inverseSurface'],
    ['onHero', 'heroFrom'],
    ['onHero', 'heroTo'],
    ['onHero2', 'heroFrom'],
    ['onHero2', 'heroTo'],
  );
  for (const bubble of ['bubbleCaller', 'bubbleAssistant', 'bubbleYou'] as const) {
    textPairs.push(['text', bubble], ['text2', bubble], ['text', 'translation', bubble], ['text2', 'translation', bubble]);
  }

  // One argument per row: jest treats a third parameter as a `done` callback.
  test.each(textPairs.map(([fg, bg, base]) => ({ fg, bg, base })))('$fg on $bg (over $base) meets 4.5:1', ({ fg, bg, base }) => {
    expect(ratio(fg, bg, base)).toBeGreaterThanOrEqual(4.5);
  });

  test('status dots on the hero meet the 3:1 non-text minimum', () => {
    for (const dot of ['heroSuccess', 'heroWarning'] as const) {
      for (const bg of ['heroFrom', 'heroTo'] as const) expect(ratio(dot, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  test('avatar and icon tile accents are readable', () => {
    for (const a of t.accents) expect(contrast(a.fg, a.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('accentFor is stable for the same key', () => {
    expect(accentFor(t, '+919876500001')).toBe(accentFor(t, '+919876500001'));
  });
});

test('type scale: body and transcript text have at least 1.5x line height', () => {
  for (const v of ['body', 'bodyStrong', 'callout', 'subhead'] as const) {
    expect(typeScale[v].lineHeight / typeScale[v].size).toBeGreaterThanOrEqual(1.4);
  }
  expect(typeScale.body.lineHeight / typeScale.body.size).toBeGreaterThanOrEqual(1.5);
  expect(textStyle('overline').textTransform).toBe('uppercase');
  expect(textStyle('title1').fontFamily).toBe('Inter_700Bold');
});

test('dark tokens keep the validated base palette', () => {
  const t = makeTokens('dark');
  expect(t.color.bg).toBe('#090B10');
  expect(t.color.text3).toBe('#8A92A6');
  expect(makeTokens('dark')).toBe(t);
});
