// A fresh install on a fresh server: no calls, messages, tasks, rules, notes
// or recorded voices. Each screen says what will appear there, not a blank.

jest.mock('expo-file-system', () => require('../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => ''), setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

import { act, screen, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import Inbox from '../app/(tabs)/inbox';
import Today from '../app/(tabs)/index';
import CallForMe from '../app/(tabs)/tasks';
import Instructions from '../app/instructions';
import Notes from '../app/notes';
import Voices from '../app/voices';
import type { MockServer } from '../lib/mock/server';
import { resetApi, useMockServer } from '../test/mockApi';
import { renderScreen } from '../test/renderScreen';

let server: MockServer;
beforeEach(async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  server = await useMockServer();
  const s = server.state;
  s.calls = [];
  s.messages = [];
  s.tasks = [];
  s.voices = s.voices.filter((v) => v.kind !== 'clone');
  s.profile = { ...s.profile, instructions: [], knowledge: [], away: null, user_name: 'Arjun' };
});
afterEach(resetApi);

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

test('Today: nothing needs you, and says where messages will appear', async () => {
  await renderScreen(<Today />);
  await settle();
  expect(screen.getByText('No messages yet')).toBeTruthy();
  expect(screen.queryByText(/^Needs you/)).toBeNull();
});

test('Inbox messages tab: says what will appear', async () => {
  await renderScreen(<Inbox />);
  await settle();
  const inbox = within(screen.getByTestId('inbox'));
  expect(inbox.queryAllByText(/no messages|nothing|will appear|show up/i).length).toBeGreaterThan(0);
});

test('Inbox calls tab: says what will appear', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ tab: 'calls' });
  await renderScreen(<Inbox />);
  await settle();
  expect(within(screen.getByTestId('inbox')).queryAllByText(/no calls|nothing|will appear|show up/i).length).toBeGreaterThan(0);
});

test('Call for me: the form is there and the empty list explains itself', async () => {
  await renderScreen(<CallForMe />);
  await settle();
  expect(screen.getByTestId('start-task')).toBeTruthy();
  expect(screen.queryByTestId('tasks-active')).toBeNull();
  expect(screen.queryAllByText(/no calls|nothing|will appear|show up|yet/i).length).toBeGreaterThan(0);
});

test('Instructions and notes start with an empty state and ideas', async () => {
  await renderScreen(<Instructions />);
  await settle();
  expect(screen.queryAllByText(/no (rules|instructions)|yet/i).length).toBeGreaterThan(0);
  await renderScreen(<Notes />);
  await settle();
  expect(screen.getByText('No notes yet')).toBeTruthy();
});

test('Voices without a recorded voice offers recording one', async () => {
  await renderScreen(<Voices />);
  await settle();
  expect(screen.getByRole('button', { name: 'Record your voice' })).toBeTruthy();
});
