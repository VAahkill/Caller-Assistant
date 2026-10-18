import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTokens } from '../../lib/design/theme';
import { Text } from './Text';

export interface SectionProps {
  title?: string;
  /** Small helper under the group, e.g. what a setting does. */
  footer?: ReactNode;
  /** Text link at the right of the title, e.g. "See all". */
  action?: { label: string; onPress: () => void };
  /** Group children in one card with hairlines between them (default true). */
  grouped?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** An overline label over a grouped card of rows, like Android/iOS settings. */
export function Section({ title, footer, action, grouped = true, children, style, testID }: SectionProps) {
  const t = useTokens();
  const items = Children.toArray(children).filter((c) => isValidElement(c));
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      {title || action ? (
        <View style={[styles.head, { paddingHorizontal: t.space.xs }]}>
          {title ? (
            <Text variant="overline" color="text2" accessibilityRole="header" style={styles.flex}>
              {title}
            </Text>
          ) : (
            <View style={styles.flex} />
          )}
          {action ? (
            <Pressable accessibilityRole="button" hitSlop={12} onPress={action.onPress}>
              <Text variant="footnote" weight="semibold" color="primary">
                {action.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {grouped ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.color.surface,
              borderRadius: t.radius.lg,
              borderColor: t.dark ? 'transparent' : t.color.border,
            },
            t.elevation.level1,
          ]}
        >
          {items.map((child, i) => (
            <Fragment key={i}>
              {i > 0 ? <Divider inset={t.space.lg} /> : null}
              {child}
            </Fragment>
          ))}
        </View>
      ) : (
        <View style={{ gap: t.space.md }}>{children}</View>
      )}
      {footer ? (
        typeof footer === 'string' ? (
          <Text variant="footnote" color="text2" style={{ paddingHorizontal: t.space.xs }}>
            {footer}
          </Text>
        ) : (
          footer
        )
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const t = useTokens();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.color.border, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
  flex: { flex: 1 },
  card: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
