import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { allowNotifications, notificationAccess, notificationRoute } from '../notifications';

const permission = (status: `${Notifications.PermissionStatus}`, canAskAgain: boolean): Notifications.NotificationPermissionsStatus => ({
  status: status as Notifications.PermissionStatus,
  canAskAgain,
  granted: status === 'granted',
  expires: 'never',
});

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission('granted', true));
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(permission('granted', true));
});

describe('where a tapped notification opens', () => {
  test('a call, from a server push or the app', () => {
    expect(notificationRoute({ event: 'hold_question', call_id: 'call-1', question: 'Gate 2?' })).toBe('/call/call-1');
    expect(notificationRoute({ event: 'message_taken', call_id: 'call-2', message: { id: 'm1' } })).toBe('/call/call-2');
    expect(notificationRoute({ call_id: 'a b' })).toBe('/call/a%20b');
  });

  test('a task, whether the push carries the task or the app its id', () => {
    expect(notificationRoute({ event: 'task_update', task: { id: 'task-1', status: 'done' }, title: 'Booked' })).toBe('/tasks');
    expect(notificationRoute({ task_id: 'task-1' })).toBe('/tasks');
  });

  test('a message, or nothing for a test notification', () => {
    expect(notificationRoute({ message_id: 'm1' })).toBe('/inbox');
    expect(notificationRoute({})).toBeNull();
    expect(notificationRoute(null)).toBeNull();
    expect(notificationRoute({ call_id: '' })).toBeNull();
  });
});

describe('notification permission', () => {
  test('allowed, not asked yet, or blocked in Android settings', async () => {
    expect(await notificationAccess()).toBe('allowed');
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce(permission('undetermined', true));
    expect(await notificationAccess()).toBe('ask');
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce(permission('denied', false));
    expect(await notificationAccess()).toBe('blocked');
  });

  test('the web preview has none, and does not ask', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    try {
      expect(await notificationAccess()).toBe('unsupported');
      expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    }
  });

  test('Allow sets up the channels on yes, and says why on no', async () => {
    await expect(allowNotifications()).resolves.toBe('allowed');
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('calls-urgent', expect.objectContaining({ bypassDnd: true }));
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(permission('denied', true));
    await expect(allowNotifications()).rejects.toThrow('Notifications are still off.');
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(permission('denied', false));
    await expect(allowNotifications()).rejects.toThrow('Turn them on in Android settings.');
  });
});
