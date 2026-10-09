// Where back leads, with the real router: a screen opened from a link, and
// leaving first-time setup on a first run or when run again from Settings.

jest.mock('expo-file-system', () => require('../test/expoFileSystemMock').expoFileSystemMock);
// The root layout holds the splash at import; there is no splash in a test.
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => true), setOptions: jest.fn() }));

import { router, Stack } from 'expo-router';
import { act, cleanup, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

import TabsLayout from '../app/(tabs)/_layout';
import { unstable_settings } from '../app/_layout';
import DoneStep from '../app/onboarding/done';
import Welcome from '../app/onboarding/index';
import { LiveProvider } from '../lib/live';
import { finishOnboarding, onboardingDone } from '../lib/onboarding';
import { storage } from '../lib/storage';
import { Providers } from '../test/render';

type State = { routes: { name: string; state?: State }[] } | undefined;

function standIn(name: string) {
  const StandIn = () => <Text>{name} screen</Text>;
  StandIn.displayName = `${name}StandIn`;
  return StandIn;
}

/** The app's routes: the real root setting, tabs (with the first-run gate)
 *  and setup steps; stand-ins for the tab screens and the call screen. */
const app = {
  _layout: { default: () => <Stack />, unstable_settings },
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': standIn('Today'),
  '(tabs)/inbox': standIn('Inbox'),
  '(tabs)/tasks': standIn('Call for me'),
  '(tabs)/assistant': standIn('Assistant'),
  '(tabs)/settings': standIn('Settings'),
  'onboarding/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  'onboarding/index': Welcome,
  'onboarding/done': DoneStep,
  'call/[id]': standIn('Call'),
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <LiveProvider>{children}</LiveProvider>
    </Providers>
  );
}

async function open(initialUrl: string) {
  const r = renderRouter(app, { initialUrl, wrapper: Wrapper });
  await r; // rendering is async; the router helpers are on the returned promise
  return {
    pathname: () => r.getPathname(),
    /** The root stack as names, e.g. "(tabs), call/[id]". */
    stack: () => (r.getRouterState() as State)?.routes[0]?.state?.routes.map((x) => x.name).join(', '),
  };
}

beforeEach(() => storage.remove('onboarding_done'));
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

test('a call opened from a link has Today under it to go back to', async () => {
  await finishOnboarding();
  const r = await open('/call/call-rajesh');
  expect(await screen.findByText('Call screen')).toBeTruthy();
  expect(r.stack()).toBe('(tabs), call/[id]');
  await act(async () => router.back());
  expect(await screen.findByText('Today screen')).toBeTruthy();
  expect(r.pathname()).toBe('/');
});

test('on a first run, setup opens alone and leaving it goes to Today with nothing behind', async () => {
  const r = await open('/');
  await fireEvent.press(await screen.findByRole('button', { name: 'Set up later' }));
  expect(await screen.findByText('Today screen')).toBeTruthy();
  expect(r.stack()).toBe('(tabs)');
  expect(router.canGoBack()).toBe(false);
  expect(await onboardingDone()).toBe(true);
});

test('setup run again from Settings closes back onto the same tabs, not a second copy', async () => {
  await finishOnboarding();
  const r = await open('/settings');
  expect(await screen.findByText('Settings screen')).toBeTruthy();
  await act(async () => router.push('/onboarding/done'));
  expect(r.stack()).toBe('(tabs), onboarding');
  await fireEvent.press(await screen.findByRole('button', { name: 'Go to Today' }));
  expect(await screen.findByText('Today screen')).toBeTruthy();
  expect(r.pathname()).toBe('/');
  expect(r.stack()).toBe('(tabs)');
  expect(router.canGoBack()).toBe(false);
});
