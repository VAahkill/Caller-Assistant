import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { prettyNumber } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { normalizeNumber, searchContacts, type NamedNumber } from '../../lib/phone';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/SearchField';
import { Text } from '../ui/Text';

export interface ContactPickerProps {
  /** Saved contacts (synced to the server). */
  contacts: NamedNumber[];
  homeCc: string;
  /** Numbers already chosen (any format); shown ticked. */
  selected?: string[];
  /** Tap on a contact: adds it, or (multi) adds or removes it. */
  onPick: (number: string, name: string) => void;
  /** Ticks for several numbers instead of one tap to add. */
  multi?: boolean;
  /** Rows shown before "Show more". */
  pageSize?: number;
  /** Shown when there are no contacts: where to sync them. */
  onSyncContacts?: () => void;
  testID?: string;
}

/** Search the owner's saved contacts and pick numbers from them, instead of typing. */
export function ContactPicker({ contacts, homeCc, selected = [], onPick, multi, pageSize = 5, onSyncContacts, testID }: ContactPickerProps) {
  const t = useTokens();
  const c = t.color;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const chosen = new Set(selected.map((n) => normalizeNumber(n, homeCc)));
  const found = searchContacts(contacts, query);
  const shown = found.slice(0, limit);

  if (!contacts.length) {
    return (
      <View style={[styles.empty, { backgroundColor: c.surface2, borderRadius: t.radius.md }]} testID={testID}>
        <Icon name="people-outline" size={20} color={c.text2} />
        <View style={styles.flex}>
          <Text variant="subhead">No saved contacts yet</Text>
          <Text variant="footnote" color="text2">
            Sync your contacts to pick from them, or type the number.
          </Text>
        </View>
        {onSyncContacts ? <Button title="Sync" size="sm" variant="tonal" icon="sync" onPress={onSyncContacts} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      <SearchField
        value={query}
        onChangeText={(q) => {
          setQuery(q);
          setLimit(pageSize);
        }}
        placeholder="Search your contacts"
        accessibilityLabel="Search your contacts"
      />
      <View style={[styles.list, { backgroundColor: c.surface2, borderRadius: t.radius.md }]}>
        {shown.map((contact, i) => {
          const number = normalizeNumber(contact.number, homeCc);
          const on = chosen.has(number);
          const name = contact.name || prettyNumber(number);
          return (
            <Pressable
              key={number}
              onPress={() => {
                haptic.tap();
                onPick(number, contact.name);
              }}
              accessibilityRole={multi ? 'checkbox' : 'button'}
              accessibilityState={multi ? { checked: on } : undefined}
              accessibilityLabel={`${name}, ${prettyNumber(number)}`}
              android_ripple={{ color: c.surface3 }}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
            >
              <Avatar name={contact.name || number} size={36} />
              <View style={styles.flex}>
                <Text variant="callout" numberOfLines={1}>
                  {name}
                </Text>
                {contact.name ? (
                  <Text variant="footnote" color="text2" tabular>
                    {prettyNumber(number)}
                  </Text>
                ) : null}
              </View>
              <Icon
                name={multi ? (on ? 'checkbox' : 'square-outline') : on ? 'checkmark-circle' : 'add-circle-outline'}
                size={22}
                color={on ? c.primary : c.text3}
              />
            </Pressable>
          );
        })}
        {found.length === 0 ? (
          <Text variant="subhead" color="text2" style={styles.none}>
            No contact matches "{query.trim()}".
          </Text>
        ) : null}
      </View>
      {found.length > shown.length ? (
        <Button
          title={`Show ${Math.min(pageSize * 2, found.length - shown.length)} more`}
          variant="ghost"
          size="sm"
          icon="chevron-down"
          onPress={() => setLimit((l) => l + pageSize * 2)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  list: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, minHeight: 56, paddingVertical: 8 },
  flex: { flex: 1 },
  none: { padding: 14 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
});
