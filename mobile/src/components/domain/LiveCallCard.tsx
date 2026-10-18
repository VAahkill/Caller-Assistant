import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import type { CallView } from '../../lib/events';
import { timeAgo } from '../../lib/format';
import { callerName, categoryOf } from '../../lib/labels';
import { languageName } from '../../lib/languages';
import { liveStatus } from '../../lib/liveStatus';
import { Avatar } from '../ui/Avatar';
import { StatusPill } from '../ui/StatusPill';
import { Text } from '../ui/Text';
import { TypingDots } from '../ui/TypingDots';

export interface LiveCallCardProps {
  view: CallView;
  assistantName: string;
  ownerLanguage: string;
  onPress: () => void;
  testID?: string;
}

/** A call in progress on Today: who, what the assistant is doing, and the last
 *  thing said, in the owner's language when a translation is there. */
export function LiveCallCard({ view, assistantName, ownerLanguage, onPress, testID }: LiveCallCardProps) {
  const t = useTokens();
  const c = t.color;
  const call = view.record;
  const name = callerName(call);
  const onHold = call.status === 'on_hold';
  const status = liveStatus({ state: view.status, detail: view.statusDetail, assistantName, onHold });
  const last = [...call.transcript].reverse().find((l) => l.kind !== 'alert' && l.speaker !== 'system');
  const lastText = last ? (last.lang !== ownerLanguage && last.translation ? last.translation : last.text) : '';
  const who = last ? (last.speaker === 'caller' ? 'Caller' : last.speaker === 'user' ? 'You' : assistantName) : '';
  const language = view.language || call.language;
  const cat = categoryOf(call.category);
  const accent = onHold ? c.warning : status.busy ? c.primary : c.success;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Live call with ${name}. ${status.title}.${lastText ? ` ${who}: ${lastText}` : ''}`}
      accessibilityHint="Opens the call"
      android_ripple={{ color: c.surface3 }}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.surface, borderRadius: t.radius.lg, borderColor: t.dark ? 'transparent' : c.border, opacity: pressed ? 0.9 : 1 },
        t.elevation.level1,
      ]}
    >
      <View style={styles.head}>
        <Avatar name={call.contact_name || call.number} size={44} icon={call.category === 'delivery' ? 'bicycle' : undefined} />
        <View style={styles.flex}>
          <View style={styles.row}>
            <Text variant="headline" numberOfLines={1} style={styles.shrink}>
              {name}
            </Text>
            <Text variant="footnote" color="text2" tabular>
              {timeAgo(call.started_at)}
            </Text>
          </View>
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text variant="subhead" weight="medium" color={onHold ? 'warning' : 'text'} numberOfLines={1} style={styles.shrink}>
              {status.title}
            </Text>
            {status.busy ? <TypingDots color={accent} size={5} /> : null}
          </View>
        </View>
        <Icon name="chevron-forward" size={18} color={c.text3} />
      </View>
      {lastText ? (
        <View style={[styles.quote, { backgroundColor: c.surface2, borderRadius: t.radius.md }]}>
          <Text variant="caption" weight="semibold" color="text2">
            {who}
          </Text>
          <Text variant="callout" numberOfLines={2}>
            {lastText}
          </Text>
        </View>
      ) : null}
      <View style={styles.pills}>
        <StatusPill label={cat.label} tone={cat.tone} icon={cat.icon} />
        {language ? <StatusPill label={languageName(language)} tone="info" icon="language-outline" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1, flexGrow: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  quote: { paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
