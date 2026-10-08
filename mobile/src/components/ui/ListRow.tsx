import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import type { Accent } from '../../lib/design/palette';
import { haptic } from '../../lib/haptics';
import { Switch } from './Switch';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Shown at the right before the chevron, e.g. "India (+91)". */
  value?: string;
  icon?: IconName;
  /** Tile colours for the icon; defaults to a neutral tile. */
  iconTone?: Accent | 'primary' | 'danger' | 'success' | 'warning' | 'neutral';
  /** Replaces the icon tile, e.g. an Avatar. */
  leading?: ReactNode;
  /** Replaces chevron/value, e.g. a badge or button. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Turns the row into a toggle. */
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  switchBusy?: boolean;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
}

export function ListRow({
  title,
  subtitle,
  value,
  icon,
  iconTone = 'neutral',
  leading,
  trailing,
  onPress,
  switchValue,
  onSwitchChange,
  switchBusy,
  chevron,
  destructive,
  disabled,
  testID,
  accessibilityHint,
}: ListRowProps) {
  const t = useTokens();
  const c = t.color;
  const isSwitch = switchValue !== undefined;
  const tile =
    typeof iconTone === 'object'
      ? iconTone
      : {
          primary: { bg: c.primaryContainer, fg: c.onPrimaryContainer },
          danger: { bg: c.dangerContainer, fg: c.onDangerContainer },
          success: { bg: c.successContainer, fg: c.onSuccessContainer },
          warning: { bg: c.warningContainer, fg: c.onWarningContainer },
          neutral: { bg: c.surface3, fg: c.text },
        }[iconTone];
  const showChevron = chevron ?? (!!onPress && !isSwitch && !trailing);

  const content = (
    <View style={[styles.row, { paddingHorizontal: t.space.lg, opacity: disabled ? 0.5 : 1 }]}>
      {leading ??
        (icon ? (
          <View style={[styles.tile, { backgroundColor: tile.bg, borderRadius: t.radius.sm + 2 }]}>
            <Icon name={icon} size={19} color={tile.fg} />
          </View>
        ) : null)}
      <View style={styles.text}>
        <Text variant="body" weight="medium" color={destructive ? 'danger' : 'text'} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="text2" numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="subhead" color="text2" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {isSwitch ? (
        <Switch
          value={!!switchValue}
          onValueChange={(v) => onSwitchChange?.(v)}
          disabled={disabled}
          busy={switchBusy}
          accessibilityLabel={title}
        />
      ) : null}
      {showChevron ? <Icon name="chevron-forward" size={18} color={c.text3} /> : null}
    </View>
  );

  if (isSwitch) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint ?? subtitle}
        accessibilityState={{ checked: !!switchValue, disabled: !!disabled, busy: !!switchBusy }}
        disabled={disabled || switchBusy}
        onPress={() => {
          haptic.tap();
          onSwitchChange?.(!switchValue);
        }}
        android_ripple={{ color: c.surface3 }}
      >
        {content}
      </Pressable>
    );
  }
  if (!onPress) return <View testID={testID}>{content}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      accessibilityHint={accessibilityHint ?? subtitle}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      android_ripple={{ color: c.surface3 }}
      style={({ pressed }) => ({ backgroundColor: pressed ? c.surface2 : 'transparent' })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 10 },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
  value: { maxWidth: '45%' },
});
