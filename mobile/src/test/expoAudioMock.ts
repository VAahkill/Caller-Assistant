// A stand-in for expo-audio's native player and recorder in tests.
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
};

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
  useAudioRecorderState: jest.fn(() => ({ isRecording: false, durationMillis: 0, metering: -160, canRecord: true })),
  useAudioPlayer: jest.fn(() => player),
  useAudioPlayerStatus: jest.fn(() => idleStatus),
  createAudioPlayer: jest.fn(() => mockPlayer()),
  preload: jest.fn(() => Promise.resolve()),
  clearAllPreloadedSources: jest.fn(() => Promise.resolve()),
  AudioModule: { requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })) },
};
