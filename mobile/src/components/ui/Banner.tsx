import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { Button } from './Button';
import { cardColors } from './Card';
import { IconButton } from './IconButton';
import { Text } from './Text';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'primary';

export interface BannerProps {
  tone?: BannerTone;
  title: string;
  message?: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void; loading?: boolean };
  onDismiss?: () => void;
  testID?: string;
}

const ICONS: Record<BannerTone, IconName> = {
  info: 'information-circle',
  success: 'checkmark-circle',
  warning: 'warning',
  danger: 'alert-circle',
  primary: 'sparkles',
};

/** A persistent, inline message: offline, setup incomplete, permission needed. */
export function Banner({ tone = 'info', title, message, icon, action, onDismiss, testID }: BannerProps) {
  const t = useTokens();
  const colors = cardColors(t, tone);
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[styles.wrap, { backgroundColor: colors.bg, borderRadius: t.radius.lg }]}
    >
      <Icon name={icon ?? ICONS[tone]} size={22} color={colors.fg} style={styles.icon} />
      <View style={styles.body}>
        <Text variant="callout" weight="semibold" color={colors.fg}>
          {title}
        </Text>
        {message ? (
          <Text variant="footnote" color={colors.fg}>
            {message}
          </Text>
        ) : null}
        {action ? (
          <View style={styles.action}>
            <Button title={action.label} size="sm" variant="filled" onPress={action.onPress} loading={action.loading} />
          </View>
        ) : null}
      </View>
      {onDismiss ? <IconButton icon="close" label="Dismiss" size={32} color={colors.fg} onPress={onDismiss} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' },
  icon: { marginTop: 1 },
  body: { flex: 1, gap: 2 },
  action: { flexDirection: 'row', marginTop: 8 },
});
