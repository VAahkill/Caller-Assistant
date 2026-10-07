import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

// "hold" notifications carry a reply box, so the user can answer a caller's
// question straight from the notification shade without opening the app.
export const HOLD_CATEGORY = 'hold';

// When the server can push to this phone we let it; otherwise the app raises
// local notifications from the live event stream while it is running.
export let pushRegistered = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('calls', {
      name: 'Calls being answered',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync('calls-urgent', {
      name: 'Caller is waiting for you',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400, 200, 400],
      bypassDnd: true,
    });
  }
  await Notifications.setNotificationCategoryAsync(HOLD_CATEGORY, [
    {
      identifier: 'reply',
      buttonTitle: 'Answer',
      textInput: { submitButtonTitle: 'Send', placeholder: 'Type what to tell them' },
      options: { opensAppToForeground: false },
    },
    { identifier: 'unavailable', buttonTitle: "I'm busy, take a message", options: { opensAppToForeground: false } },
  ]);

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted' || !Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.registerPush(token.data);
    pushRegistered = true;
  } catch (e) {
    console.warn('Push registration failed; live events still work while the app is open.', e);
  }
}

/** Handles taps on the "Answer" box of a hold notification. */
export function listenForNotificationReplies(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
    const data = response.notification.request.content.data as { call_id?: string; hold_id?: string };
    if (!data?.call_id) return;
    if (response.actionIdentifier === 'reply' && response.userText) {
      await api.answer(data.call_id, response.userText, data.hold_id).catch(() => {});
    } else if (response.actionIdentifier === 'unavailable') {
      await api
        .answer(data.call_id, "I'm not available right now, please take a message.", data.hold_id)
        .catch(() => {});
    }
  });
  return () => sub.remove();
}

export async function notifyLocal(title: string, body: string, data: Record<string, unknown>, hold = false) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      categoryIdentifier: hold ? HOLD_CATEGORY : undefined,
      sound: 'default',
    },
    trigger: Platform.OS === 'android' ? { channelId: hold ? 'calls-urgent' : 'calls' } : null,
  });
}
