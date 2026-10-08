import type { ReactNode } from 'react';

/** Holds a control on the right of a screen header. Android's native toolbar
 *  already insets it 16 dp from the edge, so nothing is added here; the web
 *  preview has its own version that adds the same inset. */
export function HeaderRight({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
