// The practice call screen driven by a hand-controlled /ws/simulate socket: the
// test plays the server, so every ack, error, event and audio clip is explicit.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
// The screen's navigation object: tests read the beforeRemove listener from it.
const mockNavigation = {
  listeners: {} as Record<string, (e: unknown) => void>,
  addListener: jest.fn((name: string, fn: (e: unknown) => void) => {
    mockNavigation.listeners[name] = fn;
    return () => undefined;
  }),
  dispatch: jest.fn(),
};
jest.mock('expo-router', () => {
  const { Fragment, createElement } = require('react');
  return {
    ...jest.requireActual('expo-router'),
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useNavigation: () => mockNavigation,
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: (p: object) => unknown } }) =>
        createElement(Fragment, null, options?.headerRight ? options.headerRight({}) : null),
    },
  };
});

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';

import Practice from '../../app/practice';
import { MockEventsSocket } from '../../lib/mock/socket';
import { getTransport, setTransport, type SocketLike } from '../../lib/transport';
import type { TranscriptLine } from '../../lib/types';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

class FakeSimulateSocket implements SocketLike {
  readyState = 1;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

let sock: FakeSimulateSocket;
let opened: string[] = [];
const CALL = 'practice-test';
const base = { call_id: CALL, who: '+919800000000' };
let seq = 0;

/** The server sends something (JSON event or a WAV clip). */
async function server(ev: Record<string, unknown> | ArrayBuffer) {
  await act(async () => sock.onmessage?.({ data: ev instanceof ArrayBuffer ? ev : JSON.stringify(ev) }));
}

const lineOf = (speaker: TranscriptLine['speaker'], text: string, lang: string, translation = ''): TranscriptLine => ({
  id: `l${seq++}`,
  speaker,
  text,
  lang,
  translation,
  translation_lang: translation ? 'en' : '',
  english: translation || text,
  at: Date.now() / 1000,
  kind: 'speech',
});

beforeEach(async () => {
  opened = [];
  await useMockServer();
  const real = getTransport();
  setTransport({
    ...real,
    openSocket: (url) => {
      opened.push(url);
      if (url.includes('/ws/simulate')) {
        sock = new FakeSimulateSocket(url);
        return sock;
      }
      // The practice call must not need the events socket: refuse it.
      return MockEventsSocket.refused();
    },
  });
});
afterEach(resetApi);

async function startCall(language?: string) {
  await renderScreen(<Practice />);
  expect(await screen.findByText('Try Ava, no phone line needed')).toBeTruthy();
  if (language) await fireEvent.press(screen.getByRole('button', { name: language }));
  await fireEvent.press(screen.getByRole('button', { name: 'Start practice call' }));
  await waitFor(() => expect(opened.some((u) => u.includes('/ws/simulate'))).toBe(true));
  await server({ event: 'started', call_id: CALL });
  await server({ event: 'assistant_status', ...base, state: 'speaking' });
  await server({ event: 'transcript', ...base, line: lineOf('assistant', "Hello, you've reached Arjun's assistant, Ava.", 'en') });
  await server({ event: 'assistant_status', ...base, state: 'listening' });
}

test('intro offers the caller languages; the choice goes to the server as a hint', async () => {
  await renderScreen(<Practice />);
  for (const name of ['Auto', 'English', 'Hindi', 'Telugu', 'Tamil']) expect(await screen.findByRole('button', { name })).toBeTruthy();
  expect(screen.getByText('Ava works out the language from what you say.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Telugu' }));
  expect(screen.getByText('Ava expects Telugu and answers in it.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Start practice call' }));
  await waitFor(() => expect(opened.find((u) => u.includes('/ws/simulate'))).toMatch(/[?&]lang=te(&|$)/));
});

test('a typed caller line shows at once, waits for the ack, and the transcript takes over', async () => {
  await startCall('Telugu');
  expect(screen.getByTestId('practice-status-title')).toHaveTextContent('Ava is listening');
  await fireEvent.changeText(screen.getByLabelText('Say something as the caller'), 'నమస్తే, మీ ఆర్డర్ తీసుకొచ్చాను');
  await fireEvent.press(screen.getByTestId('composer-send'));
  expect(sock.sent.at(-1)).toEqual({ text: 'నమస్తే, మీ ఆర్డర్ తీసుకొచ్చాను', lang: 'te' });
  expect(screen.getByTestId('outbox-sending')).toHaveTextContent(/Sending…/);

  // Nothing else goes while the first is unconfirmed.
  await fireEvent.changeText(screen.getByLabelText('Say something as the caller'), 'Hello?');
  await fireEvent.press(screen.getByTestId('composer-send'));
  expect(sock.sent).toHaveLength(1);

  await server({ event: 'ack', kind: 'text' });
  expect(screen.getByTestId('outbox-sent')).toBeTruthy();
  await server({ event: 'transcript', ...base, line: lineOf('caller', 'నమస్తే, మీ ఆర్డర్ తీసుకొచ్చాను', 'te') });
  expect(screen.queryByTestId(/^outbox-/)).toBeNull();
  await server({ event: 'call_language', ...base, language: 'te', confidence: 0.93 });
  expect(screen.getByText('Caller speaks Telugu · 93% sure')).toBeTruthy();
  await server({ event: 'assistant_status', ...base, state: 'translating' });
  expect(screen.getByTestId('working')).toHaveTextContent('Ava is translating…');
  await server({ event: 'transcript_update', ...base, line_id: `l${seq - 1}`, translation: "Hello, I've brought your order", translation_lang: 'en' });
  expect(screen.getByText("Hello, I've brought your order")).toBeTruthy();
  await server({ event: 'assistant_status', ...base, state: 'listening' });
  expect(screen.queryByTestId('working')).toBeNull();
});

test('an error from the server is shown on the message, which can be retried', async () => {
  await startCall();
  await fireEvent.press(screen.getByRole('button', { name: 'Hi, I have a Swiggy order for you. Where should I come?' }));
  expect(sock.sent.at(-1)).toEqual({ text: 'Hi, I have a Swiggy order for you. Where should I come?' });
  await server({ event: 'error', detail: 'The assistant is still answering the last message.' });
  expect(screen.getByText('Not sent: The assistant is still answering the last message.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(sock.sent).toHaveLength(2);
  await server({ event: 'ack', kind: 'text' });
  expect(screen.getByTestId('outbox-sent')).toBeTruthy();
});

test('a turn error is shown, and the call carries on', async () => {
  await startCall();
  await server({ event: 'turn_error', ...base, detail: 'The reply took too long.' });
  expect(screen.getByText('Ava had trouble with that turn')).toBeTruthy();
  expect(screen.getByText('The reply took too long.')).toBeTruthy();
  expect(screen.getByLabelText('Say something as the caller')).toBeTruthy();
});

test("the assistant's sentences play one after another, never together", async () => {
  await startCall();
  const create = createAudioPlayer as jest.Mock;
  create.mockClear();
  await server(new Uint8Array([1, 2, 3]).buffer);
  await server(new Uint8Array([4, 5, 6]).buffer);
  const [first, second] = create.mock.results.map((r) => r.value);
  expect(first.play).toHaveBeenCalledTimes(1);
  expect(second.play).not.toHaveBeenCalled(); // loaded, waiting its turn
  expect(screen.getByTestId('practice-status-title')).toHaveTextContent('Ava is speaking');
  const finished = first.addListener.mock.calls[0][1] as (s: { didJustFinish: boolean }) => void;
  await act(async () => finished({ didJustFinish: true }));
  expect(second.play).toHaveBeenCalledTimes(1);
  // Muting stops it and later clips are skipped.
  await fireEvent.press(screen.getByRole('button', { name: 'Mute Ava' }));
  expect(second.remove).toHaveBeenCalled();
  create.mockClear();
  await server(new Uint8Array([7]).buffer);
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Unmute Ava' })).toBeTruthy();
});

test('as the owner, a reply goes as "say" in your language', async () => {
  await startCall('Telugu');
  await fireEvent.press(screen.getByRole('tab', { name: 'As you, the owner' }));
  expect(screen.getByText("Reply in English, I'll say it in Telugu.")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Reply in English'), 'Please leave it at the gate');
  await fireEvent.press(screen.getByTestId('composer-send'));
  expect(sock.sent.at(-1)).toEqual({ action: 'say', call_id: CALL, text: 'Please leave it at the gate', lang: 'en' });
  await server({ event: 'ack', kind: 'say' });
  expect(screen.getByText('Sent · Ava is saying it')).toBeTruthy();
});

test('a hold question can be answered right in the practice call', async () => {
  await startCall();
  await server({ event: 'hold_question', ...base, hold_id: 'h1', question: 'Can he bring it up to the flat?' });
  expect(screen.getByTestId('practice-status-title')).toHaveTextContent('On hold, waiting for you');
  await fireEvent.press(screen.getByRole('button', { name: 'Yes, that works' }));
  expect(sock.sent.at(-1)).toEqual({ action: 'answer', call_id: CALL, text: 'Yes, that works', hold_id: 'h1' });
  await server({ event: 'ack', kind: 'answer' });
  expect(await screen.findByTestId('hold-sent')).toBeTruthy();
  await server({ event: 'hold_resolved', ...base, hold_id: 'h1', answered: true });
  expect(screen.queryByText('Can he bring it up to the flat?')).toBeNull();
});

test('hanging up ends the call with a summary and Call again', async () => {
  await startCall();
  await fireEvent.press(screen.getByRole('button', { name: 'Hang up' }));
  expect(sock.sent.at(-1)).toEqual({ hangup: true });
  await server({ event: 'call_ended', ...base, call: { id: CALL, number: '+919800000000', status: 'ended', started_at: 1, ended_at: 2, transcript: [], holds: [] } });
  await act(async () => sock.close(1000, ''));
  const card = within(screen.getByTestId('practice-ended'));
  expect(card.getByText('Practice call ended')).toBeTruthy();
  expect(card.getByText(/1 line/)).toBeTruthy();
  expect(screen.queryByTestId('composer')).toBeNull();
  await fireEvent.press(card.getByRole('button', { name: 'Done' }));
  expect(router.back).toHaveBeenCalled();
});

test('hanging up shows the end at once: nothing more can be sent while the server wraps up', async () => {
  await startCall();
  await fireEvent.press(screen.getByRole('button', { name: 'Hi, I have a Swiggy order for you. Where should I come?' }));
  expect(screen.getByTestId('outbox-sending')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Hang up' }));
  expect(sock.sent.at(-1)).toEqual({ hangup: true });
  // The server is still writing the summary: the socket is open, but the call is over here.
  expect(screen.getByTestId('practice-status-title')).toHaveTextContent('Ending the call…');
  expect(screen.getAllByText('Ending the call…')).toHaveLength(2); // the status and in place of the composer
  expect(screen.queryByLabelText('Say something as the caller')).toBeNull();
  expect(screen.getByText('Not sent: The call has ended.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Hang up' })).toBeNull();
  await act(async () => sock.close(1000, ''));
  expect(screen.getByTestId('practice-ended')).toBeTruthy();
});

test('hanging up while it connects goes back to the start, and the call is not left running', async () => {
  await renderScreen(<Practice />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Start practice call' }));
  await waitFor(() => expect(opened.some((u) => u.includes('/ws/simulate'))).toBe(true));
  await fireEvent.press(screen.getByRole('button', { name: 'Hang up' }));
  expect(sock.readyState).toBe(3);
  expect(await screen.findByRole('button', { name: 'Start practice call' })).toBeTruthy();
  expect(screen.queryByText("Couldn't start the practice call")).toBeNull();
});

test('leaving while it connects closes the socket, even one that opens only later', async () => {
  const view = await renderScreen(<Practice />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Start practice call' }));
  await waitFor(() => expect(opened.some((u) => u.includes('/ws/simulate'))).toBe(true));
  // Still connecting, as on a slow server: Android ignores close() until it opens.
  sock.readyState = 0;
  const close = jest.spyOn(sock, 'close');
  await view.unmount();
  expect(close).not.toHaveBeenCalled();
  sock.readyState = 1;
  sock.onopen?.({});
  expect(close).toHaveBeenCalled();
});

test('back while the call is on asks before hanging up', async () => {
  await startCall();
  const preventDefault = jest.fn();
  const action = { type: 'GO_BACK' };
  await act(async () => mockNavigation.listeners.beforeRemove({ preventDefault, data: { action } }));
  expect(preventDefault).toHaveBeenCalled();
  expect(await screen.findByText('End the practice call?')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'End call' }));
  await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith(action));
});

test('translation follows the profile until changed here: off means no "Translating…"', async () => {
  const mock = await useMockServer();
  mock.state.profile = { ...mock.state.profile, translate_live: false, owner_language: 'en' };
  const real = getTransport();
  setTransport({ ...real, openSocket: (url) => (url.includes('/ws/simulate') ? (sock = new FakeSimulateSocket(url)) : MockEventsSocket.refused()) });
  await renderScreen(<Practice />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Start practice call' }));
  await waitFor(() => expect(sock).toBeTruthy());
  await server({ event: 'started', call_id: CALL });
  await server({ event: 'call_language', ...base, language: 'te', confidence: 0.9 });
  await server({ event: 'transcript', ...base, line: lineOf('caller', 'నమస్తే', 'te') });
  expect(screen.queryByText('Translating…')).toBeNull();
  expect(screen.getByRole('switch', { name: /translat/i })).not.toBeChecked();
});

test('a call cut off by the network says so', async () => {
  await startCall();
  await act(async () => sock.close(1006, ''));
  expect(screen.getByText('The practice call was cut off. Check the connection to your server.')).toBeTruthy();
  expect(screen.getByTestId('practice-ended')).toBeTruthy();
});

test('a call the server will not take explains why and stays on the intro', async () => {
  await renderScreen(<Practice />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Start practice call' }));
  await waitFor(() => expect(opened.some((u) => u.includes('/ws/simulate'))).toBe(true));
  await server({ event: 'rejected', reason: 'that number is blocked' });
  expect(await screen.findByText("Couldn't start the practice call")).toBeTruthy();
  expect(screen.getByText("The assistant wouldn't take this call: that number is blocked")).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Start practice call' })).toBeTruthy();
});
