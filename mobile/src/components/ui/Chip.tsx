import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  onPress?: () => void;
  /** filter: toggles with a tick. suggestion: fills something in. input: removable value. */
  kind?: 'filter' | 'suggestion' | 'input';
  selected?: boolean;
  icon?: IconName;
  onRemove?: () => void;
  disabled?: boolean;
  /** Small count after the label, e.g. unread messages. */
  count?: number;
  testID?: string;
}

export function Chip({ label, onPress, kind = 'filter', selected, icon, onRemove, disabled, count, testID }: ChipProps) {
  const t = useTokens();
  const c = t.color;
  const on = kind === 'filter' && selected;
  const fg = on ? c.onPrimaryContainer : c.text;
  const lead: IconName | undefined = on ? 'checkmark' : icon;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      android_ripple={{ color: c.surface3, borderless: false }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: t.radius.pill,
          backgroundColor: on ? c.primaryContainer : kind === 'suggestion' ? c.surface2 : c.surface,
          borderColor: on ? c.primaryContainer : c.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {lead ? <Icon name={lead} size={16} color={on ? c.onPrimaryContainer : c.text2} /> : null}
      <Text variant="footnote" weight="medium" color={fg} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      {count ? (
        <View style={[styles.count, { backgroundColor: on ? c.primary : c.surface3 }]}>
          <Text variant="caption" color={on ? c.onPrimary : c.text} tabular>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
      {kind === 'input' && onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} hitSlop={10} onPress={onRemove}>
          <Icon name="close-circle" size={18} color={c.text3} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    borderWidth: 1,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  label: { flexShrink: 1 },
  count: { borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
});
