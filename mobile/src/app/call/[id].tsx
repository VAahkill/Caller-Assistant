import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer } from 'expo-audio';

import { Transcript } from '../../components/Transcript';
import { Button, Chip, Input, Muted } from '../../components/ui';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useTheme } from '../../lib/theme';
import type { CallRecord } from '../../lib/types';

const QUICK_REPLIES = ['Yes, that works', "No, sorry", "I'll call them back", "I'm busy, take a message"];

/** Live transcript with the "intervention zone": answer questions the caller is
 *  waiting on, or type anything for the assistant to say right now. */
export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { liveCalls, questions, answerViaSocket } = useLive();
  const [stored, setStored] = useState<CallRecord | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const live = liveCalls[id];
  const call = live ?? stored;
  const pending = questions.find((q) => q.callId === id);
  const player = useAudioPlayer(!live && stored?.recording ? api.recordingUrl(id) : null);

  useEffect(() => {
    if (!live) api.call(id).then(setStored).catch((e) => setError(String(e.message ?? e)));
  }, [id, live]);

  async function send(message: string) {
    if (!message.trim()) return;
    setText('');
    setError('');
    if (!answerViaSocket(id, message, pending?.holdId)) {
      try {
        await api.answer(id, message, pending?.holdId);
      } catch (e) {
        setError(String((e as Error).message));
      }
    }
  }

  if (!call) return <Muted style={{ padding: 16 }}>{error || 'Loading…'}</Muted>;
  const who = call.contact_name || call.number || 'Unknown caller';
  const status = live ? (call.status === 'on_hold' ? 'On hold, waiting for you' : 'Live') : 'Ended';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={[styles.header, { borderColor: t.border, backgroundColor: t.card }]}>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{who}</Text>
        <Muted>
          {call.direction === 'outbound' ? 'Calling for you' : 'Incoming'} · {call.category} · {status}
        </Muted>
      </View>

      <View style={{ flex: 1 }}>
        <Transcript lines={call.transcript} callerLabel={who} />
      </View>

      {live ? (
        <View style={[styles.zone, { borderColor: t.border, backgroundColor: t.card }]}>
          {pending ? (
            <View style={[styles.pending, { backgroundColor: t.warn }]}>
              <Text style={{ color: t.warnText, fontWeight: '700' }}>{who} is on hold and asks:</Text>
              <Text style={{ color: t.warnText, fontSize: 16 }}>{pending.question}</Text>
            </View>
          ) : null}
          {pending ? (
            <View style={styles.chips}>
              {QUICK_REPLIES.map((r) => (
                <Chip key={r} label={r} onPress={() => send(r)} />
              ))}
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <Input
              style={{ flex: 1 }}
              value={text}
              onChangeText={setText}
              placeholder={pending ? 'Type your answer…' : 'Type something for the assistant to say…'}
              onSubmitEditing={() => send(text)}
              returnKeyType="send"
            />
            <Button title="Send" onPress={() => send(text)} />
          </View>
          {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
          <Button title="Wrap up this call" kind="secondary" onPress={() => api.endCall(id).catch(() => {})} />
        </View>
      ) : (
        <View style={[styles.zone, { borderColor: t.border, backgroundColor: t.card }]}>
          {call.summary ? <Text style={{ color: t.text }}>{call.summary}</Text> : null}
          {call.message ? <Text style={{ color: t.text, fontWeight: '600' }}>Message: {call.message}</Text> : null}
          {call.recording ? (
            <Button title={player.playing ? 'Pause recording' : 'Play recording'} kind="secondary"
              onPress={() => (player.playing ? player.pause() : player.play())} />
          ) : null}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  zone: { padding: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  pending: { borderRadius: 12, padding: 12, gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
