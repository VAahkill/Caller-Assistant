import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { clockTime } from '../../lib/format';
import type { TimelineItem } from '../../lib/tasks';
import { Text } from '../ui/Text';

const DOT = 22;

/** The steps of a call task, top to bottom: done ones ticked, the current one
 *  spinning, what is left greyed out, a failure crossed. */
export function TaskTimeline({ items, testID }: { items: TimelineItem[]; testID?: string }) {
  const t = useTokens();
  const c = t.color;
  return (
    <View testID={testID} accessibilityRole="list">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const tone = it.state === 'failed' ? c.danger : it.state === 'done' ? c.success : it.state === 'current' ? c.primary : c.text3;
        const word = { done: 'done', current: 'now', upcoming: 'next', failed: 'failed' }[it.state];
        return (
          <View
            key={it.key}
            style={styles.row}
            accessible
            accessibilityLabel={`${it.label}, ${word}${it.at ? `, ${clockTime(it.at)}` : ''}`}
            testID={testID ? `${testID}-${it.key}` : undefined}
          >
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  {
                    borderColor: it.state === 'current' ? c.primaryContainer : tone,
                    backgroundColor: it.state === 'done' || it.state === 'failed' ? tone : it.state === 'current' ? c.primaryContainer : 'transparent',
                  },
                ]}
              >
                {it.state === 'done' ? <Icon name="checkmark" size={14} color={c.bg} /> : null}
                {it.state === 'failed' ? <Icon name="close" size={14} color={c.bg} /> : null}
                {it.state === 'current' ? <ActivityIndicator size={14} color={c.primary} /> : null}
              </View>
              {!last ? <View style={[styles.line, { backgroundColor: it.state === 'done' ? c.success : c.border }]} /> : null}
            </View>
            <View style={[styles.body, !last && styles.gap]}>
              <Text
                variant="subhead"
                weight={it.state === 'current' || it.state === 'failed' ? 'semibold' : 'regular'}
                color={it.state === 'upcoming' ? 'text3' : it.state === 'failed' ? 'danger' : 'text'}
                style={styles.flex}
              >
                {it.label}
              </Text>
              {it.at ? (
                <Text variant="footnote" color="text2" tabular>
                  {clockTime(it.at)}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: DOT, alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, minHeight: 10, marginVertical: 2, borderRadius: 1 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: DOT, paddingTop: 1 },
  gap: { paddingBottom: 12 },
  flex: { flex: 1 },
});
