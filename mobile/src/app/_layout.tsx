import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';

import { loadConfig } from '../lib/api';
import { LiveProvider } from '../lib/live';
import { listenForNotificationReplies, setupNotifications } from '../lib/notifications';
import { useTheme } from '../lib/theme';

export default function RootLayout() {
  const t = useTheme();

  useEffect(() => {
    loadConfig().then((cfg) => cfg && setupNotifications().catch(() => {}));
    const stopReplies = listenForNotificationReplies();
    // Tapping a notification opens the matching live transcript.
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      if (r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = r.notification.request.content.data as { call_id?: string };
      if (data?.call_id) router.push(`/call/${data.call_id}`);
    });
    return () => {
      stopReplies();
      tap.remove();
    };
  }, []);

  return (
    <LiveProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="call/[id]" options={{ title: 'Live call' }} />
        <Stack.Screen name="practice" options={{ title: 'Practice call' }} />
        <Stack.Screen name="location" options={{ title: 'Delivery location' }} />
        <Stack.Screen name="voices" options={{ title: 'Voices' }} />
        <Stack.Screen name="instructions" options={{ title: 'Instructions & notes' }} />
      </Stack>
    </LiveProvider>
  );
}
