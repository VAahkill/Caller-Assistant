// First-run steps: the shared frame's buttons and where they lead. They need no
// live socket, so they render with the theme and toasts only.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import ContactsStep from '../../app/onboarding/contacts';
import DoneStep from '../../app/onboarding/done';
import Welcome from '../../app/onboarding/index';
import { onboardingSkipped } from '../../lib/onboarding';
import { storage } from '../../lib/storage';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderUI } from '../../test/render';

beforeEach(async () => {
  jest.clearAllMocks();
  await storage.remove('onboarding_skipped');
  await useMockServer();
});
afterEach(resetApi);

test('Set up later remembers the choice and goes to Today', async () => {
  await renderUI(<Welcome />);
  expect(screen.getByText("Answers when you can't")).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Set up later' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(await onboardingSkipped()).toBe(true);
});

test('the contacts step says what syncing gives you, and can be skipped', async () => {
  await renderUI(<ContactsStep />);
  expect(screen.getByLabelText('Step 4 of 6')).toBeTruthy();
  expect(screen.getByText('Greeted by name')).toBeTruthy();
  expect(screen.getByText('Only to your server')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sync contacts' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Skip this step' }));
  expect(router.push).toHaveBeenCalledWith('/onboarding/voice');
});

test('the last step offers a practice call or Today, and nothing to skip', async () => {
  await renderUI(<DoneStep />);
  expect(screen.queryByRole('button', { name: 'Set up later' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Skip this step' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Go to Today' }));
  expect(router.replace).toHaveBeenCalledWith('/');
  await fireEvent.press(screen.getByRole('button', { name: 'Start a practice call' }));
  expect(router.push).toHaveBeenCalledWith('/practice');
});
