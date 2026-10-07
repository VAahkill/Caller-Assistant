import * as ExpoLocation from 'expo-location';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { Button, Card, Input, Muted } from '../components/ui';
import { api } from '../lib/api';
import type { Location } from '../lib/types';

const EMPTY: Location = {
  lat: null, lng: null, address: '', building: '', floor_unit: '', landmarks: '', gate_instructions: '', geocoded_hint: '',
};

/** Pin the exact doorstep on Google Maps and describe how to get there.
 *  Only delivery partners ever hear these details. */
export default function LocationScreen() {
  const [loc, setLoc] = useState<Location>(EMPTY);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.profile().then((p) => setLoc(p.location)).catch(() => {});
  }, []);

  async function useCurrent() {
    const { status: perm } = await ExpoLocation.requestForegroundPermissionsAsync();
    if (perm !== 'granted') return;
    const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
    setLoc((l) => ({ ...l, lat: pos.coords.latitude, lng: pos.coords.longitude, geocoded_hint: '' }));
  }

  async function save() {
    try {
      const saved = await api.putLocation(loc);
      setLoc(saved);
      setStatus(saved.geocoded_hint ? `Saved. Map says: ${saved.geocoded_hint}` : 'Saved.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const set = (k: keyof Location) => (v: string) => setLoc((l) => ({ ...l, [k]: v }));
  const region = {
    latitude: loc.lat ?? 17.385,
    longitude: loc.lng ?? 78.4867,
    latitudeDelta: loc.lat ? 0.004 : 0.2,
    longitudeDelta: loc.lng ? 0.004 : 0.2,
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <View style={styles.mapWrap}>
        <MapView
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          onLongPress={(e) =>
            setLoc((l) => ({ ...l, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude, geocoded_hint: '' }))
          }
        >
          {loc.lat != null && loc.lng != null ? (
            <Marker
              draggable
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
              onDragEnd={(e) =>
                setLoc((l) => ({ ...l, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude, geocoded_hint: '' }))
              }
            />
          ) : null}
        </MapView>
      </View>
      <Muted>Long-press the map or drag the pin to your exact gate.</Muted>
      <Button title="Use my current location" kind="secondary" onPress={useCurrent} />
      <Card>
        <Input value={loc.address} onChangeText={set('address')} placeholder="Address" multiline />
        <Input value={loc.building} onChangeText={set('building')} placeholder="Building / society name" />
        <Input value={loc.floor_unit} onChangeText={set('floor_unit')} placeholder="Floor and flat number" />
        <Input value={loc.landmarks} onChangeText={set('landmarks')} placeholder="Landmarks, e.g. opposite Apollo Pharmacy" multiline />
        <Input value={loc.gate_instructions} onChangeText={set('gate_instructions')} placeholder="Gate / entry, e.g. green gate, use the lift" multiline />
        <Button title="Save location" onPress={save} />
        {status ? <Muted>{status}</Muted> : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mapWrap: { height: 280, borderRadius: 16, overflow: 'hidden' },
});
