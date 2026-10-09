import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { CALLER_KINDS, notesForCaller, rulesForCaller, type CallerKind } from '../../lib/rules';
import type { Instruction, KnowledgeNote } from '../../lib/types';
import { Card } from '../ui/Card';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Text } from '../ui/Text';

export interface CallerPreviewProps {
  assistant: string;
  /** Instructions to check; leave out on the notes screen. */
  instructions?: Instruction[];
  notes?: KnowledgeNote[];
  testID?: string;
}

const SHORT: Record<CallerKind, string> = { contact: 'Contact', unknown: 'Unknown', delivery: 'Delivery' };
const WHO: Record<CallerKind, string> = {
  contact: 'a saved contact',
  unknown: 'an unknown number',
  delivery: 'a delivery partner',
};

/** "Who's calling?": pick a kind of caller and see which rules the assistant
 *  follows and what it may tell them. Only rules that are on and not ended count. */
export function CallerPreview({ assistant, instructions, notes, testID }: CallerPreviewProps) {
  const t = useTokens();
  const [kind, setKind] = useState<CallerKind>('delivery');
  const rules = instructions ? rulesForCaller(instructions, kind) : null;
  const facts = notes ? notesForCaller(notes, kind) : null;

  return (
    <View style={styles.wrap} testID={testID}>
      <SegmentedControl
        segments={CALLER_KINDS.map((k) => ({ value: k.value, label: SHORT[k.value] }))}
        value={kind}
        onChange={setKind}
        accessibilityLabel="Who is calling"
      />
      <Card>
        {rules ? (
          <View style={styles.block}>
            <Text variant="footnote" weight="semibold" color="text2">
              When {WHO[kind]} calls, {assistant} will
            </Text>
            {rules.length ? (
              rules.map((r) => <Bullet key={r.id} icon="checkmark-circle" text={r.text} color={t.color.success} />)
            ) : (
              <Text variant="subhead" color="text2">
                Answer politely, find out what they need and take a message. No instruction is set for these calls.
              </Text>
            )}
          </View>
        ) : null}
        {facts ? (
          <View style={styles.block}>
            <Text variant="footnote" weight="semibold" color="text2">
              {assistant} may tell them
            </Text>
            {facts.length ? (
              facts.map((n) => <Bullet key={n.id} icon="chatbubble-ellipses-outline" text={n.text} color={t.color.primary} />)
            ) : (
              <Text variant="subhead" color="text2">
                Nothing from your notes. If they ask, it checks with you first.
              </Text>
            )}
          </View>
        ) : null}
        <View style={styles.never}>
          <Icon name="shield-checkmark-outline" size={16} color={t.color.text2} />
          <Text variant="footnote" color="text2" style={styles.flex}>
            Never shared with anyone: OTPs, PINs, passwords, card or account numbers, balances, Aadhaar or PAN.
          </Text>
        </View>
      </Card>
    </View>
  );
}

function Bullet({ icon, text, color }: { icon: 'checkmark-circle' | 'chatbubble-ellipses-outline'; text: string; color: string }) {
  return (
    <View style={styles.bullet}>
      <Icon name={icon} size={18} color={color} style={styles.bulletIcon} />
      <Text variant="subhead" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  block: { gap: 8 },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletIcon: { marginTop: 1 },
  never: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
