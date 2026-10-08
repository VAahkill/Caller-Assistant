import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';

// OpenFreeMap: free OpenStreetMap vector tiles, no API key and no account.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const HYDERABAD: [number, number] = [78.4867, 17.385];

export interface PinMapProps {
  lat: number | null;
  lng: number | null;
  /** Long-press moves the pin. */
  onMove: (lat: number, lng: number) => void;
  height?: number;
}

/** A map with one pin for the owner's door (MapLibre). The web build uses MapView.web.tsx. */
export function PinMap({ lat, lng, onMove, height = 280 }: PinMapProps) {
  const t = useTokens();
  const pinned = lat != null && lng != null;
  return (
    <View style={[styles.wrap, { height, borderRadius: t.radius.lg, backgroundColor: t.color.surface2 }]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        onLongPress={(e) => onMove(e.nativeEvent.lngLat[1], e.nativeEvent.lngLat[0])}
        accessibilityLabel="Map. Long-press at your gate to move the pin."
      >
        {pinned ? (
          <Camera center={[lng, lat]} zoom={17} duration={300} />
        ) : (
          <Camera initialViewState={{ center: HYDERABAD, zoom: 10 }} />
        )}
        {pinned ? (
          <Marker lngLat={[lng, lat]} anchor="bottom">
            <Icon name="location" size={40} color={t.color.danger} />
          </Marker>
        ) : null}
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});
