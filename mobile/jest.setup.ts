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
// expo-notifications refuses to load outside a development build; screens
// only need these calls to exist. Tests that check notifications spy on them.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  DEFAULT: 'default',
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  clearLastNotificationResponse: jest.fn(),
  useLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'notification-id'),
  setNotificationCategoryAsync: jest.fn(async () => null),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));
jest.mock('expo-contacts', () => ({
  ContactField: { FULL_NAME: 'fullName', PHONES: 'phones' },
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  Contact: { getAllDetails: jest.fn(async () => []) },
}));
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
