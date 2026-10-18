import * as Clipboard from 'expo-clipboard';
import * as ExpoLocation from 'expo-location';
import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { PinMap } from '../components/domain/MapView';
import { Banner } from '../components/ui/Banner';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { useConfirm } from '../components/ui/ConfirmSheet';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { errorMessage, useAsyncAction } from '../hooks/useAsyncAction';
import { useProfile } from '../hooks/useProfile';
import { api } from '../lib/api';
import { emptyLocation } from '../lib/normalize';
import { Icon } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { directionsText, geocodeLine, locationChanged } from '../lib/location';
import type { Location } from '../lib/types';

const LANDMARK_HINTS = ['Opposite ', 'Next to ', 'Behind ', 'Above '];
const GATE_HINTS = ['Use the main gate', 'Tell security the flat number', 'Take the lift', 'Leave it with the guard', 'Ring the bell'];

/** Delivery location: pin the door, then directions, then what the assistant
 *  will say. Only delivery partners hear any of it. */
export default function LocationScreen() {
  const t = useTokens();
  const toast = useToast();
  const profile = useProfile();
  const saved = profile.data?.location;
  const [loc, setLoc] = useState<Location>(emptyLocation());
  const [mapSays, setMapSays] = useState<{ text: string; busy: boolean }>({ text: '', busy: false });
  const [linkSheet, setLinkSheet] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [linkSession, setLinkSession] = useState(0);

  if (saved && !loaded) {
    setLoaded(true);
    setLoc(saved);
    setMapSays({ text: saved.geocoded_hint, busy: false });
  }

  const dirty = !!saved && locationChanged(loc, saved);
  const pinned = loc.lat != null && loc.lng != null;

  // Leaving with unsaved changes asks first (back button, gesture or header).
  const navigation = useNavigation();
  const confirm = useConfirm();
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!dirtyRef.current) return;
        e.preventDefault();
        void confirm({
          title: 'Leave without saving?',
          message: 'Your changes to the delivery location are not saved yet.',
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
          destructive: true,
        }).then((leave) => {
          if (leave) navigation.dispatch(e.data.action);
        });
      }),
    [navigation, confirm],
  );

  // A live "Map says" line from the phone's geocoder whenever the pin moves.
  const lookup = useRef(0);
  const describePin = async (lat: number, lng: number) => {
    const mine = ++lookup.current;
    setMapSays((m) => ({ ...m, busy: true }));
    try {
      const [first] = await ExpoLocation.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (mine === lookup.current) setMapSays({ text: first ? geocodeLine(first) : '', busy: false });
    } catch (e) {
      console.warn('Reverse geocoding failed; the server fills it in on save', e);
      if (mine === lookup.current) setMapSays({ text: '', busy: false });
    }
  };

  // After the pin moves, the map's line may be worth copying into the street field.
  const [moved, setMoved] = useState(false);
  const movePin = (lat: number, lng: number) => {
    setMoved(true);
    setLoc((l) => ({ ...l, lat, lng, geocoded_hint: '' }));
    void describePin(lat, lng);
  };

  const [locating, setLocating] = useState<{ settings: boolean; text: string } | null>(null);
  const myLocation = useAsyncAction(
    async () => {
      setLocating(null);
      const perm = await ExpoLocation.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setLocating({
          settings: !perm.canAskAgain,
          text: perm.canAskAgain ? 'OpenCall needs location access to find you. Long-press the map instead, or try again.' : 'Location access is off for OpenCall.',
        });
        return false;
      }
      const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
      movePin(pos.coords.latitude, pos.coords.longitude);
      return true;
    },
    { success: (ok) => (ok ? 'Pin moved to where you are. Check it is your gate.' : ''), error: (e) => `Couldn't find you. ${errorMessage(e)}` },
  );

  const save = useAsyncAction(
    async () => {
      const next = await api.putLocation({ ...loc, geocoded_hint: loc.geocoded_hint || mapSays.text });
      setLoc(next);
      if (next.geocoded_hint) setMapSays({ text: next.geocoded_hint, busy: false });
      profile.mutate((p) => (p ? { ...p, location: next } : p));
      return next;
    },
    { success: 'Location saved. Delivery partners get these directions.' },
  );

  const set = (k: keyof Location) => (v: string) => setLoc((l) => ({ ...l, [k]: v }));
  const addHint = (k: 'landmarks' | 'gate_instructions', hint: string) =>
    setLoc((l) => {
      const cur = l[k].trim();
      return { ...l, [k]: cur ? `${cur.replace(/[.,]$/, '')}, ${hint.trim().toLowerCase()}` : hint };
    });

  if (!saved) {
    return (
      <Screen bottomInset testID="location">
        {profile.error ? (
          <Banner tone="danger" title="Couldn't load your location" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
        ) : (
          <SkeletonRows rows={5} />
        )}
      </Screen>
    );
  }

  const preview = directionsText({ ...loc, geocoded_hint: loc.geocoded_hint || mapSays.text });
  return (
    <Screen
      bottomInset
      footer={
        <Button
          title={dirty ? 'Save location' : 'Saved'}
          icon={dirty ? 'checkmark' : 'checkmark-done'}
          variant={dirty ? 'filled' : 'tonal'}
          loading={save.busy}
          disabled={!dirty}
          fullWidth
          onPress={() => void save.run()}
        />
      }
      testID="location"
    >
      <Section title="1. Pin your door" grouped={false} testID="location-pin">
        <View>
          <PinMap lat={loc.lat} lng={loc.lng} onMove={movePin} height={260} />
          <View style={styles.overlay} pointerEvents="box-none">
            <Button title="My location" icon="locate" size="sm" variant="tonal" loading={myLocation.busy} onPress={() => void myLocation.run()} />
            <Button
              title="Paste Maps link"
              icon="link"
              size="sm"
              variant="tonal"
              onPress={() => {
                setLinkSession((n) => n + 1);
                setLinkSheet(true);
              }}
            />
          </View>
        </View>
        {locating ? (
          <Banner
            tone="warning"
            title={locating.text}
            action={locating.settings ? { label: 'Open Settings', onPress: () => void Linking.openSettings() } : undefined}
            onDismiss={() => setLocating(null)}
          />
        ) : null}
        <View style={[styles.says, { backgroundColor: t.color.surface, borderRadius: t.radius.md, borderColor: t.color.border }]}>
          <Icon name="map-outline" size={18} color={t.color.text2} />
          <View style={styles.flex}>
            <Text variant="caption" color="text2">
              Map says
            </Text>
            <Text variant="subhead" numberOfLines={2}>
              {mapSays.text || (pinned ? 'Save to look up this spot' : 'No pin yet. Long-press the map at your gate.')}
            </Text>
          </View>
          {mapSays.busy ? <ActivityIndicator size="small" color={t.color.primary} accessibilityLabel="Looking up this spot" /> : null}
        </View>
        {mapSays.text && !mapSays.busy && loc.address.trim() !== mapSays.text && (moved || !loc.address.trim()) ? (
          <Button
            title="Use this as the street and area"
            icon="arrow-down"
            variant="ghost"
            size="sm"
            onPress={() => setLoc((l) => ({ ...l, address: mapSays.text }))}
          />
        ) : null}
        <Text variant="footnote" color="text2">
          Long-press the map at your exact gate to move the pin.
        </Text>
      </Section>

      <Section title="2. Directions for delivery partners" grouped={false} testID="location-directions">
        <Card>
          <TextField label="Flat / house no. and floor" value={loc.floor_unit} onChangeText={set('floor_unit')} placeholder="Flat 402, 4th floor" />
          <TextField label="Building / society" value={loc.building} onChangeText={set('building')} placeholder="Lakeview Residency, Block B" />
          <TextField label="Street and area" value={loc.address} onChangeText={set('address')} placeholder="Road No. 2, Kondapur" multiline minLines={1} />
          <View style={styles.field}>
            <TextField label="Landmark" value={loc.landmarks} onChangeText={set('landmarks')} placeholder="Opposite Ratnadeep supermarket" multiline minLines={1} />
            <View style={styles.chips}>
              {LANDMARK_HINTS.map((h) => (
                <Chip key={h} kind="suggestion" label={h.trim()} onPress={() => addHint('landmarks', h)} />
              ))}
            </View>
          </View>
          <View style={styles.field}>
            <TextField label="Gate and entry" value={loc.gate_instructions} onChangeText={set('gate_instructions')} placeholder="Use Gate 2, take the lift" multiline minLines={1} />
            <View style={styles.chips}>
              {GATE_HINTS.map((h) => (
                <Chip key={h} kind="suggestion" label={h} onPress={() => addHint('gate_instructions', h)} />
              ))}
            </View>
          </View>
        </Card>
      </Section>

      <Section title="3. What the assistant will say" grouped={false} testID="location-preview">
        <Card tone="primary">
          <Text variant="body" color="onPrimaryContainer">
            {preview || 'Add your flat, building and a landmark, and your assistant will guide riders to the door.'}
          </Text>
        </Card>
        <View style={styles.privacy}>
          <Icon name="lock-closed-outline" size={16} color={t.color.text2} />
          <Text variant="footnote" color="text2" style={styles.flex}>
            Only delivery partners hear these directions. Other callers never get your address.
          </Text>
        </View>
      </Section>

      <MapsLinkSheet
        key={linkSession}
        visible={linkSheet}
        onClose={() => setLinkSheet(false)}
        onPinned={(lat, lng) => {
          setLinkSheet(false);
          movePin(lat, lng);
          toast.success('Pin set from your link. Check it on the map, then save.');
        }}
      />
    </Screen>
  );
}

function MapsLinkSheet({ visible, onClose, onPinned }: { visible: boolean; onClose: () => void; onPinned: (lat: number, lng: number) => void }) {
  const [link, setLink] = useState('');
  const toast = useToast();
  const find = useAsyncAction(() => api.locationFromLink(link.trim()), { error: false });

  const paste = async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (text) setLink(text);
      else toast.info('The clipboard is empty. In Google Maps, tap Share, then Copy link.');
    } catch (e) {
      console.warn("Couldn't read the clipboard", e);
      toast.error("Couldn't read the clipboard.");
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Paste a Maps link" subtitle="In Google Maps, open your place, tap Share, then Copy link.">
      <View style={styles.sheet}>
        <TextField
          label="Google Maps link"
          value={link}
          onChangeText={setLink}
          placeholder="https://maps.app.goo.gl/..."
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={find.error}
          trailing={<Button title="Paste" variant="ghost" size="sm" icon="clipboard-outline" onPress={() => void paste()} />}
        />
        <Button
          title="Set pin"
          icon="location"
          fullWidth
          loading={find.busy}
          disabled={!link.trim()}
          onPress={() => void find.run().then((r) => r && onPinned(r.lat, r.lng))}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  says: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  field: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  sheet: { gap: 16 },
});
