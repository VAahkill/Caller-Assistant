import * as Notifications from 'expo-notifications';
import { router, Stack, ThemeProvider as NavigationThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { ConfirmProvider } from '../components/ui/ConfirmSheet';
import { TAB_BAR_HEIGHT, ToastProvider } from '../components/ui/Toast';
import { navigationTheme, stackOptions, useAppFonts } from '../lib/design';
import { ThemeProvider, useThemePreference, useTokens } from '../lib/design/theme';
import { loadConfig } from '../lib/api';
import { LiveProvider } from '../lib/live';
import { listenForNotificationReplies, setupNotifications } from '../lib/notifications';

// Keep the (dark) splash up until fonts and the saved theme are ready, so the
// first frame is already in the right colours: no white flash.
SplashScreen.preventAutoHideAsync().catch((e: unknown) => console.warn("Couldn't hold the splash screen", e));
SplashScreen.setOptions({ fade: true, duration: 200 });

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </KeyboardProvider>
  );
}

function AppShell() {
  const t = useTokens();
  const { ready } = useThemePreference();
  const fonts = useAppFonts();
  const segments = useSegments();
  const fontsSettled = fonts.loaded || !!fonts.error;

  useEffect(() => {
    if (fonts.error) console.warn('Icon font failed to load; icons may be missing.', fonts.error);
  }, [fonts.error]);

  useEffect(() => {
    if (fontsSettled && ready) {
      SplashScreen.hideAsync().catch((e: unknown) => console.warn("Couldn't hide the splash screen", e));
    }
  }, [fontsSettled, ready]);

  if (!fontsSettled || !ready) return null;

  const inTabs = segments[0] === '(tabs)';
  const header = stackOptions(t);
  return (
    <NavigationThemeProvider value={navigationTheme(t)}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <ToastProvider bottomOffset={inTabs ? TAB_BAR_HEIGHT : 0}>
        <ConfirmProvider>
          <LiveProvider>
            <NotificationRouting />
            <Stack screenOptions={header}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen name="call/[id]" options={{ title: '' }} />
              <Stack.Screen name="chat" options={{ title: 'Ask your assistant' }} />
              <Stack.Screen name="practice" options={{ title: 'Practice call' }} />
              <Stack.Screen name="voices" options={{ title: 'Voices' }} />
              <Stack.Screen name="instructions" options={{ title: 'Instructions' }} />
              <Stack.Screen name="notes" options={{ title: 'What callers may know' }} />
              <Stack.Screen name="location" options={{ title: 'Delivery location' }} />
              <Stack.Screen name="persona" options={{ title: 'You and your assistant' }} />
              <Stack.Screen name="languages" options={{ title: 'Languages' }} />
              <Stack.Screen name="screening" options={{ title: 'Who gets through' }} />
              <Stack.Screen name="away" options={{ title: 'Away' }} />
              <Stack.Screen name="gallery" options={{ title: 'Components' }} />
            </Stack>
          </LiveProvider>
        </ConfirmProvider>
      </ToastProvider>
    </NavigationThemeProvider>
  );
}

/** Registers for notifications and opens the right screen when one is tapped. */
function NotificationRouting() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    loadConfig()
      .then((cfg) => (cfg ? setupNotifications() : undefined))
      .catch((e: unknown) => console.warn('Notification setup failed; the app still shows live events while open.', e));
    const stopReplies = listenForNotificationReplies();
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      if (r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = r.notification.request.content.data as { call_id?: string; message_id?: string; task_id?: string };
      if (data?.call_id) router.push(`/call/${data.call_id}`);
      else if (data?.message_id) router.push('/inbox');
      else if (data?.task_id) router.push('/tasks');
    });
    return () => {
      stopReplies();
      tap.remove();
    };
  }, []);
  return null;
}
