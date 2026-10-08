import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// Web build only (screenshot checks): the browser header puts right-side
// controls flush with the edge, unlike Android's toolbar, which insets them 16 dp.
export function HeaderRight({ children }: { children: ReactNode }) {
  return <View style={styles.inset}>{children}</View>;
}

const styles = StyleSheet.create({ inset: { marginRight: 16 } });
