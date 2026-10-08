import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ConfirmProvider } from '../components/ui/ConfirmSheet';
import { ToastProvider } from '../components/ui/Toast';
import { ThemeProvider, type ThemePreference } from '../lib/design/theme';

export function Providers({ children, theme = 'dark' }: { children: ReactNode; theme?: ThemePreference }) {
  return (
    <ThemeProvider initial={theme}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/** Renders with the app's theme, toast and confirm providers. */
export function renderUI(ui: ReactElement, options?: RenderOptions & { theme?: ThemePreference }) {
  const theme = options?.theme;
  return render(ui, { ...options, wrapper: ({ children }) => <Providers theme={theme}>{children}</Providers> });
}
