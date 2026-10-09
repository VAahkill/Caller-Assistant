// With the server down, every screen that loads data says so in plain words
// and offers a way to try again, instead of spinning or showing nothing.

jest.mock('expo-file-system', () => require('../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => ''), setStringAsync: jest.fn(async () => true) }));
const mockNavigation = { addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() };
jest.mock('expo-router', () => {
  const { Fragment, createElement } = require('react');
  return {
    ...jest.requireActual('expo-router'),
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true },
    useLocalSearchParams: jest.fn(() => ({})),
    useNavigation: () => mockNavigation,
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: (p: object) => unknown } }) =>
        createElement(Fragment, null, options?.headerRight ? options.headerRight({}) : null),
    },
  };
});
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = require('react-native');
  return { Map: View, Camera: () => null, Marker: View };
});

import { act, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import type { ComponentType } from 'react';

import AssistantHub from '../app/(tabs)/assistant';
import Inbox from '../app/(tabs)/inbox';
import Today from '../app/(tabs)/index';
import Settings from '../app/(tabs)/settings';
import CallForMe from '../app/(tabs)/tasks';
import Away from '../app/away';
import CallScreen from '../app/call/[id]';
import Instructions from '../app/instructions';
import Languages from '../app/languages';
import LocationScreen from '../app/location';
import Notes from '../app/notes';
import Persona from '../app/persona';
import Screening from '../app/screening';
import Voices from '../app/voices';
import { OFFLINE } from '../lib/api';
import { MockEventsSocket } from '../lib/mock/socket';
import { setTransport } from '../lib/transport';
import { resetApi, useMockServer } from '../test/mockApi';
import { renderScreen } from '../test/renderScreen';

beforeEach(async () => {
  await useMockServer();
  // Nothing answers: every request fails as the platform's fetch does offline.
  setTransport({
    fetch: async () => Promise.reject(new TypeError('Network request failed')),
    openSocket: () => MockEventsSocket.refused(),
    upload: async () => Promise.reject(new TypeError('Network request failed')),
  });
});
afterEach(resetApi);

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const SCREENS: { name: string; Screen: ComponentType; params?: Record<string, string> }[] = [
  { name: 'Today', Screen: Today },
  { name: 'Inbox', Screen: Inbox },
  { name: 'Call for me', Screen: CallForMe },
  { name: 'Assistant', Screen: AssistantHub },
  { name: 'Settings', Screen: Settings },
  { name: 'A call', Screen: CallScreen, params: { id: 'call-rajesh' } },
  { name: 'Voices', Screen: Voices },
  { name: 'Instructions', Screen: Instructions },
  { name: 'Notes', Screen: Notes },
  { name: 'Location', Screen: LocationScreen },
  { name: 'Persona', Screen: Persona },
  { name: 'Languages', Screen: Languages },
  { name: 'Screening', Screen: Screening },
  { name: 'Away', Screen: Away },
];

test.each(SCREENS)('$name says the server could not be reached, with a way to retry', async ({ Screen, params }) => {
  jest.mocked(useLocalSearchParams).mockReturnValue(params ?? {});
  const view = await renderScreen(<Screen />);
  await settle();
  expect(screen.queryAllByText(OFFLINE, { exact: false }).length).toBeGreaterThan(0);
  expect(screen.queryByText('Network request failed', { exact: false })).toBeNull();
  const retry = screen.queryAllByRole('button', { name: /^(Retry|Try again|Check)$/ });
  expect(retry.length).toBeGreaterThan(0);
  await view.unmount();
});
