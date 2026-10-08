import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { useAsyncAction } from '../../hooks/useAsyncAction';
import { api } from '../../lib/api';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { duration } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import type { VoiceInfo } from '../../lib/types';
import { AudioPlayer } from '../ui/AudioPlayer';
import { Banner } from '../ui/Banner';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

export const VOICE_SCRIPT =
  "Hi, this is my assistant speaking. I'm reading this short passage so it can learn how I sound. " +
  "Thanks for calling. I can't come to the phone right now, but I'll make sure your message reaches me. " +
  'Have a lovely day, and talk to you soon.';

const MIN_SECONDS = 8;
const GOOD_SECONDS = 15;
const PRESET = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

type Step = 'record' | 'review';

export interface VoiceRecorderSheetProps {
  visible: boolean;
  onClose: () => void;
  onSaved: (v: VoiceInfo) => void;
}

/** Record -> review (play it back, length, re-record) -> save with upload progress.
 *  Give it a new `key` each time it opens so it starts at the record step. */
export function VoiceRecorderSheet({ visible, onClose, onSaved }: VoiceRecorderSheetProps) {
  const t = useTokens();
  const c = t.color;
  const recorder = useAudioRecorder(PRESET);
  const state = useAudioRecorderState(recorder, 100);
  const [step, setStep] = useState<Step>('record');
  const [clip, setClip] = useState<{ uri: string; seconds: number } | null>(null);
  const [name, setName] = useState('My voice');
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<{ text: string; settings?: boolean } | null>(null);

  const start = async () => {
    setProblem(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setProblem({ text: 'Microphone access is off for OpenCall. Allow it in Settings to record your voice.', settings: true });
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      haptic.impact();
    } catch (e) {
      setProblem({ text: `Couldn't start recording: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const stop = async () => {
    const seconds = state.durationMillis / 1000;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (e) {
      setProblem({ text: `Couldn't finish recording: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    if (!recorder.uri) {
      setProblem({ text: 'The recording came out empty. Try again.' });
      return;
    }
    haptic.tap();
    setClip({ uri: recorder.uri, seconds });
    setStep('review');
  };

  const save = useAsyncAction(
    async () => {
      if (!clip) throw new Error('Record your voice first.');
      setProgress(0);
      return api.addVoice(name.trim() || 'My voice', clip.uri, setProgress);
    },
    { success: (v) => `Saved "${v.name}". It will be ready in a moment.`, error: false },
  );

  const finish = async () => {
    const v = await save.run();
    if (v) onSaved(v);
  };

  const seconds = state.isRecording ? state.durationMillis / 1000 : 0;
  const level = Math.max(0, Math.min(1, ((state.metering ?? -160) + 60) / 60));
  const tooShort = !!clip && clip.seconds < MIN_SECONDS;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={step === 'record' ? 'Record your voice' : 'Check your recording'}>
      <View style={styles.body}>
        {problem ? (
          <Banner
            tone="danger"
            title={problem.text}
            action={problem.settings ? { label: 'Open Settings', onPress: () => void Linking.openSettings() } : undefined}
          />
        ) : null}
        {step === 'record' ? (
          <>
            <Text variant="subhead" color="text2">
              Read this aloud in a quiet room for {GOOD_SECONDS} to 30 seconds. Only record voices you have permission to use.
            </Text>
            <View style={[styles.script, { backgroundColor: c.surface2, borderRadius: t.radius.md }]}>
              <Text variant="callout">{VOICE_SCRIPT}</Text>
            </View>
            <View style={styles.center}>
              <Pressable
                onPress={() => void (state.isRecording ? stop() : start())}
                accessibilityRole="button"
                accessibilityLabel={state.isRecording ? 'Stop recording' : 'Start recording'}
                style={({ pressed }) => [
                  styles.mic,
                  { backgroundColor: state.isRecording ? c.danger : c.primary, transform: [{ scale: pressed ? 0.95 : 1 + level * 0.08 }] },
                ]}
              >
                <Icon name={state.isRecording ? 'stop' : 'mic'} size={34} color={c.onPrimary} />
              </Pressable>
              <Text variant="title2" tabular>
                {duration(seconds)}
              </Text>
              <Text variant="footnote" color="text2">
                {!state.isRecording
                  ? 'Tap to start'
                  : seconds < MIN_SECONDS
                    ? 'Keep reading…'
                    : seconds < GOOD_SECONDS
                      ? 'Good, a little more is better'
                      : 'Great. Tap to stop when you finish.'}
              </Text>
            </View>
          </>
        ) : clip ? (
          <>
            <AudioPlayer source={{ uri: clip.uri }} title="Your recording" knownDuration={clip.seconds} speed={false} />
            {tooShort ? (
              <Banner tone="warning" title={`That was ${Math.round(clip.seconds)} seconds`} message={`Record at least ${MIN_SECONDS} seconds so the voice sounds like you.`} />
            ) : null}
            <TextField label="Name this voice" value={name} onChangeText={setName} maxLength={40} error={save.error} />
            {save.busy ? (
              <View style={[styles.track, { backgroundColor: c.surface3 }]} accessibilityLabel={`Uploading, ${Math.round(progress * 100)} percent`}>
                <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.primary }]} />
              </View>
            ) : null}
            <View style={styles.row}>
              <Button title="Record again" variant="tonal" icon="refresh" onPress={() => setStep('record')} disabled={save.busy} style={styles.flex} />
              <Button title="Save voice" icon="cloud-upload-outline" loading={save.busy} disabled={tooShort || !name.trim()} onPress={() => void finish()} style={styles.flex} />
            </View>
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  script: { padding: 14 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  mic: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
