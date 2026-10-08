import * as Contacts from 'expo-contacts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { Body, Button, Card, Input, Muted, Title } from '../../components/ui';
import { api, isHttpError, loadConfig, normalizeServerUrl, saveConfig } from '../../lib/api';
import { useLive } from '../../lib/live';
import { setupNotifications } from '../../lib/notifications';
import type { Profile } from '../../lib/types';

export default function Settings() {
  const { reconnect } = useLive();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadConfig().then((c) => {
        if (c) {
          setUrl(c.url);
          setToken(c.token);
          api.profile().then(setProfile).catch(() => {});
        }
      });
    }, []),
  );

  async function connect() {
    const address = normalizeServerUrl(url);
    if (!address) {
      setStatus("That address doesn't look right. It should look like http://192.168.1.7:8000, with your computer's address.");
      return;
    }
    setUrl(address);
    await saveConfig({ url: address, token });
    let h;
    try {
      h = await api.health();
    } catch (e) {
      setStatus(isHttpError(e) ? e.message : unreachable(address));
      return;
    }
    try {
      setProfile(await api.profile());
      setStatus(`Connected. Outbound calling: ${h.dialer === 'none' ? 'not set up' : h.dialer}.`);
      reconnect();
      setupNotifications().catch(() => {});
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function save(patch: Partial<Profile>) {
    setProfile((p) => (p ? { ...p, ...patch } : p));
    await api.patchProfile(patch).catch((e) => setStatus((e as Error).message));
  }

  async function syncContacts() {
    const { status: perm } = await Contacts.requestPermissionsAsync();
    if (perm !== 'granted') return;
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
    const list = data.flatMap((c) => (c.phoneNumbers ?? []).map((p) => ({ number: p.number ?? '', name: c.name ?? '' })));
    await api.putContacts(list.filter((c) => c.number));
    setStatus(`Synced ${list.length} numbers. Saved contacts always get through.`);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Title>Your server</Title>
        <Input
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.1.7:8000"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Input
          value={token}
          onChangeText={setToken}
          placeholder="API token"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!showToken}
        />
        <Row label="Show token" value={showToken} onChange={setShowToken} />
        <Button title="Connect" onPress={connect} />
        {status ? <Muted>{status}</Muted> : null}
      </Card>

      {profile ? (
        <>
          <Card>
            <Title>You and your assistant</Title>
            <Input value={profile.user_name} onChangeText={(v) => setProfile({ ...profile, user_name: v })}
              onEndEditing={() => save({ user_name: profile.user_name })} placeholder="Your name" />
            <Input value={profile.assistant_name} onChangeText={(v) => setProfile({ ...profile, assistant_name: v })}
              onEndEditing={() => save({ assistant_name: profile.assistant_name })} placeholder="Assistant's name" />
            <Input value={profile.home_country_code} onChangeText={(v) => setProfile({ ...profile, home_country_code: v })}
              onEndEditing={() => save({ home_country_code: profile.home_country_code })} placeholder="+91" />
          </Card>
          <Card>
            <Title>Who gets answered</Title>
            <Row label="Block international calls" value={profile.block_international} onChange={(v) => save({ block_international: v })} />
            <Row label="Answer unsaved numbers" value={profile.answer_unknown_numbers} onChange={(v) => save({ answer_unknown_numbers: v })} />
            <Button title="Sync my contacts" kind="secondary" onPress={syncContacts} />
          </Card>
          <Card>
            <Button title="Delivery location" kind="secondary" onPress={() => router.push('/location')} />
            <Button title="Voices" kind="secondary" onPress={() => router.push('/voices')} />
            <Button title="Instructions & notes" kind="secondary" onPress={() => router.push('/instructions')} />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

// Why Connect couldn't reach the server, in the terms a home setup needs.
function unreachable(url: string): string {
  const lan = /^https:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
  return lan
    ? `Couldn't reach ${url}. On home Wi-Fi the address starts with http://, not https://.`
    : `Couldn't reach ${url}. At home, check the phone is on the same Wi-Fi as the computer and the address is your computer's, like http://192.168.1.7:8000.`;
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Body style={{ flex: 1 }}>{label}</Body>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}
