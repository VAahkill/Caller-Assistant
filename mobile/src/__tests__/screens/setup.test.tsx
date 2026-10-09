// Settings, Today and the Assistant setup screens against the in-memory v2 server.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
// The screen's navigation object: tests read the beforeRemove listener from it.
const mockNavigation = { listeners: {} as Record<string, (e: unknown) => void>, addListener: jest.fn(), dispatch: jest.fn() };
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useNavigation: () => mockNavigation,
}));
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

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Contact, requestPermissionsAsync } from 'expo-contacts';
import { router } from 'expo-router';
import { Linking } from 'react-native';

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

  test('Location: pin, then directions, then what the assistant will say', async () => {
    await renderScreen(<LocationScreen />);
    await screen.findByRole('button', { name: 'Saved' });
    expect(screen.getAllByTestId(/^location-/).map((n) => n.props.testID)).toEqual(['location-pin', 'location-directions', 'location-preview']);
    expect(screen.getByText('1. Pin your door')).toBeTruthy();
    expect(within(screen.getByTestId('location-pin')).getByRole('button', { name: 'My location' })).toBeTruthy();
    expect(within(screen.getByTestId('location-pin')).getByRole('button', { name: 'Paste Maps link' })).toBeTruthy();
    for (const label of ['Flat / house no. and floor', 'Building / society', 'Street and area', 'Landmark', 'Gate and entry']) {
      expect(within(screen.getByTestId('location-directions')).getByLabelText(label)).toBeTruthy();
    }
    expect(within(screen.getByTestId('location-preview')).getByText(/Only delivery partners hear these directions/)).toBeTruthy();
  });

  test('Location: the map line can fill in the street and area', async () => {
    await renderScreen(<LocationScreen />);
    await screen.findByRole('button', { name: 'Saved' });
    const hint = server.state.profile.location.geocoded_hint;
    await fireEvent.press(screen.getByRole('button', { name: 'Use this as the street and area' }));
    expect(screen.getByLabelText('Street and area').props.value).toBe(hint);
    expect(screen.getByRole('button', { name: 'Save location' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Use this as the street and area' })).toBeNull();
  });

  test('Location: leaving with unsaved changes asks first', async () => {
    mockNavigation.addListener.mockImplementation((name: string, cb: (e: unknown) => void) => {
      mockNavigation.listeners[name] = cb;
      return () => delete mockNavigation.listeners[name];
    });
    await renderScreen(<LocationScreen />);
    await screen.findByRole('button', { name: 'Saved' });
    const leave = async () => {
      const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
      await act(async () => mockNavigation.listeners.beforeRemove(e));
      return e;
    };
    // Nothing changed: it just goes.
    expect((await leave()).preventDefault).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Gate and entry'), 'Ring twice');
    const e = await leave();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(await screen.findByText('Leave without saving?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    await leave();
    await fireEvent.press(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' }));
    expect(requests('PUT', '/location')).toHaveLength(0);
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

  test('Screening: the country reads "India (+91)" and says it is not your phone number', async () => {
    await renderScreen(<Screening />);
    expect(await screen.findByText('India (+91)')).toBeTruthy();
    expect(screen.getByText('Not your phone number. It tells local callers from international ones.')).toBeTruthy();
  });

  test('Screening: contacts sync shows a spinner, a message and when it last ran', async () => {
    (Contact.getAllDetails as jest.Mock).mockResolvedValueOnce([
      { fullName: 'Amma', phones: [{ number: '098480 12345' }] },
      { fullName: 'Ravi', phones: [{ number: '+91 90000 11111' }, { number: '121' }] },
    ]);
    await renderScreen(<Screening />);
    const row = within(await screen.findByTestId('contacts-sync'));
    expect(row.getByText('3 numbers on your server · not synced from this phone yet')).toBeTruthy();
    await fireEvent.press(row.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Synced 2 numbers. Saved contacts always get through.')).toBeTruthy();
    expect(within(screen.getByTestId('contacts-sync')).getByText('Last synced just now · 2 numbers')).toBeTruthy();
    expect(requests('PUT', '/contacts')[0].body).toEqual([
      { number: '+919848012345', name: 'Amma' },
      { number: '+919000011111', name: 'Ravi' },
    ]);
  });

  test('Screening: contacts access turned off explains and opens Settings', async () => {
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    (requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
    await renderScreen(<Screening />);
    await fireEvent.press(within(await screen.findByTestId('contacts-sync')).getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Contacts access is off for OpenCall. Turn it on in Settings, then sync again.')).toBeTruthy();
    expect(requests('PUT', '/contacts')).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(settings).toHaveBeenCalledTimes(1);
  });

  test('Screening: a VIP can be picked from contacts, and a typed number is saved in full', async () => {
    await renderScreen(<Screening />);
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Add' }))[0]);
    await fireEvent.changeText(screen.getByLabelText('Phone number'), '098665 54433');
    expect(screen.getByText('Saved as +91 98665 54433 (Priya).')).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId('add-from-contacts')).getByRole('button', { name: /^Kiran \(office\),/ }));
    await waitFor(() => expect(server.state.profile.vip_numbers).toContain('+919177001122'));
    expect(await screen.findByText('Kiran (office) is now a VIP.')).toBeTruthy();
  });

  test('Screening: a blocked series is saved with the country code the server compares', async () => {
    await renderScreen(<Screening />);
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Add' }))[1]);
    await fireEvent.press(screen.getByRole('tab', { name: 'Numbers starting with' }));
    await fireEvent.changeText(screen.getByLabelText('Starts with'), '0120');
    expect(screen.getByText('Blocks every number starting +91120.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(server.state.profile.blocked_prefixes).toEqual(['+91140', '+91120']));
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
