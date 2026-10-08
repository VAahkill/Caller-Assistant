import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Haptics are a nicety: if the device can't vibrate we log and carry on.
function run(p: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  Promise.resolve()
    .then(p)
    .catch((e: unknown) => console.warn('Haptic feedback failed', e));
}

export const haptic = {
  tap: () => run(() => Haptics.selectionAsync()),
  impact: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
