import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';
import { Text } from '../ui/Text';

export interface ActionTile {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Spoken label when it differs from the visible one. */
  accessibilityLabel?: string;
  tone?: 'primary' | 'danger' | 'success' | 'warning';
  /** On (e.g. already a VIP): the tile is filled. */
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

/** A row of round actions with labels under them, like a contact card. */
export function ActionTiles({ actions, testID }: { actions: ActionTile[]; testID?: string }) {
  const t = useTokens();
  const c = t.color;
  return (
    <View style={styles.row} testID={testID}>
      {actions.map((a) => {
        const tone = a.tone ?? 'primary';
        const colors = {
          primary: { bg: c.primaryContainer, fg: c.onPrimaryContainer, on: c.primary, onFg: c.onPrimary },
          danger: { bg: c.dangerContainer, fg: c.onDangerContainer, on: c.danger, onFg: c.onPrimary },
          success: { bg: c.successContainer, fg: c.onSuccessContainer, on: c.success, onFg: c.onPrimary },
          warning: { bg: c.warningContainer, fg: c.onWarningContainer, on: c.warning, onFg: c.onPrimary },
        }[tone];
        const inactive = a.disabled || a.loading;
        return (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.accessibilityLabel ?? a.label}
            accessibilityState={{ disabled: !!inactive, busy: !!a.loading, selected: !!a.active }}
            disabled={inactive}
            onPress={() => {
              haptic.tap();
              a.onPress();
            }}
            style={({ pressed }) => [styles.tile, { opacity: a.disabled ? 0.45 : pressed ? 0.75 : 1 }]}
          >
            <View style={[styles.circle, { backgroundColor: a.active ? colors.on : colors.bg }]}>
              {a.loading ? (
                <ActivityIndicator size="small" color={a.active ? colors.onFg : colors.fg} />
              ) : (
                <Icon name={a.icon} size={22} color={a.active ? colors.onFg : colors.fg} />
              )}
            </View>
            <Text variant="caption" weight="semibold" color="text" align="center" numberOfLines={2}>
              {a.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  tile: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 4, minHeight: 48 },
  circle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
