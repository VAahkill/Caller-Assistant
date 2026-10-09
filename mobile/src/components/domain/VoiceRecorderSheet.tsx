import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { useAsyncAction } from '../../hooks/useAsyncAction';
import { api } from '../../lib/api';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { duration } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import type { VoiceInfo } from '../../lib/types';
import {
  GOOD_SECONDS,
  MAX_SECONDS,
  MIN_SECONDS,
  levelFromMetering,
  loudness,
  recordingHint,
  takeProblem,
  type Loudness,
} from '../../lib/voices';
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

const PRESET = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const BARS = 24;

type Step = 'record' | 'review' | 'saved';

export interface VoiceRecorderSheetProps {
  visible: boolean;
  /** Suggested name, e.g. "My voice 2" when "My voice" is taken. */
  defaultName?: string;
  onClose: () => void;
  /** Called as soon as the server has the voice (it is still getting ready). */
  onSaved: (v: VoiceInfo) => void;
}

/** Record -> review (play it back, length, loudness, re-record) -> save with
 *  upload progress -> a clear "Saved" step. Give it a new `key` each time it
 *  opens so it starts at the record step. */
export function VoiceRecorderSheet({ visible, defaultName = 'My voice', onClose, onSaved }: VoiceRecorderSheetProps) {
  const t = useTokens();
  const c = t.color;
  const recorder = useAudioRecorder(PRESET);
  const state = useAudioRecorderState(recorder, 100);
  const [step, setStep] = useState<Step>('record');
  const [clip, setClip] = useState<{ uri: string; seconds: number; level: Loudness } | null>(null);
  const [name, setName] = useState(defaultName);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<{ text: string; settings?: boolean } | null>(null);
  const [saved, setSaved] = useState<VoiceInfo | null>(null);
  // Metering while recording (one reading per recorder update), for the meter
  // and the loudness check afterwards.
  const [meter, setMeter] = useState<{ at: number; samples: number[] }>({ at: -1, samples: [] });
  if (state.isRecording && state.metering != null && state.durationMillis !== meter.at) {
    setMeter({ at: state.durationMillis, samples: [...meter.samples, state.metering] });
  }
  const bars = meter.samples.slice(-BARS).map(levelFromMetering);

  const seconds = state.isRecording ? state.durationMillis / 1000 : 0;
  const level = state.isRecording ? levelFromMetering(state.metering) : 0;

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
      setMeter({ at: -1, samples: [] });
      recorder.record();
      haptic.impact();
    } catch (e) {
      setProblem({ text: `Couldn't start recording: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const stop = async () => {
    const took = state.durationMillis / 1000;
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
    setClip({ uri: recorder.uri, seconds: took, level: loudness(meter.samples) });
    setStep('review');
  };

  // Long enough: stop on its own.
  const stopping = useRef(false);
  useEffect(() => {
    if (!state.isRecording) {
      stopping.current = false;
      return;
    }
    if (seconds >= MAX_SECONDS && !stopping.current) {
      stopping.current = true;
      void stop();
    }
  });

  const save = useAsyncAction(
    async () => {
      if (!clip) throw new Error('Record your voice first.');
      setProgress(0);
      return api.addVoice(name.trim() || defaultName, clip.uri, setProgress);
    },
    { error: false },
  );

  const finish = async () => {
    const v = await save.run();
    if (!v) return;
    setSaved(v);
    setStep('saved');
    onSaved(v);
  };

  const issue = clip ? takeProblem(clip.seconds, clip.level) : null;
  const title = step === 'record' ? 'Record your voice' : step === 'review' ? 'Check your recording' : 'Voice saved';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
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
              Read this aloud in a quiet room for {GOOD_SECONDS} to 30 seconds, about a hand away from the phone. Only record voices you have permission to use.
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
              <LevelMeter bars={state.isRecording ? bars : []} />
              <Text variant="footnote" color="text2" accessibilityLiveRegion="polite">
                {state.isRecording ? recordingHint(seconds) : 'Tap to start'}
              </Text>
            </View>
          </>
        ) : step === 'review' && clip ? (
          <>
            <AudioPlayer source={{ uri: clip.uri }} title="Your recording" subtitle={verdict(clip.level)} knownDuration={clip.seconds} speed={false} />
            {issue ? <Banner tone="warning" title={issue.title} message={issue.message} /> : null}
            <TextField label="Name this voice" value={name} onChangeText={setName} maxLength={40} helper="You pick it by this name for each language." />
            {save.error ? <Banner tone="danger" title="Not saved" message={save.error} /> : null}
            {save.busy ? (
              <View style={styles.progress} testID="voice-upload-progress">
                <View
                  style={[styles.track, { backgroundColor: c.surface3 }]}
                  accessible
      accessibilityRole="progressbar"
                  accessibilityLabel="Uploading your recording"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
                >
                  <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.primary }]} />
                </View>
                <Text variant="footnote" color="text2" tabular>
                  {progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Uploaded. Saving on your server…'}
                </Text>
              </View>
            ) : null}
            <View style={styles.row}>
              <Button
                title="Record again"
                variant="tonal"
                icon="refresh"
                onPress={() => {
                  save.reset();
                  setStep('record');
                }}
                disabled={save.busy}
                style={styles.flex}
              />
              <Button
                title={save.error ? 'Try again' : 'Save voice'}
                icon="cloud-upload-outline"
                loading={save.busy}
                disabled={!!issue?.blocking || !name.trim()}
                onPress={() => void finish()}
                style={styles.flex}
              />
            </View>
          </>
        ) : step === 'saved' && saved ? (
          <View style={styles.done} testID="voice-saved">
            <View style={[styles.doneIcon, { backgroundColor: c.successContainer }]}>
              <Icon name="checkmark" size={36} color={c.success} />
            </View>
            <Text variant="title2" style={styles.centerText}>
              Saved "{saved.name}"
            </Text>
            <Text variant="subhead" color="text2" style={styles.centerText}>
              {saved.status === 'ready'
                ? 'It is ready. Pick it for a language below.'
                : 'Your server is getting it ready. This takes about a minute; you can close this and we will tell you when it is ready.'}
            </Text>
            <Button title="Done" icon="checkmark" fullWidth onPress={onClose} />
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function verdict(level: Loudness): string {
  switch (level) {
    case 'good':
      return 'Sounds clear';
    case 'quiet':
      return 'Sounds quiet';
    case 'clipping':
      return 'Sounds too loud';
    default:
      return `At least ${MIN_SECONDS} seconds needed`;
  }
}

/** The last few metering readings as bars, so you can see the phone hears you. */
function LevelMeter({ bars }: { bars: number[] }) {
  const t = useTokens();
  const shown = [...Array(Math.max(0, BARS - bars.length)).fill(0), ...bars] as number[];
  return (
    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="level-meter">
      {shown.map((v, i) => (
        <View key={i} style={[styles.bar, { height: 4 + v * 28, backgroundColor: v > 0.95 ? t.color.warning : v > 0.05 ? t.color.primary : t.color.surface3 }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  script: { padding: 14 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  centerText: { textAlign: 'center' },
  mic: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 32 },
  bar: { width: 4, borderRadius: 2 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  progress: { gap: 6 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  done: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  doneIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
