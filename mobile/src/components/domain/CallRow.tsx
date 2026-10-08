import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { prettyNumber, timeAgo } from '../../lib/format';
import { callLine, callerName, categoryOf } from '../../lib/labels';
import type { CallSummary } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { StatusPill } from '../ui/StatusPill';
import { Text } from '../ui/Text';

export interface CallRowProps {
  call: CallSummary;
  live?: boolean;
  vip?: boolean;
  onPress?: () => void;
  testID?: string;
}

/** A call in a list: who, what it was about, when, and its category. */
export function CallRow({ call, live, vip, onPress, testID }: CallRowProps) {
  const t = useTokens();
  const c = t.color;
  const cat = categoryOf(call.category);
  const name = callerName(call);
  const blocked = call.status === 'rejected';
  const outbound = call.direction === 'outbound';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${outbound ? 'Call to' : 'Call from'} ${name}, ${timeAgo(call.started_at)}. ${callLine(call)}`}
      android_ripple={{ color: c.surface3 }}
      style={({ pressed }) => [styles.row, { paddingHorizontal: t.space.lg, opacity: pressed ? 0.85 : 1 }]}
    >
      <Avatar name={call.contact_name || call.number} icon={call.category === 'delivery' ? 'bicycle' : blocked ? 'ban' : undefined} ring={vip} />
      <View style={styles.body}>
        <View style={styles.top}>
          {outbound ? <Icon name="arrow-up-outline" size={14} color={c.text2} /> : null}
          <Text variant="headline" numberOfLines={1} style={styles.flex}>
            {call.contact_name || prettyNumber(call.number) || 'Unknown caller'}
          </Text>
          <Text variant="footnote" color="text2" tabular>
            {timeAgo(call.started_at)}
          </Text>
        </View>
        <Text variant="subhead" color="text2" numberOfLines={2}>
          {callLine(call)}
        </Text>
        <View style={styles.pills}>
          {live ? <StatusPill label="Live" tone="success" dot pulse /> : null}
          {call.status === 'on_hold' ? <StatusPill label="Waiting for you" tone="warning" icon="hand-left-outline" /> : null}
          {call.urgent ? <StatusPill label="Urgent" tone="danger" icon="alert-circle-outline" /> : null}
          <StatusPill label={blocked ? 'Blocked' : cat.label} tone={blocked ? 'danger' : cat.tone} icon={blocked ? 'ban-outline' : cat.icon} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, paddingVertical: 14, alignItems: 'flex-start' },
  body: { flex: 1, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
});
