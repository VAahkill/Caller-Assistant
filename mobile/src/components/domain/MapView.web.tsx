import { StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { Text } from '../ui/Text';
import type { PinMapProps } from './MapView';

// Web build only (screenshot checks): MapLibre's native view has no web
// version, so this draws a placeholder of the same size.
export function PinMap({ lat, lng, height = 280 }: PinMapProps) {
  const t = useTokens();
  const pinned = lat != null && lng != null;
  return (
    <View
      style={[styles.wrap, { height, borderRadius: t.radius.lg, backgroundColor: t.color.surface2, borderColor: t.color.border }]}
      accessibilityLabel="Map"
    >
      <Icon name="location" size={40} color={t.color.danger} />
      <Text variant="caption" color="text2" tabular>
        {pinned ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'No pin yet'}
      </Text>
      <Text variant="caption" color="text3">
        The map shows in the Android app
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: StyleSheet.hairlineWidth },
});
