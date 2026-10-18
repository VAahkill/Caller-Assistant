// A stand-in for expo-audio's native player and recorder in tests.
// setPlayerStatus / setRecorderState change what the hooks report, as the
// native side would while a clip plays or the microphone records.
import { useSyncExternalStore } from 'react';

export const mockPlayer = () => ({
  play: jest.fn(),
  pause: jest.fn(),
  replace: jest.fn(),
  remove: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
  setPlaybackRate: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  playing: false,
});

/** The player every useAudioPlayer() call returns, so tests can assert on it. */
export const player = mockPlayer();

export const idleStatus = {
  id: 'p',
  currentTime: 0,
  playbackState: 'ready',
  timeControlStatus: 'paused',
  reasonForWaitingToPlay: '',
  mute: false,
  duration: 12,
  playing: false,
  loop: false,
  didJustFinish: false,
  isBuffering: false,
  isLoaded: true,
  playbackRate: 1,
  shouldCorrectPitch: true,
  error: null as string | null,
};

export const idleRecorderState = { isRecording: false, durationMillis: 0, metering: -160 as number | undefined, canRecord: true };

function store<T extends object>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (next: Partial<T>) => {
      value = { ...value, ...next };
      subs.forEach((f) => f());
    },
    reset: () => {
      value = initial;
      subs.forEach((f) => f());
    },
    subscribe: (f: () => void) => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

const playerStatus = store(idleStatus);
const recorderState = store(idleRecorderState);

/** What useAudioPlayerStatus reports from now on (wrap in act). */
export const setPlayerStatus = playerStatus.set;
/** What useAudioRecorderState reports from now on (wrap in act). */
export const setRecorderState = recorderState.set;
export function resetAudioMock() {
  playerStatus.reset();
  recorderState.reset();
}

export const recorder = {
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  uri: 'file:///data/user/0/org.opencall.receptionist/cache/Audio/recording-1.m4a',
};

export const expoAudioMock = {
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 } },
  requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, status: 'granted' })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  useAudioRecorder: jest.fn(() => recorder),
  useAudioRecorderState: jest.fn(() => useSyncExternalStore(recorderState.subscribe, recorderState.get)),
  useAudioPlayer: jest.fn(() => player),
  useAudioPlayerStatus: jest.fn(() => useSyncExternalStore(playerStatus.subscribe, playerStatus.get)),
  createAudioPlayer: jest.fn(() => mockPlayer()),
  preload: jest.fn(() => Promise.resolve()),
  clearPreloadedSource: jest.fn(() => Promise.resolve()),
  clearAllPreloadedSources: jest.fn(() => Promise.resolve()),
  AudioModule: { requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })) },
};
