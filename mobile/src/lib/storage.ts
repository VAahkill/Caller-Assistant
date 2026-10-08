import * as SecureStore from 'expo-secure-store';

// Small values kept in the device keystore: the server address and token, and
// app preferences. The web build (screenshots only) uses storage.web.ts.
export const storage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};
