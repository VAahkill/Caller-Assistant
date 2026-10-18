import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

export interface LargeHeaderProps {
  title: string;
  subtitle?: string;
  /** Small line above the title, e.g. the date. */
  eyebrow?: string;
  /** Buttons at the right, e.g. IconButtons. */
  actions?: ReactNode;
}

/** The big title at the top of each tab, scrolled with the content. */
export function LargeHeader({ title, subtitle, eyebrow, actions }: LargeHeaderProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.text}>
        {eyebrow ? (
          <Text variant="footnote" weight="medium" color="text2">
            {eyebrow}
          </Text>
        ) : null}
        <Text variant="largeTitle" accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subhead" color="text2">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 8, paddingBottom: 4 },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 4 },
});
