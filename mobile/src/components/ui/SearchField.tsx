import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { Icon, fonts } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { IconButton } from './IconButton';

export interface SearchFieldProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  /** Spoken name of the box (the placeholder is not always read out). */
  accessibilityLabel?: string;
  testID?: string;
}

const WEB_ONE_ROW = Platform.OS === 'web' ? { rows: 1 } : null;

/** A compact search box for the top of a list: icon, text, and a clear button. */
export function SearchField({ value, onChangeText, placeholder, accessibilityLabel = 'Search', testID }: SearchFieldProps) {
  const t = useTokens();
  const c = t.color;
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.box,
        { backgroundColor: c.surface2, borderRadius: t.radius.pill, borderColor: focused ? c.primary : 'transparent' },
      ]}
    >
      <Icon name="search-outline" size={18} color={c.text2} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.text3}
        selectionColor={c.primary}
        cursorColor={c.primary}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={placeholder}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...WEB_ONE_ROW}
        style={[styles.input, { color: c.text, fontFamily: fonts.regular }]}
      />
      {value ? <IconButton icon="close-circle" label="Clear search" size={36} color={c.text2} onPress={() => onChangeText('')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4, minHeight: 44, borderWidth: 1.5 },
  input: { flex: 1, minWidth: 0, fontSize: 16, minHeight: 44, paddingVertical: 8, outlineWidth: 0 },
});
