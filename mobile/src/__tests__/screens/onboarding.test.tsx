// First-run steps: the shared frame's buttons and where they lead, the steps
// that need the server, and the voice step's instant demos.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
}));

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { preload } from 'expo-audio';
import { router } from 'expo-router';

import ContactsStep from '../../app/onboarding/contacts';
import DoneStep from '../../app/onboarding/done';
import Welcome from '../../app/onboarding/index';
import NamesStep from '../../app/onboarding/names';
import VoiceStep, { ONBOARDING_VOICES_PER_LANGUAGE } from '../../app/onboarding/voice';
import { clearConfig, saveConfig } from '../../lib/api';
import type { MockServer } from '../../lib/mock/server';
import { finishOnboarding, onboardingDone, resetOnboarding, shouldShowOnboarding } from '../../lib/onboarding';
import { player, resetAudioMock, setPlayerStatus } from '../../test/expoAudioMock';
import { TEST_URL, resetApi, useMockServer } from '../../test/mockApi';
import { renderUI } from '../../test/render';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
beforeEach(async () => {
  jest.clearAllMocks();
  resetAudioMock();
  await resetOnboarding();
  server = await useMockServer();
});
afterEach(resetApi);

describe('who sees setup', () => {
  test('a first run with no server shows it', async () => {
    await clearConfig();
    expect(await shouldShowOnboarding()).toBe(true);
  });

  test('someone already connected skips it, e.g. after an update', async () => {
    expect(await shouldShowOnboarding()).toBe(false);
  });

  test('once finished or put off, it never comes back, even with no server', async () => {
    await clearConfig();
    await finishOnboarding();
    expect(await shouldShowOnboarding()).toBe(false);
    await resetOnboarding();
    expect(await shouldShowOnboarding()).toBe(true);
  });
});

test('Set up later remembers the choice and goes to Today', async () => {
  await renderUI(<Welcome />);
  expect(screen.getByText("Answers when you can't")).toBeTruthy();
  expect(screen.getByText('Translates live')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Set up later' }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(await onboardingDone()).toBe(true);
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

describe('steps that save to the server', () => {
  test('without a server they explain, offer Connect, and still let you move on', async () => {
    await clearConfig();
    await renderScreen(<NamesStep />);
    const banner = within(await screen.findByTestId('onboarding-offline'));
    expect(banner.getByText('Connect to your server first')).toBeTruthy();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    await fireEvent.press(banner.getByRole('button', { name: 'Connect' }));
    expect(router.navigate).toHaveBeenCalledWith('/onboarding/connect');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(router.push).toHaveBeenCalledWith('/onboarding/region');
  });

  test('names start empty instead of the server stand-in, and save before moving on', async () => {
    server.state.profile = { ...server.state.profile, user_name: 'the user' };
    await renderScreen(<NamesStep />);
    await waitFor(() => expect(screen.getByLabelText('Assistant\'s name').props.value).toBe('Ava'));
    expect(screen.getByLabelText('Your name').props.value).toBe('');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Arjun');
    expect(screen.getByText("Hi, this is Ava, Arjun's assistant. Arjun can't take the call right now. How can I help?")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/onboarding/region'));
    expect(server.state.profile.user_name).toBe('Arjun');
  });
});

describe('the voice step', () => {
  async function open() {
    await renderScreen(<VoiceStep />);
    await screen.findByTestId('voices-te');
  }

  test('one group per caller language, a few voices each, demos fetched up front', async () => {
    await open();
    expect(screen.getAllByTestId(/^voices-[a-z]{2}$/).map((n) => n.props.testID)).toEqual(['voices-te', 'voices-en', 'voices-hi', 'voices-ta']);
    // English has my voice and three built-ins: only the first few show here.
    expect(within(screen.getByTestId('voices-en')).getAllByRole('radio')).toHaveLength(ONBOARDING_VOICES_PER_LANGUAGE);
    expect(screen.getByRole('radio', { name: 'Padmavathi, female, for Telugu' }).props.accessibilityState).toMatchObject({ checked: true });
    await waitFor(() => expect(preload).toHaveBeenCalledWith(expect.objectContaining({ uri: `${TEST_URL}/voices/${encodeURIComponent('mms:ta')}/sample.wav?lang=ta&v=3f2a1c` })));
  });

  test('play starts at once and tapping again stops it', async () => {
    await open();
    const play = screen.getByRole('button', { name: 'Play Venkatesh' });
    await fireEvent.press(play);
    expect(player.replace).toHaveBeenCalledWith(expect.objectContaining({ uri: expect.stringContaining('te_IN-venkatesh-medium') }));
    expect(player.play).toHaveBeenCalled();
    await act(() => setPlayerStatus({ playing: true }));
    expect(await screen.findByText('Playing…')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Stop Venkatesh' }));
    expect(player.pause).toHaveBeenCalled();
  });

  test('picking a voice saves it for that language and says so', async () => {
    await open();
    await fireEvent.press(screen.getByRole('radio', { name: 'Tamil, for Tamil' }));
    expect(await screen.findByText('Tamil will answer Tamil callers.')).toBeTruthy();
    expect(server.state.profile.voices_by_language.ta).toBe('mms:ta');
    // English is also the main voice.
    await fireEvent.press(screen.getByRole('radio', { name: 'Bella, female, for English' }));
    await waitFor(() => expect(server.state.profile.voice).toBe('kokoro:af_bella'));
  });

  test('your own voice is a tap away, and Continue goes to the last step', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: /^Use your own voice/ }));
    expect(router.push).toHaveBeenCalledWith('/voices');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(router.push).toHaveBeenCalledWith('/onboarding/done');
  });
});

describe('the last step', () => {
  test('offers a practice call or Today, nothing to skip, and setup is then done', async () => {
    await saveConfig({ url: TEST_URL, token: 'x' });
    await renderUI(<DoneStep />);
    expect(screen.queryByRole('button', { name: 'Set up later' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip this step' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Start a practice call' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/practice'));
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(await onboardingDone()).toBe(true);
  });

  test('Go to Today also finishes setup', async () => {
    await renderUI(<DoneStep />);
    await fireEvent.press(screen.getByRole('button', { name: 'Go to Today' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(await onboardingDone()).toBe(true);
  });
});
