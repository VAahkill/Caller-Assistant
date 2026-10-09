// Settings beyond connecting (which setup.test.tsx covers): connection health,
// forgetting the server, notification permission, appearance, and diagnostics.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => ''), setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import Settings from '../../app/(tabs)/settings';
import { api, loadConfig } from '../../lib/api';
import { LOGS_COMMAND } from '../../lib/diagnostics';
import { MOCK_TOKEN, type MockServer } from '../../lib/mock/server';
import { resetApi, TEST_URL, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
beforeEach(async () => {
  jest.clearAllMocks();
  server = await useMockServer();
});
afterEach(() => {
  jest.restoreAllMocks();
  return resetApi();
});

const healthChecks = () => server.log.filter((r) => r.method === 'GET' && r.path === '/health').length;

async function open() {
  await renderScreen(<Settings />);
  await screen.findByText('Connected');
  await screen.findByText('Bluetooth phone');
}

// expo-notifications is mocked in jest.setup.ts, so its PermissionStatus enum
// isn't there at run time; its values are these strings.
const permission = (status: `${Notifications.PermissionStatus}`, canAskAgain: boolean): Notifications.NotificationPermissionsStatus => ({
  status: status as Notifications.PermissionStatus,
  canAskAgain,
  granted: status === 'granted',
  expires: 'never',
});

describe('connection health', () => {
  test("shows how fast the server answers, how it calls out, the live calls and what's ready", async () => {
    server.state.health = { ...server.state.health, ready: { stt: true, lid: true, mt: true, llm: true, tts: false } };
    await open();
    const connection = within(screen.getByTestId('connection'));
    expect(connection.getByText(/^\d+ ms · Fast$/)).toBeTruthy();
    expect(connection.getByText('1')).toBeTruthy();
    expect(connection.getByText('4 of 5 ready')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('parts'));
    const sheet = within(await screen.findByTestId('readiness-sheet'));
    expect(sheet.getByLabelText('Voice: still loading')).toBeTruthy();
    expect(sheet.getByLabelText('Hearing: ready')).toBeTruthy();
  });

  test('Check again asks the server again and says when', async () => {
    await open();
    const before = healthChecks();
    expect(screen.getByText(/^Last checked /)).toBeTruthy();
    server.state.health = { ...server.state.health, dialer: 'asterisk' };
    await fireEvent.press(screen.getByTestId('check-again'));
    expect(await screen.findByText('Asterisk (SIP)')).toBeTruthy();
    expect(healthChecks()).toBe(before + 1);
  });

  test("a server that doesn't answer is said plainly, and Check again recovers", async () => {
    const down = jest.spyOn(api, 'health').mockRejectedValue(new Error("Couldn't reach your server at http://192.168.1.7:8000."));
    await renderScreen(<Settings />);
    const banner = within(await screen.findByTestId('health-error'));
    expect(banner.getByText("Your server didn't answer")).toBeTruthy();
    expect(banner.getByText("Couldn't reach your server at http://192.168.1.7:8000.")).toBeTruthy();
    expect(within(screen.getByTestId('connection')).getAllByText('–').length).toBeGreaterThan(0);
    down.mockRestore();
    await fireEvent.press(screen.getByTestId('check-again'));
    expect(await screen.findByText('Bluetooth phone')).toBeTruthy();
    expect(screen.queryByTestId('health-error')).toBeNull();
  });

  test('forgetting the server asks first, then removes the token and hides the health', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Forget this server' }));
    expect(await screen.findByText('Forget this server?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-sheet-cancel'));
    await waitFor(() => expect(screen.queryByText('Forget this server?')).toBeNull());
    expect(await loadConfig()).toEqual({ url: TEST_URL, token: MOCK_TOKEN });

    await fireEvent.press(screen.getByRole('button', { name: 'Forget this server' }));
    await fireEvent.press(await screen.findByTestId('confirm-sheet-confirm'));
    expect(await screen.findByText('This phone forgot the server.')).toBeTruthy();
    expect(await loadConfig()).toBeNull();
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.queryByTestId('connection')).toBeNull();
    // The address stays, to pair again; the token is gone.
    expect(screen.getByLabelText('Server address').props.value).toBe(TEST_URL);
    expect(screen.getByLabelText('Access token').props.value).toBe('');
    await waitFor(() => expect(screen.queryByText('Forget this server?')).toBeNull());
  });
});

describe('notifications', () => {
  test('when allowed, a test notification is sent and confirmed', async () => {
    await open();
    expect(within(screen.getByTestId('notification-access')).getByText('Allowed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('test-notification'));
    expect(await screen.findByText('Sent. Check your notification shade.')).toBeTruthy();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ title: 'Test notification' }) }));
  });

  test('not allowed yet: Allow asks Android and the row says the result', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce(permission('undetermined', true));
    await open();
    const access = within(screen.getByTestId('notification-access'));
    expect(access.getByText('Not allowed yet')).toBeTruthy();
    await fireEvent.press(access.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Notifications are on.')).toBeTruthy();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    await waitFor(() => expect(access.getByText('Allowed')).toBeTruthy());
  });

  test('a refusal is said, and the row then offers Android settings', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce(permission('undetermined', true)).mockResolvedValueOnce(permission('denied', false));
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(permission('denied', false));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await open();
    const access = within(screen.getByTestId('notification-access'));
    await fireEvent.press(access.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Android blocked notifications for OpenCall. Turn them on in Android settings.')).toBeTruthy();
    await waitFor(() => expect(access.getByText('Off')).toBeTruthy());
    await fireEvent.press(access.getByRole('button', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalled();
  });

  test('a test notification that cannot be shown says why, on the row', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission('denied', false));
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(permission('denied', false));
    await open();
    await fireEvent.press(screen.getByTestId('test-notification'));
    const why = 'Notifications are off for OpenCall. Turn them on in Android settings.';
    await waitFor(() => expect(screen.getAllByText(why).length).toBe(2)); // toast and row
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('appearance', () => {
  test('the theme can be System, Light or Dark', async () => {
    await open();
    const selected = (name: string) => screen.getByRole('tab', { name }).props.accessibilityState?.selected;
    expect(selected('Dark')).toBe(true); // the tests start in dark, like the owner's phone
    await fireEvent.press(screen.getByRole('tab', { name: 'Light' }));
    await waitFor(() => expect(selected('Light')).toBe(true));
    expect(selected('Dark')).toBe(false);
    expect(selected('System')).toBe(false);
  });
});

describe('about and diagnostics', () => {
  test('shows the app and server versions and the language model', async () => {
    await open();
    const about = within(screen.getByTestId('about'));
    expect(about.getByText('App version')).toBeTruthy();
    expect(about.getByText('2.0.0')).toBeTruthy();
    expect(about.getByText('qwen2.5-3b-instruct-q4_k_m')).toBeTruthy();
  });

  test('copies the logs command', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('copy-logs'));
    expect(await screen.findByText('Copied the command.')).toBeTruthy();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LOGS_COMMAND);
  });

  test('copies a diagnostics report without the token', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Copy diagnostics' }));
    expect(await screen.findByText('Copied. Paste it in a message or an issue. Your token is not in it.')).toBeTruthy();
    const report = jest.mocked(Clipboard.setStringAsync).mock.calls[0][0];
    expect(report).toContain(`Server: ${TEST_URL}`);
    expect(report).toContain('Live updates: connected');
    expect(report).toContain('Outbound calling: Bluetooth phone');
    expect(report).not.toContain(MOCK_TOKEN);
  });

  test('first-time setup can be run again', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Run first-time setup again' }));
    expect(router.push).toHaveBeenCalledWith('/onboarding');
  });
});
