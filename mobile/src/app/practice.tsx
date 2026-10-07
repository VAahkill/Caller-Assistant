import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Transcript } from '../components/Transcript';
import { Body, Button, Card, Chip, Input, Muted } from '../components/ui';
import { api, loadConfig, wsUrl } from '../lib/api';
import { useLive } from '../lib/live';
import { useTheme } from '../lib/theme';
import type { TranscriptLine } from '../lib/types';

// Things a caller might say, to get going quickly.
const starters = (name: string) => [
  'Hi, I have a Swiggy order for you. Where should I come?',
  'నమస్కారం, మీ పార్సెల్ వచ్చింది. మీ ఇల్లు ఎక్కడ?',
  'வணக்கம், உங்கள் பார்சல் வந்திருக்கு. உங்கள் வீடு எங்கே?',
  'Sir, please tell me the OTP for the delivery.',
  `Hi, is ${name || 'he'} free for dinner on Saturday?`,
];

/** You play a caller; your assistant answers exactly as it would on a real call.
 *  Needs no phone line, so it's the quickest way to try OpenCall. */
export default function Practice() {
  const t = useTheme();
  const { liveCalls, questions } = useLive();
  const [callId, setCallId] = useState('');
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'ended'>('idle');
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);
  const [userName, setUserName] = useState('');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const ws = useRef<WebSocket | null>(null);
  const queue = useRef<File[]>([]);
  const player = useRef<AudioPlayer | null>(null);

  // Keep the transcript on screen after the call ends and leaves the live list.
  const live = callId ? liveCalls[callId] : undefined;
  useEffect(() => {
    if (live) setLines(live.transcript);
  }, [live]);
  const pending = questions.find((q) => q.callId === callId);

  useEffect(() => {
    api.profile().then((p) => setUserName(p.user_name)).catch(() => {});
    return () => hangUp();
  }, []);

  function playNext() {
    if (player.current) return;
    const file = queue.current.shift();
    if (!file) return;
    const p = createAudioPlayer({ uri: file.uri });
    player.current = p;
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (!s.didJustFinish) return;
      sub.remove();
      p.remove();
      player.current = null;
      try {
        file.delete();
      } catch {}
      playNext();
    });
    p.play();
  }

  async function start() {
    await loadConfig();
    const url = wsUrl('/ws/simulate?number=%2B919876500001&wav=1');
    if (!url) {
      setNote('Connect to your server in Settings first.');
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {});
    setLines([]);
    setNote('');
    setState('connecting');
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    ws.current = socket;
    let n = 0;
    socket.onmessage = (m) => {
      if (typeof m.data === 'string') {
        const ev = JSON.parse(m.data) as { event: string; call_id?: string; reason?: string; detail?: string };
        if (ev.event === 'started' && ev.call_id) {
          setCallId(ev.call_id);
          setState('live');
        } else if (ev.event === 'rejected') {
          setNote(`The assistant wouldn't answer this caller: ${ev.reason ?? ''}`);
        } else if (ev.event === 'error') {
          setNote(ev.detail ?? 'Something went wrong.');
        }
        return;
      }
      // One WAV file per sentence the assistant says.
      try {
        const file = new File(Paths.cache, `practice-${Date.now()}-${n++}.wav`);
        file.create();
        file.write(new Uint8Array(m.data as ArrayBuffer));
        queue.current.push(file);
        playNext();
      } catch (e) {
        setNote(`Couldn't play the assistant's voice: ${(e as Error).message}`);
      }
    };
    socket.onerror = () => setNote("Couldn't reach your server. Check the address in Settings.");
    socket.onclose = () => {
      ws.current = null;
      setState('ended');
    };
  }

  function hangUp() {
    const socket = ws.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ hangup: true }));
      socket.close();
    }
    queue.current = [];
    player.current?.remove();
    player.current = null;
  }

  function say(message: string) {
    if (!message.trim() || ws.current?.readyState !== WebSocket.OPEN) return;
    setText('');
    ws.current.send(JSON.stringify({ text: message }));
  }

  async function toggleTalk() {
    if (!recording) {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      return;
    }
    await recorder.stop();
    setRecording(false);
    if (!recorder.uri || ws.current?.readyState !== WebSocket.OPEN) return;
    const clip = new File(recorder.uri);
    ws.current.send(JSON.stringify({ audio_b64: await clip.base64() }));
  }

  if (state === 'idle') {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card>
          <Body style={{ fontWeight: '700' }}>Try your assistant without a phone line</Body>
          <Muted>
            You play someone calling you. Your assistant answers in its own voice, just like on a real call: talk
            to it with the mic button or type. Questions it can't answer come to you, like they would on a real
            call.
          </Muted>
          <Button title="Start practice call" onPress={start} />
          {note ? <Muted>{note}</Muted> : null}
        </Card>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={[styles.header, { borderColor: t.border }]}>
        <Text style={{ color: state === 'live' ? t.ok : t.muted, fontWeight: '700' }}>
          {state === 'live' ? '● Practice call' : state === 'connecting' ? 'Connecting…' : 'Call ended'}
        </Text>
        {state === 'ended' ? (
          <Button title="Call again" kind="secondary" onPress={start} />
        ) : (
          <Button title="Hang up" kind="danger" onPress={hangUp} />
        )}
      </View>
      {note ? <Muted style={{ padding: 12 }}>{note}</Muted> : null}
      {pending ? (
        <Card style={{ margin: 12, backgroundColor: t.warn, borderColor: t.warn }}>
          <Text style={{ color: t.warnText, fontWeight: '700' }}>Your assistant is asking you</Text>
          <Text style={{ color: t.warnText, fontSize: 16 }}>{pending.question}</Text>
          <Button title="Answer" onPress={() => router.push(`/call/${callId}`)} />
        </Card>
      ) : null}
      <View style={{ flex: 1 }}>
        <Transcript lines={lines} callerLabel="You (as the caller)" />
      </View>
      {state === 'live' ? (
        <View style={[styles.zone, { borderColor: t.border, backgroundColor: t.card }]}>
          {lines.filter((l) => l.speaker === 'caller').length === 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {starters(userName).map((s) => (
                <Chip key={s} label={s} onPress={() => say(s)} />
              ))}
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Input value={text} onChangeText={setText} placeholder="Say something as the caller…" onSubmitEditing={() => say(text)} />
            </View>
            <Button title="Send" onPress={() => say(text)} />
            <Button title={recording ? '■' : '🎤'} kind={recording ? 'danger' : 'secondary'} onPress={toggleTalk} />
          </View>
          {recording ? <Muted>Listening… tap ■ when you've finished speaking.</Muted> : null}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  zone: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
});
