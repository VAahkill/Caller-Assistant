// Voices against the in-memory v2 server: groups by caller language, instant
// demos (preloaded with the token), one player with tap-again-to-stop, picking
// a voice per language, record -> review -> save, getting ready, delete with Undo.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { clearAllPreloadedSources, preload, requestRecordingPermissionsAsync } from 'expo-audio';
import { Linking } from 'react-native';

import Voices, { DELETE_AFTER_MS, POLL_MS } from '../../app/voices';
import { getTransport, setTransport } from '../../lib/transport';
import { DEMO_TIMEOUT_MS } from '../../lib/voices';
import { MOCK_TOKEN, type MockServer } from '../../lib/mock/server';
import { player, recorder, resetAudioMock, setPlayerStatus, setRecorderState } from '../../test/expoAudioMock';
import { TEST_URL, resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
beforeEach(async () => {
  server = await useMockServer();
  jest.clearAllMocks();
  resetAudioMock();
});
afterEach(async () => {
  jest.useRealTimers();
  await resetApi();
});

const auth = { Authorization: `Bearer ${MOCK_TOKEN}` };
const sampleUri = (id: string, lang: string) => `${TEST_URL}/voices/${encodeURIComponent(id)}/sample.wav?lang=${lang}&v=3f2a1c`;
const requests = (method: string, prefix: string) => server.log.filter((r) => r.method === method && r.path.startsWith(prefix));
const MY = 'clone:my-voice-3f2a1c';
const DAD = 'clone:dad-91b2e0';

async function open() {
  const view = await renderScreen(<Voices />);
  await screen.findByTestId(`my-voice-${MY}`);
  await screen.findByTestId('voices-te');
  return view;
}

describe('the list', () => {
  test('my voices first, then one group per caller language in their order', async () => {
    await open();
    expect(screen.getAllByTestId(/^voices-[a-z]{2}$/).map((n) => n.props.testID)).toEqual(['voices-te', 'voices-en', 'voices-hi', 'voices-ta']);
    // My voice speaks English and Hindi, so it is offered there, first.
    const en = within(screen.getByTestId('voices-en'));
    expect(en.getAllByRole('radio')[0].props.accessibilityLabel).toBe('My voice, your voice, for English');
    expect(within(screen.getByTestId('voices-te')).queryByText('My voice')).toBeNull();
    // The picks from the profile are ticked.
    expect(screen.getByRole('radio', { name: 'Padmavathi, female, for Telugu' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('radio', { name: 'Heart, female, for English' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(within(screen.getByTestId('voices-ta')).getByText('Not picked yet: your server uses its default Tamil voice.')).toBeTruthy();
    // Dad is still getting ready: no demo yet, and it is not offered for a language.
    const dad = within(screen.getByTestId(`my-voice-${DAD}`));
    expect(dad.getByText('Getting ready')).toBeTruthy();
    expect(dad.getByRole('button', { name: 'Getting ready…' })).toBeDisabled();
    expect(screen.queryByTestId(`voice-${DAD}-en`)).toBeNull();
  });

  test('a recorded voice in use says which callers it answers', async () => {
    server.state.profile = { ...server.state.profile, voices_by_language: { ...server.state.profile.voices_by_language, hi: MY } };
    await open();
    expect(within(screen.getByTestId(`my-voice-${MY}`)).getByText('Answers Hindi callers')).toBeTruthy();
  });

  test('a voice that failed says why and offers to record again', async () => {
    server.readyAfterPolls = null;
    const dad = server.state.voices.find((v) => v.id === DAD)!;
    dad.status = 'failed';
    dad.detail = 'The recording was mostly silence.';
    await open();
    const card = within(screen.getByTestId(`my-voice-${DAD}`));
    expect(card.getByText("Didn't work")).toBeTruthy();
    expect(card.getByText('The recording was mostly silence.')).toBeTruthy();
    await fireEvent.press(card.getByRole('button', { name: 'Record again' }));
    expect(await screen.findByRole('header', { name: 'Record your voice' })).toBeTruthy();
  });
});

describe('demos', () => {
  test('every demo is fetched once, with the token, when the screen opens, and released on leaving', async () => {
    const view = await open();
    // One at a time, down to the last (Tamil).
    await waitFor(() => expect((preload as jest.Mock).mock.calls.map(([s]) => s.uri)).toContain(sampleUri('mms:ta', 'ta')));
    const uris = (preload as jest.Mock).mock.calls.map(([s]) => s.uri as string);
    expect(new Set(uris).size).toBe(uris.length);
    expect((preload as jest.Mock).mock.calls).toContainEqual([{ uri: sampleUri('kokoro:af_heart', 'en'), headers: auth }]);
    expect(uris).toContain(sampleUri('piper:te_IN-padmavathi-medium', 'te'));
    expect(uris).toContain(sampleUri(MY, 'hi'));
    expect(uris).not.toContain(sampleUri(DAD, 'en'));
    // Picking a voice re-renders everything; nothing is fetched again.
    const before = uris.length;
    await fireEvent.press(screen.getByRole('radio', { name: 'Omega, male, for Hindi' }));
    await waitFor(() => expect(requests('PATCH', '/profile')).toHaveLength(1));
    expect((preload as jest.Mock).mock.calls).toHaveLength(before);
    expect(clearAllPreloadedSources).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(clearAllPreloadedSources).toHaveBeenCalledTimes(1));
  });

  test('tap plays at once, the row shows it playing, and a second tap stops', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_heart-en'));
    expect(player.replace).toHaveBeenCalledWith({ uri: sampleUri('kokoro:af_heart', 'en'), headers: auth });
    expect(player.play).toHaveBeenCalledTimes(1);
    const row = within(screen.getByTestId('voice-kokoro:af_heart-en'));
    expect(row.getByText('Loading…')).toBeTruthy();
    await act(async () => setPlayerStatus({ playing: true, currentTime: 1, duration: 4 }));
    expect(row.getByText('Playing…')).toBeTruthy();
    expect(row.getByRole('progressbar').props.accessibilityValue).toMatchObject({ now: 25 });
    await fireEvent.press(row.getByRole('button', { name: 'Stop Heart' }));
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(row.getByRole('button', { name: 'Play Heart' })).toBeTruthy();
  });

  test('another demo switches the one player; the end of a clip resets the row', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_heart-en'));
    await act(async () => setPlayerStatus({ playing: true }));
    await fireEvent.press(screen.getByTestId('play-piper:te_IN-venkatesh-medium-te'));
    expect(player.replace).toHaveBeenLastCalledWith({ uri: sampleUri('piper:te_IN-venkatesh-medium', 'te'), headers: auth });
    expect(within(screen.getByTestId('voice-kokoro:af_heart-en')).getByRole('button', { name: 'Play Heart' })).toBeTruthy();
    await act(async () => setPlayerStatus({ playing: false }));
    await act(async () => setPlayerStatus({ playing: true }));
    const row = within(screen.getByTestId('voice-piper:te_IN-venkatesh-medium-te'));
    expect(row.getByText('Playing…')).toBeTruthy();
    await act(async () => setPlayerStatus({ playing: false, didJustFinish: true }));
    expect(row.getByRole('button', { name: 'Play Venkatesh' })).toBeTruthy();
  });

  test('demos are fetched one at a time, top to bottom, and wait while a tapped one loads', async () => {
    const heart = server.state.voices.find((v) => v.id === 'kokoro:af_heart')!;
    server.state.voices.push({ ...heart, id: 'kokoro:ef_dora', name: 'Dora', languages: ['es'], sample_url: '/voices/kokoro%3Aef_dora/sample.wav?lang=es&v=3f2a1c' });
    const pending: (() => void)[] = [];
    (preload as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
    await open();
    const fetched = () => (preload as jest.Mock).mock.calls.map(([s]) => s.uri as string);
    await waitFor(() => expect(fetched()).toHaveLength(1));
    // My voices are at the top of the screen, so their demo comes first.
    expect(fetched()[0]).toBe(sampleUri(MY, 'en'));
    await act(async () => pending.shift()?.());
    await waitFor(() => expect(fetched()).toHaveLength(2));
    // A tap: nothing new starts until it plays.
    await fireEvent.press(screen.getByTestId('play-kokoro:af_bella-en'));
    await act(async () => pending.shift()?.());
    expect(fetched()).toHaveLength(2);
    await act(async () => setPlayerStatus({ playing: true }));
    await waitFor(() => expect(fetched()).toHaveLength(3));
    for (let i = 0; i < 40 && pending.length; i++) await act(async () => pending.shift()?.());
    expect(fetched()).toContain(sampleUri('mms:ta', 'ta'));
    // Languages under "More languages" wait until they are shown.
    expect(fetched().some((u) => u.includes('ef_dora'))).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'More languages (1)' }));
    await waitFor(() => expect(fetched()).toContain(sampleUri('kokoro:ef_dora', 'es')));
  });

  test("a demo the player can't play is asked for again, and the server's reason is said", async () => {
    server.audioReplies.set('kokoro:af_bella', { status: 409, body: { detail: 'This voice is still being prepared.' } });
    await open();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_bella-en'));
    await act(async () => setPlayerStatus({ error: 'Response code: 409' }));
    expect(await screen.findByText('This voice is still being prepared.')).toBeTruthy();
    expect(within(screen.getByTestId('voice-kokoro:af_bella-en')).getByText("Couldn't play. Tap to try again.")).toBeTruthy();
    // The same address, with the same token.
    const asked = requests('GET', '/voices/kokoro%3Aaf_bella/sample.wav');
    expect(asked).toHaveLength(1);
    expect(asked[0].query.get('lang')).toBe('en');
  });

  test("a demo that doesn't start in time is checked; ready on the server, it plays again by itself", async () => {
    jest.useFakeTimers();
    await open();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_bella-en'));
    const row = within(screen.getByTestId('voice-kokoro:af_bella-en'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DEMO_TIMEOUT_MS);
    });
    // Still loading while it checks, then the same demo is played once more.
    expect(row.getByText('Loading…')).toBeTruthy();
    await waitFor(() => expect(player.replace).toHaveBeenCalledTimes(2));
    expect(player.replace).toHaveBeenLastCalledWith({ uri: sampleUri('kokoro:af_bella', 'en'), headers: auth });
    await act(async () => setPlayerStatus({ playing: true }));
    expect(within(screen.getByTestId('voice-kokoro:af_bella-en')).getByText('Playing…')).toBeTruthy();
  });

  test('ready on the server but still not playing: the phone could not play it', async () => {
    jest.useFakeTimers();
    await open();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_bella-en'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DEMO_TIMEOUT_MS);
    });
    await waitFor(() => expect(player.replace).toHaveBeenCalledTimes(2));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DEMO_TIMEOUT_MS);
    });
    expect(await screen.findByText("Your server sent the demo, but this phone couldn't play it. Try again in a moment.")).toBeTruthy();
    expect(player.replace).toHaveBeenCalledTimes(2);
  });

  test("a server that can't be reached is named, with the Wi-Fi to check", async () => {
    await open();
    const transport = getTransport();
    setTransport({ ...transport, fetch: async () => Promise.reject(new TypeError('Network request failed')) });
    await fireEvent.press(screen.getByTestId('play-kokoro:af_bella-en'));
    await act(async () => setPlayerStatus({ error: 'Failed to connect' }));
    expect(
      await screen.findByText(`Couldn't reach your server at ${TEST_URL}. Check that the phone and the computer are on the same Wi-Fi and that the server is running.`),
    ).toBeTruthy();
  });

  test('moving on to another demo while one is checked cancels the check; nothing is said about it', async () => {
    const transport = getTransport();
    let asked = 0;
    let cancelled = 0;
    setTransport({
      ...transport,
      fetch: (url, init) =>
        url.includes('/sample.wav')
          ? new Promise((_resolve, reject) => {
              asked += 1;
              init?.signal?.addEventListener('abort', () => {
                cancelled += 1;
                reject(new Error('Aborted'));
              });
            })
          : transport.fetch(url, init),
    });
    await open();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_bella-en'));
    await act(async () => setPlayerStatus({ error: 'Response code: 503' }));
    await waitFor(() => expect(asked).toBe(1));
    const row = within(screen.getByTestId('voice-kokoro:af_bella-en'));
    expect(row.getByText('Loading…')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_heart-en'));
    expect(cancelled).toBe(1);
    expect(row.getByRole('button', { name: 'Play Bella' })).toBeTruthy();
    expect(player.replace).toHaveBeenLastCalledWith({ uri: sampleUri('kokoro:af_heart', 'en'), headers: auth });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText(/^Couldn't reach your server/)).toBeNull();
    expect(row.queryByText("Couldn't play. Tap to try again.")).toBeNull();
  });

  test('a first-version server: a notice at the top, demos made on demand, and a failing one explained as that', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    // As the first version sends them: no version or phone line in health, and voices
    // without sample_url or status, so demos come from /assistant/speak.
    server.state.health = { ok: true, dialer: 'asterisk', active_calls: 0 } as unknown as typeof server.state.health;
    server.state.voices = server.state.voices.map(({ sample_url: _u, status: _s, ...v }) => v) as unknown as typeof server.state.voices;
    await open();
    const banner = within(await screen.findByTestId('server-outdated'));
    expect(banner.getByText('Your server needs updating')).toBeTruthy();
    expect(preload).not.toHaveBeenCalled(); // made on demand there: preloading them all swamped it
    (player.replace as jest.Mock).mockClear();
    await fireEvent.press(screen.getByTestId('play-kokoro:af_bella-en'));
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect((player.replace as jest.Mock).mock.calls[0][0].uri).toMatch(/\/assistant\/speak\?voice=kokoro%3Aaf_bella&lang=en&text=/);
    // The player fails; the check finds the server answering, so it plays again once...
    await act(async () => setPlayerStatus({ error: 'Source error' }));
    await waitFor(() => expect(player.replace).toHaveBeenCalledTimes(2));
    await act(async () => setPlayerStatus({ error: null }));
    // ...and when that fails too, the old server is named as the reason.
    await act(async () => setPlayerStatus({ error: 'Source error again' }));
    expect(await screen.findByText(/^Your server is still the first version, which can't play voice demos properly\./)).toBeTruthy();
    expect(player.replace).toHaveBeenCalledTimes(2);
    await fireEvent.press(banner.getByRole('button', { name: 'Open the setup guide' }));
    expect(openURL).toHaveBeenCalledWith(expect.stringMatching(/TRY_IT\.md#updating-from-the-first-version$/));
    openURL.mockRestore();
  });

  test('Play original plays the recording; the assistant-voice demo uses a caller language it speaks', async () => {
    await open();
    const card = within(screen.getByTestId(`my-voice-${MY}`));
    await fireEvent.press(card.getByRole('button', { name: 'Play original' }));
    expect(player.replace).toHaveBeenLastCalledWith({ uri: `${TEST_URL}/voices/clone%3Amy-voice-3f2a1c/recording`, headers: auth });
    expect(card.getByRole('button', { name: 'Stop' })).toBeTruthy();
    await fireEvent.press(card.getByRole('button', { name: 'Play in assistant voice' }));
    // Telugu comes first for callers, but XTTS can't speak it; English is next.
    expect(player.replace).toHaveBeenLastCalledWith({ uri: sampleUri(MY, 'en'), headers: auth });
  });
});

describe('choosing', () => {
  test('a voice per language is saved in voices_by_language', async () => {
    await open();
    await fireEvent.press(screen.getByRole('radio', { name: 'Omega, male, for Hindi' }));
    await waitFor(() => expect(requests('PATCH', '/profile')).toHaveLength(1));
    expect(requests('PATCH', '/profile')[0].body).toEqual({
      voices_by_language: { te: 'piper:te_IN-padmavathi-medium', hi: 'kokoro:hm_omega' },
    });
    expect(await screen.findByText('Omega will answer Hindi callers.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Omega, male, for Hindi' }).props.accessibilityState).toMatchObject({ checked: true });
  });

  test('your own voice for English is also the main voice', async () => {
    await open();
    await fireEvent.press(screen.getByRole('radio', { name: 'My voice, your voice, for English' }));
    await waitFor(() => expect(requests('PATCH', '/profile')).toHaveLength(1));
    expect(requests('PATCH', '/profile')[0].body).toMatchObject({ voice: MY, voices_by_language: { en: MY } });
  });
});

describe('recording', () => {
  async function recordFor(seconds: number) {
    await fireEvent.press(screen.getByRole('button', { name: 'Record another voice' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Start recording' }));
    expect(recorder.record).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 6; i++) {
      await act(async () => setRecorderState({ isRecording: true, durationMillis: (seconds * 1000 * i) / 6, metering: -18 - i }));
    }
    expect(screen.getByTestId('level-meter', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Stop recording' }));
    await act(async () => setRecorderState({ isRecording: false, durationMillis: 0 }));
  }

  test('record, review, then save with progress and a clear result', async () => {
    await open();
    await recordFor(16);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('header', { name: 'Check your recording' })).toBeTruthy();
    expect(screen.getByText('Sounds clear')).toBeTruthy();
    // "My voice" is taken, so it suggests another name.
    expect(screen.getByLabelText('Name this voice').props.value).toBe('My voice 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Save voice' }));
    expect(await screen.findByRole('header', { name: 'Voice saved' })).toBeTruthy();
    expect(screen.getByText('Saved "My voice 2"')).toBeTruthy();
    expect(requests('POST', '/voices')[0].body).toEqual({ label: 'My voice 2' });
    const added = server.state.voices.find((v) => v.name === 'My voice 2')!;
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(within(await screen.findByTestId(`my-voice-${added.id}`)).getByText('Getting ready')).toBeTruthy();
  });

  test('a recording under eight seconds cannot be saved', async () => {
    await open();
    await recordFor(5);
    expect(await screen.findByText('That was 5 seconds')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save voice' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Record again' }));
    expect(screen.getByRole('header', { name: 'Record your voice' })).toBeTruthy();
  });

  test('a failed upload stays on the review step and says why', async () => {
    await open();
    await recordFor(16);
    await fireEvent.changeText(await screen.findByLabelText('Name this voice'), '   ');
    expect(screen.getByRole('button', { name: 'Save voice' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Name this voice'), 'Me');
    const transport = getTransport();
    setTransport({ ...transport, upload: async () => ({ status: 507, body: '{"detail":"The server disk is full."}' }) });
    await fireEvent.press(screen.getByRole('button', { name: 'Save voice' }));
    expect(await screen.findByText('Not saved')).toBeTruthy();
    expect(screen.getByText(/The server disk is full\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Voice saved' })).toBeNull();
  });

  test('microphone turned off explains and opens Settings', async () => {
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'denied' });
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Record another voice' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Start recording' }));
    expect(await screen.findByText('Microphone access is off for OpenCall. Allow it in Settings to record your voice.')).toBeTruthy();
    expect(recorder.record).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(settings).toHaveBeenCalledTimes(1);
  });
});

describe('getting ready', () => {
  test('voice_status from the server shows the voice ready at once', async () => {
    server.readyAfterPolls = null;
    await open();
    server.state.voices.find((v) => v.id === DAD)!.status = 'ready';
    await act(async () => {
      server.liveSockets.forEach((sk) => sk.push({ event: 'voice_status', voice_id: DAD, status: 'ready', detail: '' }, 0));
    });
    expect(await screen.findByText('"Dad" is ready. Play it, then pick it for a language below.')).toBeTruthy();
    expect(within(screen.getByTestId(`my-voice-${DAD}`)).getByText('Ready')).toBeTruthy();
    expect(screen.getByTestId(`voice-${DAD}-en`)).toBeTruthy();
  });

  test('without the event, the list is checked again while a voice is getting ready', async () => {
    jest.useFakeTimers();
    await open();
    expect(requests('GET', '/voices')).toHaveLength(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    await waitFor(() => expect(requests('GET', '/voices').length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText('"Dad" is ready. Play it, then pick it for a language below.')).toBeTruthy();
    // The mock also sends voice_status, which reads the list once more; then
    // nothing is getting ready, so the checks stop.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    const count = requests('GET', '/voices').length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(requests('GET', '/voices')).toHaveLength(count);
  });
});

describe('rename and delete', () => {
  test('rename saves the new name', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Rename My voice' }));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Me');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests('PATCH', '/voices/')).toHaveLength(1));
    expect(requests('PATCH', '/voices/')[0].body).toEqual({ label: 'Me' });
    expect(await screen.findByText('Renamed to "Me".')).toBeTruthy();
    expect(within(screen.getByTestId(`my-voice-${MY}`)).getByText('Me')).toBeTruthy();
  });

  test('delete hides the voice at once; Undo brings it back and nothing is deleted', async () => {
    jest.useFakeTimers();
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete My voice' }));
    expect(screen.queryByTestId(`my-voice-${MY}`)).toBeNull();
    expect(screen.queryByTestId(`voice-${MY}-en`)).toBeNull();
    expect(screen.getByText('Deleted "My voice".')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId(`my-voice-${MY}`)).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DELETE_AFTER_MS + 1000);
    });
    expect(requests('DELETE', '/voices/')).toHaveLength(0);
  });

  test('without Undo the voice is deleted on the server when the message goes', async () => {
    jest.useFakeTimers();
    server.state.profile = { ...server.state.profile, voices_by_language: { ...server.state.profile.voices_by_language, hi: MY } };
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete My voice' }));
    expect(requests('DELETE', '/voices/')).toHaveLength(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DELETE_AFTER_MS);
    });
    await waitFor(() => expect(requests('DELETE', '/voices/')).toHaveLength(1));
    expect(decodeURIComponent(requests('DELETE', '/voices/')[0].path)).toBe(`/voices/${MY}`);
    expect(server.state.voices.some((v) => v.id === MY)).toBe(false);
    // The server took it off Hindi too; the profile is read again.
    await waitFor(() => expect(requests('GET', '/profile').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId(`my-voice-${MY}`)).toBeNull();
  });

  test('leaving the screen during Undo still deletes the voice', async () => {
    const view = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete My voice' }));
    view.unmount();
    await waitFor(() => expect(requests('DELETE', '/voices/')).toHaveLength(1));
  });
});
