// Tapping a notification opens what it is about, including the tap that
// started the app from closed (which a response listener alone never sees).

const mockNavState = { current: undefined as { key: string } | undefined };
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useRootNavigationState: () => mockNavState.current,
}));

import { render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { NotificationTaps } from '../components/domain/NotificationTaps';

const tap = (data: Record<string, unknown>, actionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER) =>
  ({ actionIdentifier, notification: { request: { identifier: 'n-1', content: { data } } } }) as unknown as Notifications.NotificationResponse;

beforeEach(() => {
  jest.clearAllMocks();
  mockNavState.current = { key: 'root' };
});

test('the tap that opened the app goes to that call, once', async () => {
  jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tap({ event: 'hold_question', call_id: 'call-live-swiggy' }));
  await render(<NotificationTaps />);
  expect(router.push).toHaveBeenCalledWith('/call/call-live-swiggy');
  expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
});

test('waits for the navigator before opening anything', async () => {
  mockNavState.current = undefined;
  jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tap({ event: 'task_update', task: { id: 'task-1' } }));
  const view = await render(<NotificationTaps />);
  expect(router.push).not.toHaveBeenCalled();
  mockNavState.current = { key: 'root' };
  await view.rerender(<NotificationTaps />);
  expect(router.push).toHaveBeenCalledWith('/tasks');
});

test('an action button (Answer, I am busy) is handled in the shade, not by opening a screen', async () => {
  jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tap({ call_id: 'call-1' }, 'reply'));
  await render(<NotificationTaps />);
  expect(router.push).not.toHaveBeenCalled();
});

test('no tap, or one about nothing in particular, opens nothing', async () => {
  jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(null);
  const view = await render(<NotificationTaps />);
  jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tap({}));
  await view.rerender(<NotificationTaps />);
  expect(router.push).not.toHaveBeenCalled();
  expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
});
