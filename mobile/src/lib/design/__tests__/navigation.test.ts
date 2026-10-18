import { contrast } from '../contrast';
import { navigationTheme, stackOptions, tabBarColors, tabBarOptions, TAB_BAR_BASE_HEIGHT } from '../navigation';
import { makeTokens } from '../tokens';

describe.each(['dark', 'light'] as const)('%s navigation', (scheme) => {
  const t = makeTokens(scheme);

  test('tab bar uses text3 for inactive tabs, readable on the bar (owner item 9)', () => {
    const o = tabBarOptions(t, 24);
    expect(o.tabBarInactiveTintColor).toBe(t.color.text3);
    expect(o.tabBarActiveTintColor).toBe(t.color.primary);
    expect(o.tabBarStyle.backgroundColor).toBe(tabBarColors(t).background);
    expect(contrast(o.tabBarInactiveTintColor, o.tabBarStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(o.tabBarActiveTintColor, o.tabBarStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });

  test('tab bar clears the gesture bar and labels use Inter', () => {
    const o = tabBarOptions(t, 24);
    expect(o.tabBarStyle.height).toBe(TAB_BAR_BASE_HEIGHT + 24);
    expect(o.tabBarStyle.paddingBottom).toBe(30);
    expect(o.tabBarLabelStyle.fontFamily).toMatch(/^Inter_/);
    expect(o.headerShown).toBe(false);
  });

  test('the navigation theme and stack headers come from the tokens, never the light default', () => {
    const nav = navigationTheme(t);
    expect(nav.dark).toBe(scheme === 'dark');
    expect(nav.colors.background).toBe(t.color.bg);
    expect(nav.colors.card).toBe(t.color.surface);
    expect(nav.colors.text).toBe(t.color.text);
    const s = stackOptions(t);
    expect(s.headerStyle.backgroundColor).toBe(t.color.bg);
    expect(s.contentStyle.backgroundColor).toBe(t.color.bg);
    expect(contrast(s.headerTintColor, s.headerStyle.backgroundColor)).toBeGreaterThanOrEqual(7);
  });
});
