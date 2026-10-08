// Native modules that have no JS fallback in the test runtime.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-audio', () => require('./src/test/expoAudioMock').expoAudioMock);
// The device keystore, in memory.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

// The app runs with React Native's FormData, patched by expo exactly as
// expo/src/winter/runtime.native.ts does; Node's own FormData would turn file
// parts into strings and hide upload bugs. (jest-expo replaces the patch with
// a no-op, so this takes the real one.)
{
  const RNFormData = require('react-native/Libraries/Network/FormData').default;
  jest.requireActual('expo/src/winter/FormData').installFormDataPatch(RNFormData);
  (globalThis as { FormData: unknown }).FormData = RNFormData;
}
