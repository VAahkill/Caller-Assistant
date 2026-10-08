import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { duration } from '../../lib/format';
import { languageTag } from '../../lib/languages';
import { outboxLabel, type OutboxItem } from '../../lib/outbox';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

export interface OutboxBubbleProps {
  item: OutboxItem;
  /** Name over the bubble, e.g. "You" or "You (caller)". */
  label: string;
  assistantName: string;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
}

/** Something just sent that the transcript doesn't show yet: sending, sent, or failed with Retry. */
export function OutboxBubble({ item, label, assistantName, onRetry, onRemove }: OutboxBubbleProps) {
  const t = useTokens();
  const c = t.color;
  const mine = item.speaker === 'user';
  const failed = item.state === 'failed';
  const bg = failed ? c.dangerContainer : mine ? c.bubbleYou : c.bubbleCaller;
  const fg = failed ? c.onDangerContainer : c.text;
  const sub = failed ? c.onDangerContainer : c.text2;
  const voice = item.kind === 'voice';
  const status = outboxLabel(item, assistantName);

  return (
    <View style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]} testID={`outbox-${item.state}`}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bg,
            borderRadius: t.radius.lg,
            borderTopLeftRadius: mine ? t.radius.lg : 6,
            borderTopRightRadius: mine ? 6 : t.radius.lg,
            opacity: item.state === 'sending' ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.meta}>
          <Text variant="caption" weight="semibold" color={sub} numberOfLines={1} style={styles.shrink}>
            {label}
          </Text>
          {item.lang ? (
            <View style={[styles.tag, { backgroundColor: c.overlay }]}>
              <Text variant="caption" weight="semibold" color={sub} style={styles.tagText}>
                {languageTag(item.lang)}
              </Text>
            </View>
          ) : null}
        </View>
        {voice ? (
          <View style={styles.voice}>
            <Icon name="mic" size={16} color={sub} />
            <Text variant="callout" color={fg}>
              Voice message{item.seconds ? ` · ${duration(item.seconds)}` : ''}
            </Text>
          </View>
        ) : null}
        {item.text ? (
          <Text variant="body" color={fg} selectable>
            {voice ? `"${item.text}"` : item.text}
          </Text>
        ) : null}
        <View style={styles.meta} accessibilityLiveRegion="polite">
          {item.state === 'sending' ? (
            <ActivityIndicator size="small" color={sub} style={styles.spinner} />
          ) : (
            <Icon name={failed ? 'alert-circle' : 'checkmark-done'} size={14} color={failed ? c.onDangerContainer : c.primary} />
          )}
          <Text variant="caption" color={sub} style={styles.shrink}>
            {failed && item.error ? `${status}: ${item.error}` : status}
          </Text>
        </View>
        {failed ? (
          <View style={styles.actions}>
            {onRemove ? <Button title="Remove" variant="ghost" size="sm" onPress={() => onRemove(item.id)} /> : null}
            {onRetry ? <Button title="Retry" icon="refresh" variant="filled" size="sm" onPress={() => onRetry(item.id)} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { borderRadius: 4, paddingHorizontal: 5, height: 16, justifyContent: 'center' },
  tagText: { fontSize: 10, lineHeight: 14 },
  shrink: { flexShrink: 1 },
  spinner: { transform: [{ scale: 0.7 }], width: 14, height: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
