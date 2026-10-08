import { forwardRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon, fonts, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { hasIndicScript } from '../../lib/script';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  /** Always visible above the box (never just a placeholder). */
  label: string;
  helper?: string;
  error?: string | null;
  /** Text or element shown inside the box before the value, e.g. "+91". */
  prefix?: ReactNode;
  icon?: IconName;
  /** Element at the end of the box (overrides the clear button). */
  trailing?: ReactNode;
  clearable?: boolean;
  /** Adds a Show/Hide toggle for secrets. */
  secret?: boolean;
  /** Shows "12 / 200" under the box when maxLength is set. */
  counter?: boolean;
  minLines?: number;
  disabled?: boolean;
  /** Small status at the right of the label, e.g. "Saved". */
  status?: ReactNode;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    helper,
    error,
    prefix,
    icon,
    trailing,
    clearable,
    secret,
    counter,
    multiline,
    minLines = 3,
    disabled,
    status,
    value,
    onChangeText,
    onFocus,
    onBlur,
    maxLength,
    testID,
    ...rest
  },
  ref,
) {
  const t = useTokens();
  const c = t.color;
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const borderColor = error ? c.danger : focused ? c.primary : c.border;
  const indic = hasIndicScript(value ?? '');
  const lineHeight = indic ? 26 : 24;
  const showClear = clearable && !!value && !disabled && !trailing;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text variant="footnote" weight="medium" color={error ? 'danger' : 'text2'} nativeID={testID ? `${testID}-label` : undefined}>
          {label}
        </Text>
        {status}
      </View>
      <View
        style={[
          styles.box,
          {
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
            backgroundColor: disabled ? c.surface3 : c.surface2,
            borderRadius: t.radius.md,
            minHeight: multiline ? 24 * minLines + 24 : 52,
            alignItems: multiline ? 'flex-start' : 'center',
          },
        ]}
      >
        {icon ? <Icon name={icon} size={20} color={c.text3} style={multiline ? styles.topIcon : undefined} /> : null}
        {typeof prefix === 'string' ? (
          <Text variant="body" color="text2" style={multiline ? styles.topIcon : undefined}>
            {prefix}
          </Text>
        ) : (
          prefix
        )}
        <TextInput
          ref={ref}
          testID={testID}
          accessibilityLabel={label}
          accessibilityHint={error ?? helper}
          editable={!disabled}
          value={value}
          onChangeText={onChangeText}
          maxLength={maxLength}
          multiline={multiline}
          secureTextEntry={secret && !reveal}
          placeholderTextColor={c.text3}
          selectionColor={c.primary}
          cursorColor={c.primary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
          style={[
            styles.input,
            {
              color: c.text,
              fontFamily: fonts.regular,
              lineHeight: multiline ? lineHeight : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
              paddingVertical: multiline ? 12 : 0,
            },
          ]}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reveal ? `Hide ${label}` : `Show ${label}`}
            hitSlop={10}
            onPress={() => setReveal((r) => !r)}
            style={styles.adornment}
          >
            <Text variant="footnote" weight="semibold" color="primary">
              {reveal ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        ) : null}
        {showClear ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={12}
            onPress={() => onChangeText?.('')}
            style={styles.adornment}
          >
            <Icon name="close-circle" size={20} color={c.text3} />
          </Pressable>
        ) : null}
        {trailing}
      </View>
      {error || helper || (counter && maxLength) ? (
        <View style={styles.helperRow}>
          {error ? (
            <View style={styles.errorRow} accessibilityLiveRegion="polite">
              <Icon name="alert-circle" size={16} color={c.danger} />
              <Text variant="footnote" color="danger" style={styles.flex}>
                {error}
              </Text>
            </View>
          ) : helper ? (
            <Text variant="footnote" color="text2" style={styles.flex}>
              {helper}
            </Text>
          ) : (
            <View style={styles.flex} />
          )}
          {counter && maxLength ? (
            <Text variant="caption" color="text3" tabular>
              {(value ?? '').length} / {maxLength}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  box: { flexDirection: 'row', paddingHorizontal: 14, gap: 10 },
  input: { flex: 1, fontSize: 16, minHeight: 48, includeFontPadding: false },
  topIcon: { marginTop: 14 },
  adornment: { minHeight: 40, minWidth: 32, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  helperRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flex: 1 },
  flex: { flex: 1 },
});
