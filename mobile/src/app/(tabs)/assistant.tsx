import * as Clipboard from 'expo-clipboard';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, Input, Muted } from '../../components/ui';
import { api, phoneFromText } from '../../lib/api';
import { useTheme } from '../../lib/theme';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const EXAMPLES = [
  'Check if a 3 seater table is free at 8 tonight',
  'From now on, tell couriers to leave parcels with the guard',
  "I'm travelling until Friday, callers can know that",
  "I'm available to answer questions now",
];

/** Talk to your own assistant: give it instructions or ask it to call somewhere. */
export default function Assistant() {
  const t = useTheme();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  async function send(message: string) {
    if (!message.trim()) return;
    setText('');
    setBusy(true);
    const history = msgs.slice(-10);
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    try {
      // If the user copied a number (e.g. from Google Maps), pass it along.
      const clip = await Clipboard.getStringAsync().catch(() => '');
      const shared = phoneFromText(clip) ? clip : '';
      const r = await api.chat(message, shared, history);
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: (e as Error).message }]);
    }
    setBusy(false);
  }

  async function toggleRecording() {
    if (!recording) {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      return;
    }
    await recorder.stop();
    setRecording(false);
    if (!recorder.uri) return;
    setBusy(true);
    try {
      const r = await api.voiceChat(recorder.uri);
      setMsgs((m) => [...m, { role: 'user', content: r.heard }, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: (e as Error).message }]);
    }
    setBusy(false);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={msgs}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={
          <View style={{ gap: 8 }}>
            <Muted>Tell your assistant what to do. Try:</Muted>
            {EXAMPLES.map((e) => (
              <Chip key={e} label={e} onPress={() => send(e)} />
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <View style={[styles.bubble, { backgroundColor: item.role === 'user' ? t.user : t.assistant }]}>
              <Text style={{ color: t.text, fontSize: 16 }}>{item.content}</Text>
            </View>
          </View>
        )}
      />
      <View style={[styles.bar, { borderColor: t.border, backgroundColor: t.card }]}>
        <Input style={{ flex: 1 }} value={text} onChangeText={setText} placeholder="Message your assistant"
          onSubmitEditing={() => send(text)} returnKeyType="send" />
        <Button title={recording ? 'Stop' : '🎙'} kind={recording ? 'danger' : 'secondary'} onPress={toggleRecording} disabled={busy && !recording} />
        <Button title="Send" onPress={() => send(text)} disabled={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bar: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
