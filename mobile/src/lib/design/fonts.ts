// One module per weight, so only these four files are bundled (not all 18).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';

// iOS and web load Inter at runtime. Android embeds it at build time
// (expo-font plugin in app.json), see fonts.android.ts.
export function useAppFonts(): { loaded: boolean; error: Error | null } {
  const [loaded, error] = useFonts({
    ...Ionicons.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  return { loaded, error };
}
