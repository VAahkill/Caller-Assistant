import { ActivityIndicator, Switch as RNSwitch, StyleSheet, View } from 'react-native';

import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';

export interface SwitchProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  /** Shows a small spinner while the change is being saved. */
  busy?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/** Android's switch in the app's colours (the default is unthemed). */
export function Switch({ value, onValueChange, disabled, busy, accessibilityLabel, testID }: SwitchProps) {
  const t = useTokens();
  const c = t.color;
  return (
    <View style={styles.wrap}>
      {busy ? <ActivityIndicator size="small" color={c.primary} style={styles.spinner} /> : null}
      <RNSwitch
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        value={value}
        disabled={disabled || busy}
        onValueChange={(v) => {
          haptic.tap();
          onValueChange(v);
        }}
        trackColor={{ false: c.borderStrong, true: c.primary }}
        thumbColor={value ? (t.dark ? c.onPrimaryContainer : '#FFFFFF') : t.dark ? c.text2 : '#FFFFFF'}
        ios_backgroundColor={c.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spinner: { marginRight: 2 },
});
