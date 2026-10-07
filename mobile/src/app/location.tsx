import * as ExpoLocation from 'expo-location';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';

import { Button, Card, Input, Muted } from '../components/ui';
import { api } from '../lib/api';
import type { Location } from '../lib/types';

// OpenFreeMap: free OpenStreetMap vector tiles, no API key and no account.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const EMPTY: Location = {
  lat: null, lng: null, address: '', building: '', floor_unit: '', landmarks: '', gate_instructions: '', geocoded_hint: '',
};

/** Pin the exact doorstep and describe how to get there. Uses free
 *  OpenStreetMap maps; a shared Google Maps link also works, with no API key.
 *  Only delivery partners ever hear these details. */
export default function LocationScreen() {
  const [loc, setLoc] = useState<Location>(EMPTY);
  const [status, setStatus] = useState('');
  const [link, setLink] = useState('');

  useEffect(() => {
    api.profile().then((p) => setLoc(p.location)).catch(() => {});
  }, []);

  async function useCurrent() {
    const { status: perm } = await ExpoLocation.requestForegroundPermissionsAsync();
    if (perm !== 'granted') return;
    const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
    setLoc((l) => ({ ...l, lat: pos.coords.latitude, lng: pos.coords.longitude, geocoded_hint: '' }));
  }

  async function fromLink() {
    try {
      const { lat, lng } = await api.locationFromLink(link);
      setLoc((l) => ({ ...l, lat, lng, geocoded_hint: '' }));
      setLink('');
      setStatus('Pin set from your Google Maps link. Check it on the map, then save.');
    } catch (e) {
      setStatus((e as Error).message);
    }
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
  const pinned = loc.lat != null && loc.lng != null;
  const movePin = (lngLat: [number, number]) =>
    setLoc((l) => ({ ...l, lng: lngLat[0], lat: lngLat[1], geocoded_hint: '' }));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <View style={styles.mapWrap}>
        <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} onLongPress={(e) => movePin(e.nativeEvent.lngLat)}>
          {pinned ? (
            <Camera center={[loc.lng as number, loc.lat as number]} zoom={17} duration={300} />
          ) : (
            <Camera initialViewState={{ center: [78.4867, 17.385], zoom: 10 }} />
          )}
          {pinned ? (
            <Marker lngLat={[loc.lng as number, loc.lat as number]} anchor="bottom">
              <Text style={{ fontSize: 32 }}>📍</Text>
            </Marker>
          ) : null}
        </Map>
      </View>
      <Muted>Long-press the map at your exact gate to move the pin.</Muted>
      <Button title="Use my current location" kind="secondary" onPress={useCurrent} />
      <Card>
        <Muted>Or paste a Google Maps link to your place (Share → Copy link in Google Maps).</Muted>
        <Input value={link} onChangeText={setLink} placeholder="https://maps.app.goo.gl/…" autoCapitalize="none" />
        <Button title="Set pin from link" kind="secondary" onPress={fromLink} disabled={!link.trim()} />
      </Card>
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
