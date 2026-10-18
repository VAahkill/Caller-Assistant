import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';

// Inter is embedded in the APK by the expo-font plugin (app.json), so its
// family names (Inter_400Regular, ...) resolve without loading anything.
// Only the icon font is loaded, while the splash screen is still up.
export function useAppFonts(): { loaded: boolean; error: Error | null } {
  const [loaded, error] = useFonts(Ionicons.font);
  return { loaded, error };
}
