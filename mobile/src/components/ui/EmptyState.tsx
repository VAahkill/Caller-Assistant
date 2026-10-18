import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { Button } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  compact?: boolean;
  testID?: string;
}

export function EmptyState({ icon, title, message, action, compact, testID }: EmptyStateProps) {
  const t = useTokens();
  return (
    <View testID={testID} style={[styles.wrap, { paddingVertical: compact ? t.space.xl : t.space.x4 }]}>
      <View style={[styles.badge, { backgroundColor: t.color.primaryContainer }]}>
        <Icon name={icon} size={28} color={t.color.onPrimaryContainer} />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="subhead" color="text2" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {action ? (
        <View style={styles.action}>
          <Button title={action.label} icon={action.icon} variant="tonal" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  message: { maxWidth: 320 },
  action: { marginTop: 12 },
});
