import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';

import { notificationRoute } from '../../lib/notifications';

/** Opens what a tapped notification is about. The last response also covers
 *  the tap that started the app from closed, which a plain listener misses.
 *  Waits for the navigator, which isn't there yet on the first frame. */
export function NotificationTaps() {
  const last = Notifications.useLastNotificationResponse();
  const navReady = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!navReady || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const to = notificationRoute(last.notification.request.content.data);
    // Handled: the next launch must not open it again.
    Notifications.clearLastNotificationResponse();
    if (to) router.push(to);
  }, [last, navReady]);
  return null;
}
