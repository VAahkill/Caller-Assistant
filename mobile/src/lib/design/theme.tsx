import * as SystemUI from 'expo-system-ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

import { storage } from '../storage';
import { makeTokens, type Scheme, type Tokens } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'theme';

interface ThemeState {
  tokens: Tokens;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => Promise<void>;
  ready: boolean;
}

const ThemeContext = createContext<ThemeState | null>(null);

export const isThemePreference = (v: unknown): v is ThemePreference => v === 'system' || v === 'light' || v === 'dark';

// Tell Android which theme we chose so native dialogs and the navigation bar follow it.
function applyNative(pref: ThemePreference) {
  if (Platform.OS === 'web' || typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}

export function ThemeProvider({ children, initial }: { children: ReactNode; initial?: ThemePreference }) {
  const [preference, setPref] = useState<ThemePreference>(initial ?? 'system');
  const [ready, setReady] = useState(initial !== undefined);
  const system = useColorScheme();

  useEffect(() => {
    if (initial !== undefined) return;
    let alive = true;
    storage
      .get(KEY)
      .then((saved) => {
        if (!alive) return;
        if (isThemePreference(saved)) {
          setPref(saved);
          applyNative(saved);
        }
      })
      .catch((e: unknown) => console.warn("Couldn't read the theme setting", e))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [initial]);

  const scheme: Scheme = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
  const tokens = makeTokens(scheme);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    SystemUI.setBackgroundColorAsync(tokens.color.bg).catch((e: unknown) =>
      console.warn("Couldn't set the window background", e),
    );
  }, [tokens.color.bg]);

  const setPreference = useCallback(async (p: ThemePreference) => {
    setPref(p);
    applyNative(p);
    await storage.set(KEY, p);
  }, []);

  const value = useMemo(() => ({ tokens, preference, setPreference, ready }), [tokens, preference, setPreference, ready]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Design tokens for the current theme. Works outside the provider (system theme). */
export function useTokens(): Tokens {
  const ctx = useContext(ThemeContext);
  const system = useColorScheme();
  return ctx?.tokens ?? makeTokens(system === 'light' ? 'light' : 'dark');
}

export function useThemePreference(): Pick<ThemeState, 'preference' | 'setPreference' | 'ready'> {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemePreference outside ThemeProvider');
  return ctx;
}
