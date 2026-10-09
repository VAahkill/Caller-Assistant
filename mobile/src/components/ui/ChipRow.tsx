import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { useTokens } from '../../lib/design/theme';

/** A row of chips that scrolls sideways, edge to edge past the screen gutter. */
export function ChipRow({ children, testID }: { children: ReactNode; testID?: string }) {
  const t = useTokens();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginHorizontal: -t.space.lg }}
      contentContainerStyle={[styles.row, { paddingHorizontal: t.space.lg }]}
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
});
