import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useProfile } from '../hooks/useProfile';
import { api } from '../lib/api';
import { greetingLine } from '../lib/labels';

/** Your name and your assistant's name, and the greeting callers hear. */
export default function Persona() {
  const profile = useProfile();
  const p = profile.data;
  const [user, setUser] = useState('');
  const [assistant, setAssistant] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [hearing, setHearing] = useState(false);

  if (p && !loaded) {
    setLoaded(true);
    setUser(p.user_name);
    setAssistant(p.assistant_name);
  }

  if (hearing && status.didJustFinish) setHearing(false);

  if (!p) {
    return (
      <Screen bottomInset testID="persona">
        {profile.error ? (
          <Banner tone="danger" title="Couldn't load your settings" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
        ) : (
          <SkeletonRows rows={3} />
        )}
      </Screen>
    );
  }

  const dirty = user.trim() !== p.user_name || assistant.trim() !== p.assistant_name;
  const valid = !!user.trim() && !!assistant.trim();
  const line = greetingLine(user, assistant);

  const save = async () => {
    setSaving(true);
    await profile.patch({ user_name: user.trim(), assistant_name: assistant.trim() }, 'Saved. Callers hear the new greeting from the next call.');
    setSaving(false);
  };

  const hear = () => {
    if (hearing && status.playing) {
      player.pause();
      setHearing(false);
      return;
    }
    const source = api.speech(p.voice, line);
    if (!source) return;
    setHearing(true);
    player.replace(source);
    player.play();
  };

  return (
    <Screen
      bottomInset
      footer={<Button title={dirty ? 'Save' : 'Saved'} icon="checkmark" variant={dirty ? 'filled' : 'tonal'} fullWidth loading={saving} disabled={!dirty || !valid} onPress={() => void save()} />}
      testID="persona"
    >
      <Section title="Names" grouped={false}>
        <Card>
          <TextField
            label="Your name"
            value={user}
            onChangeText={setUser}
            maxLength={40}
            autoCapitalize="words"
            helper="How the assistant refers to you, e.g. Arjun's assistant."
            error={user.trim() ? null : 'Add your name.'}
          />
          <TextField
            label="Assistant's name"
            value={assistant}
            onChangeText={setAssistant}
            maxLength={40}
            autoCapitalize="words"
            helper="A short, friendly name callers can say back."
            error={assistant.trim() ? null : 'Give your assistant a name.'}
          />
        </Card>
      </Section>
      <Section title="Callers hear" grouped={false}>
        <Card tone="primary">
          <Text variant="body" color="onPrimaryContainer">
            {line}
          </Text>
          <View style={styles.row}>
            <Button
              title={hearing && status.playing ? 'Stop' : 'Hear it'}
              icon={hearing && status.playing ? 'stop' : 'volume-high-outline'}
              size="sm"
              variant="filled"
              loading={hearing && !status.playing && !status.isLoaded}
              onPress={hear}
            />
          </View>
        </Card>
        <Text variant="footnote" color="text2">
          The assistant then switches to the caller's language. Change the voice in Voices.
        </Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});
