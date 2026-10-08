// Settings, Today and the Assistant setup screens against the in-memory v2 server.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = require('react-native');
  return { Map: View, Camera: () => null, Marker: View };
});
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 17.45, longitude: 78.38 } })),
  reverseGeocodeAsync: jest.fn(async () => [{ street: 'Road No. 2', district: 'Kondapur', city: 'Hyderabad', postalCode: '500084' }]),
}));

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import AssistantHub from '../../app/(tabs)/assistant';
import Today from '../../app/(tabs)/index';
import Settings from '../../app/(tabs)/settings';
import Away from '../../app/away';
import Languages from '../../app/languages';
import LocationScreen from '../../app/location';
import Screening from '../../app/screening';
import { BAD_ADDRESS, BAD_TOKEN, clearConfig } from '../../lib/api';
import { prettyNumber } from '../../lib/format';
import type { MockServer } from '../../lib/mock/server';
import { resetApi, TEST_URL, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
afterEach(resetApi);

const requests = (method: string, path: string) => server.log.filter((r) => r.method === method && r.path === path);

describe('Settings', () => {
  beforeEach(async () => {
    server = await useMockServer({ checkToken: true });
  });

  test('shows the saved server and connects with a toast naming the dialer', async () => {
    await renderScreen(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Server address').props.value).toBe(TEST_URL));
    expect(await screen.findByText('Connected')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/^Connected\. Outbound calling:/)).toBeTruthy();
  });

  test('a malformed address is explained before anything is sent', async () => {
    await renderScreen(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Server address').props.value).toBe(TEST_URL));
    await fireEvent.changeText(screen.getByLabelText('Server address'), 'my server');
    expect(screen.getByText(BAD_ADDRESS)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair with code' })).toBeDisabled();
  });

  test('a wrong token says where to find the right one, inline', async () => {
    await renderScreen(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Access token').props.value).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Access token'), 'wrong');
    await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('connect-error')).toHaveTextContent(BAD_TOKEN);
  });

  test('pairing with the code from the server log fills in the token and connects', async () => {
    await clearConfig();
    await renderScreen(<Settings />);
    await fireEvent.changeText(screen.getByLabelText('Server address'), '192.168.1.7:8000');
    await fireEvent.press(screen.getByRole('button', { name: 'Pair with code' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Get a code' }));
    await fireEvent.changeText(await screen.findByLabelText('Pairing code'), '48-29-13');
    await fireEvent.press(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText(/^Connected\. Outbound calling:/)).toBeTruthy();
    expect(requests('POST', '/pair/finish')[0].body).toEqual({ code: '482913' });
  });
});

describe('Today and the Assistant hub', () => {
  beforeEach(async () => {
    server = await useMockServer();
  });

  test('Today greets the owner and lists what needs them from the live socket', async () => {
    await renderScreen(<Today />);
    expect(await screen.findByText(/, Arjun$/)).toBeTruthy();
    // The caller on hold asks something only the owner can answer.
    expect(await screen.findByText(/^Needs you · \d+$/)).toBeTruthy();
    expect(screen.getByText('Live now')).toBeTruthy();
    expect(screen.getByText('Answered')).toBeTruthy();
  });

  test('the hub summarises every area and opens it', async () => {
    await renderScreen(<AssistantHub />);
    expect(await screen.findByText('Ava answers for Arjun')).toBeTruthy();
    expect(screen.getByText('4 rules in use')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Delivery location/ }));
    expect(router.push).toHaveBeenCalledWith('/location');
  });
});

describe('Setup screens', () => {
  beforeEach(async () => {
    server = await useMockServer();
  });

  test('Location: Save is off until something changes, then saves and says so', async () => {
    await renderScreen(<LocationScreen />);
    const save = await screen.findByRole('button', { name: 'Saved' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/^Flat 402, 4th floor, Lakeview Residency, Block B, Road No\. 2, Kondapur\./)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Landmark'), 'Opposite Ratnadeep');
    await fireEvent.press(screen.getByRole('button', { name: 'Behind' }));
    expect(screen.getByLabelText('Landmark').props.value).toBe('Opposite Ratnadeep, behind');
    await fireEvent.press(screen.getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(requests('PUT', '/location')).toHaveLength(1));
    expect(requests('PUT', '/location')[0].body).toMatchObject({ landmarks: 'Opposite Ratnadeep, behind', lat: 17.4612 });
    expect(await screen.findByText('Location saved. Delivery partners get these directions.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  test('Location: a Maps link moves the pin and the map line updates', async () => {
    await renderScreen(<LocationScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Paste Maps link' }));
    await fireEvent.changeText(screen.getByLabelText('Google Maps link'), 'https://www.google.com/maps/@17.4501,78.3812,17z');
    await fireEvent.press(screen.getByRole('button', { name: 'Set pin' }));
    expect(await screen.findByText('Pin set from your link. Check it on the map, then save.')).toBeTruthy();
    expect(await screen.findByText('Road No. 2, Kondapur, Hyderabad 500084')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save location' })).toBeEnabled();
  });

  test('Screening: add a VIP, and unblock a number with Undo', async () => {
    const blocked = server.state.profile.blocked_numbers[0];
    await renderScreen(<Screening />);
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Add' }))[0]);
    await fireEvent.changeText(screen.getByLabelText('Phone number'), '+91 98665 54433');
    await fireEvent.press(screen.getByRole('button', { name: 'Add VIP' }));
    await waitFor(() => expect(server.state.profile.vip_numbers).toContain('+919866554433'));

    await fireEvent.press(screen.getByRole('button', { name: `Unblock ${prettyNumber(blocked)}` }));
    await waitFor(() => expect(server.state.profile.blocked_numbers).not.toContain(blocked));
    await fireEvent.press(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(server.state.profile.blocked_numbers).toContain(blocked));
  });

  test('Languages: reorder and add caller languages', async () => {
    // The fixture starts with Telugu, English, Hindi, Tamil.
    await renderScreen(<Languages />);
    expect(await screen.findByRole('button', { name: 'Move Telugu up' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Move Hindi up' }));
    await waitFor(() => expect(server.state.profile.caller_languages).toEqual(['te', 'hi', 'en', 'ta']));
    await fireEvent.press(screen.getByRole('button', { name: 'Kannada' }));
    await waitFor(() => expect(server.state.profile.caller_languages).toEqual(['te', 'hi', 'en', 'ta', 'kn']));
    expect(screen.getByText('First guess')).toBeTruthy();
  });

  test('Away: a preset and length make the message; I am back clears it', async () => {
    await renderScreen(<Away />);
    expect(await screen.findByText(server.state.profile.away!.message)).toBeTruthy();
    // The message already says "until ...", so the card doesn't repeat the end time.
    expect(screen.queryByText(/^Ends at /)).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Driving' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Until I turn it off' }));
    expect(screen.getByLabelText('Away message').props.value).toBe('Driving');
    await fireEvent.press(screen.getByRole('button', { name: 'Update away status' }));
    await waitFor(() => expect(requests('PUT', '/away')).toHaveLength(1));
    expect(requests('PUT', '/away')[0].body).toEqual({ preset: 'driving', message: 'Driving', until: null });

    await fireEvent.press(await screen.findByRole('button', { name: "I'm back" }));
    await waitFor(() => expect(requests('DELETE', '/away')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'Set away' })).toBeTruthy();
    expect(within(screen.getByTestId('away')).queryByText('You are away')).toBeNull();
  });
});
