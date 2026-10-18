import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useRef, useState } from 'react';

import { haptic } from '../lib/haptics';

export interface Recording {
  uri: string;
  durationMs: number;
}

export interface HoldToTalkOptions {
  onRecorded: (r: Recording) => void;
  /** Microphone permission was refused; explain and link to settings. */
  onPermissionDenied?: () => void;
  /** Recording couldn't start or finish. */
  onError?: (message: string) => void;
  /** Clips shorter than this are treated as an accidental tap. */
  minMs?: number;
}

export interface HoldToTalk {
  recording: boolean;
  /** Milliseconds recorded so far. */
  elapsedMs: number;
  /** 0..1 input level for a meter. */
  level: number;
  start: () => Promise<void>;
  /** Stops and delivers the clip; `cancel` throws it away. */
  stop: (cancel?: boolean) => Promise<void>;
}

const PRESET = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

/** Records while the mic is held (or between two taps) and hands back the file. */
export function useHoldToTalk({ onRecorded, onPermissionDenied, onError, minMs = 600 }: HoldToTalkOptions): HoldToTalk {
  const recorder = useAudioRecorder(PRESET);
  const state = useAudioRecorderState(recorder, 100);
  const [recording, setRecording] = useState(false);
  const starting = useRef<Promise<boolean> | null>(null);
  const startedAt = useRef(0);

  const start = useCallback(async () => {
    if (starting.current) return;
    const begin = async (): Promise<boolean> => {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        onPermissionDenied?.();
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setRecording(true);
      haptic.impact();
      return true;
    };
    starting.current = begin().catch((e: unknown) => {
      onError?.(`Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    });
    await starting.current;
  }, [recorder, onPermissionDenied, onError]);

  const stop = useCallback(
    async (cancel = false) => {
      const pending = starting.current;
      if (!pending) return;
      const began = await pending;
      starting.current = null;
      if (!began) return;
      const durationMs = Date.now() - startedAt.current;
      try {
        await recorder.stop();
      } catch (e) {
        setRecording(false);
        onError?.(`Couldn't finish recording: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (cancel) return;
      if (durationMs < minMs || !recorder.uri) {
        onError?.('Hold the mic a little longer while you speak.');
        return;
      }
      haptic.tap();
      onRecorded({ uri: recorder.uri, durationMs });
    },
    [recorder, minMs, onRecorded, onError],
  );

  // Metering is in dBFS (about -60 quiet to 0 loud).
  const db = state.metering ?? -160;
  const level = Math.max(0, Math.min(1, (db + 60) / 60));
  return { recording, elapsedMs: recording ? state.durationMillis : 0, level, start, stop };
}
