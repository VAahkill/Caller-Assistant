import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon, fonts, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';
import { BottomSheet } from './BottomSheet';
import { Divider } from './Section';
import { Text } from './Text';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  /** Extra words that match a search, e.g. the dial code. */
  keywords?: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  /** Shown in the field instead of the option label, e.g. "India (+91)". */
  display?: string;
  helper?: string;
  error?: string | null;
  placeholder?: string;
  /** A search box in the sheet; on by default for long lists. */
  searchable?: boolean;
  sheetTitle?: string;
  disabled?: boolean;
  testID?: string;
}

/** A field that opens a bottom sheet of choices. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  display,
  helper,
  error,
  placeholder = 'Choose…',
  searchable,
  sheetTitle,
  disabled,
  testID,
}: SelectProps<T>) {
  const t = useTokens();
  const c = t.color;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((o) => o.value === value);
  const shown = display ?? current?.label;
  const search = searchable ?? options.length > 12;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.description ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      <Text variant="footnote" weight="medium" color={error ? 'danger' : 'text2'}>
        {label}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown ?? placeholder}`}
        accessibilityHint={helper}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          haptic.tap();
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.field,
          {
            borderRadius: t.radius.md,
            borderColor: error ? c.danger : c.border,
            backgroundColor: pressed ? c.surface3 : c.surface2,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        {current?.icon ? <Icon name={current.icon} size={20} color={c.text2} /> : null}
        <Text variant="body" color={shown ? 'text' : 'text3'} style={styles.flex} numberOfLines={1}>
          {shown ?? placeholder}
        </Text>
        <Icon name="chevron-down" size={18} color={c.text2} />
      </Pressable>
      {error ? (
        <Text variant="footnote" color="danger">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="footnote" color="text2">
          {helper}
        </Text>
      ) : null}

      <BottomSheet visible={open} onClose={close} title={sheetTitle ?? label} scroll>
        {search ? (
          <View style={[styles.search, { backgroundColor: c.surface2, borderRadius: t.radius.md }]}>
            <Icon name="search" size={18} color={c.text3} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={c.text3}
              autoCorrect={false}
              accessibilityLabel={`Search ${label}`}
              style={[styles.searchInput, { color: c.text, fontFamily: fonts.regular }]}
            />
          </View>
        ) : null}
        <View>
          {filtered.map((o, i) => {
            const selected = o.value === value;
            return (
              <View key={`${o.value}-${i}`}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={o.description ? `${o.label}, ${o.description}` : o.label}
                  onPress={() => {
                    haptic.tap();
                    onChange(o.value);
                    close();
                  }}
                  style={({ pressed }) => [styles.option, { backgroundColor: pressed ? c.surface2 : 'transparent' }]}
                >
                  {o.icon ? <Icon name={o.icon} size={20} color={c.text2} /> : null}
                  <View style={styles.flex}>
                    <Text variant="body" weight={selected ? 'semibold' : 'regular'}>
                      {o.label}
                    </Text>
                    {o.description ? (
                      <Text variant="footnote" color="text2">
                        {o.description}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? <Icon name="checkmark" size={20} color={c.primary} /> : null}
                </Pressable>
              </View>
            );
          })}
          {filtered.length === 0 ? (
            <Text variant="subhead" color="text2" style={styles.none}>
              Nothing matches "{query}".
            </Text>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, borderWidth: 1 },
  flex: { flex: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 16, minHeight: 44, outlineWidth: 0 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10, paddingHorizontal: 4 },
  none: { paddingVertical: 16, textAlign: 'center' },
});
