import { Pressable, StyleSheet, View } from 'react-native';

import type { IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { expiryText, isExpired } from '../../lib/rules';
import { Card } from '../ui/Card';
import { StatusPill } from '../ui/StatusPill';
import { Switch } from '../ui/Switch';
import { Text } from '../ui/Text';

export interface RuleCardProps {
  text: string;
  enabled: boolean;
  audience: string;
  audienceIcon?: IconName;
  category?: string;
  expiresAt: number | null;
  numbers?: string[];
  onToggle: (enabled: boolean) => void;
  onPress: () => void;
  toggleBusy?: boolean;
  testID?: string;
}

/** One instruction or note: the text, who it is for, when it ends, and an on/off switch.
 *  The text opens the editor and the switch is its own control, so TalkBack reaches both. */
export function RuleCard({ text, enabled, audience, audienceIcon, category, expiresAt, numbers, onToggle, onPress, toggleBusy, testID }: RuleCardProps) {
  const t = useTokens();
  const ended = isExpired(expiresAt);
  const until = expiryText(expiresAt);
  const active = enabled && !ended;
  const who = numbers?.length ? `${audience} (${numbers.length})` : audience;
  return (
    <Card padded={false} testID={testID}>
      <View style={styles.row}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${text}. ${who}.${until ? ` ${until}.` : ''}`}
          accessibilityHint="Opens the editor"
          android_ripple={{ color: t.color.surface3 }}
          style={({ pressed }) => [styles.body, { padding: t.space.lg, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text variant="body" color={active ? 'text' : 'text2'} numberOfLines={4}>
            {text}
          </Text>
          <View style={styles.pills}>
            <StatusPill label={who} icon={audienceIcon ?? 'people-outline'} tone={active ? 'primary' : 'neutral'} />
            {category ? <StatusPill label={category} tone="neutral" /> : null}
            {until ? <StatusPill label={until} icon="time-outline" tone={ended ? 'warning' : 'neutral'} /> : null}
          </View>
        </Pressable>
        <View style={[styles.toggle, { paddingTop: t.space.lg, paddingRight: t.space.md }]}>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            busy={toggleBusy}
            accessibilityLabel={enabled ? `${text}: on` : `${text}: off`}
            testID={testID ? `${testID}-switch` : undefined}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  body: { flex: 1, gap: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  toggle: {},
});
