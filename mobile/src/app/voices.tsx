import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Body, Button, Card, Input, Muted, Title } from '../components/ui';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import type { Voice } from '../lib/types';

const SCRIPT =
  "Hi, this is my assistant speaking. I'm reading this short passage so it can learn how I sound. " +
  "Thanks for calling, I can't come to the phone right now, but I'll make sure your message reaches me. " +
  'Have a lovely day, and talk to you soon.';

const LANGUAGES: Record<string, string> = {
  en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam',
  bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu',
};

// What each voice says when you tap play, in its own language.
const SAMPLES: Record<string, string> = {
  en: "Hi! I'm answering calls for you today. How does this sound?",
  hi: 'नमस्ते! यह आवाज़ आपको कैसी लगी?',
  te: 'నమస్కారం! ఈ స్వరం మీకు నచ్చిందా?',
  ta: 'வணக்கம்! இந்த குரல் உங்களுக்குப் பிடித்திருக்கிறதா?',
  kn: 'ನಮಸ್ಕಾರ! ಈ ಧ್ವನಿ ನಿಮಗೆ ಇಷ್ಟವಾಯಿತೇ?',
  ml: 'നമസ്കാരം! ഈ ശബ്ദം നിങ്ങൾക്ക് ഇഷ്ടമായോ?',
  bn: 'নমস্কার! এই কণ্ঠস্বর আপনার পছন্দ হয়েছে?',
  mr: 'नमस्कार! हा आवाज तुम्हाला आवडला का?',
  gu: 'નમસ્તે! આ અવાજ તમને ગમ્યો?',
  pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਕੀ ਤੁਹਾਨੂੰ ਇਹ ਆਵਾਜ਼ ਪਸੰਦ ਆਈ?',
  ur: 'السلام علیکم! کیا آپ کو یہ آواز پسند آئی؟',
};

/** Pick the voice your assistant answers with, or record your own (15 to 30 seconds). */
export default function Voices() {
  const t = useTheme();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [current, setCurrent] = useState('');
  const [label, setLabel] = useState('My voice');
  const [status, setStatus] = useState('');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder);
  const preview = useAudioPlayer(null);

  const load = useCallback(() => {
    api.voices().then(setVoices).catch(() => {});
    api.profile().then((p) => setCurrent(p.voice)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function choose(id: string) {
    setCurrent(id);
    await api.patchProfile({ voice: id }).catch(() => {});
  }

  function play(v: Voice) {
    const lang = v.kind === 'clone' || !SAMPLES[v.languages[0]] ? 'en' : v.languages[0];
    preview.replace(api.previewUrl(v.id, SAMPLES[lang], lang));
    preview.play();
  }

  async function toggleRecord() {
    if (!rec.isRecording) {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus('Recording… read the passage aloud in a quiet room.');
      return;
    }
    await recorder.stop();
    if (!recorder.uri) return;
    setStatus('Uploading…');
    try {
      const v = await api.addVoice(label, recorder.uri);
      setStatus(`Added "${v.name}".`);
      load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card>
        <Title>Clone a voice</Title>
        <Muted>Read this aloud for 15 to 30 seconds. Only record voices you have permission to use.</Muted>
        <Body style={{ fontStyle: 'italic' }}>{SCRIPT}</Body>
        <Input value={label} onChangeText={setLabel} placeholder="Name this voice" />
        <Button title={rec.isRecording ? `Stop (${Math.round((rec.durationMillis ?? 0) / 1000)}s)` : 'Start recording'}
          kind={rec.isRecording ? 'danger' : 'primary'} onPress={toggleRecord} />
        {status ? <Muted>{status}</Muted> : null}
      </Card>
      {voices.map((v) => (
        <Pressable key={v.id} onPress={() => choose(v.id)}>
          <Card style={current === v.id ? { borderColor: t.primary, borderWidth: 2 } : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600', fontSize: 16 }}>
                  {v.name}{current === v.id ? '  ✓' : ''}
                </Text>
                <Muted>
                  {v.kind === 'clone'
                    ? 'Your recording'
                    : `Built-in · ${v.languages.map((l) => LANGUAGES[l] ?? l).join(', ')}`}
                </Muted>
              </View>
              <Button title="▶" kind="secondary" onPress={() => play(v)} />
              {v.kind === 'clone' ? (
                <Button title="Delete" kind="secondary" onPress={() => api.deleteVoice(v.id.split(':')[1]).then(load)} />
              ) : null}
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
