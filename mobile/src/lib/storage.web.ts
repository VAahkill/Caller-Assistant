// Web build only (screenshot checks): expo-secure-store has no web version.
export const storage = {
  get: async (key: string): Promise<string | null> => window.localStorage.getItem(key),
  set: async (key: string, value: string): Promise<void> => window.localStorage.setItem(key, value),
  remove: async (key: string): Promise<void> => window.localStorage.removeItem(key),
};
