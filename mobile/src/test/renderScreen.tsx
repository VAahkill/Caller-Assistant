import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { LiveProvider } from '../lib/live';
import { Providers } from './render';

/** Renders a whole screen as the app does: theme, toasts, confirms and the live socket. */
export function renderScreen(ui: ReactElement, options?: RenderOptions) {
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <Providers>
        <LiveProvider>{children}</LiveProvider>
      </Providers>
    ),
  });
}
