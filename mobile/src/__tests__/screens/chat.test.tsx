// "Ask your assistant" against the in-memory v2 server: messages show at once,
// a thinking indicator while waiting, Retry on failure, voice messages, and
// chips for what the assistant changed.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => {
  const { Fragment, createElement } = require('react');
  return {
    ...jest.requireActual('expo-router'),
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    // Renders the header's right-hand buttons so they can be pressed.
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: (p: object) => unknown } }) =>
        createElement(Fragment, null, options?.headerRight ? options.headerRight({}) : null),
    },
  };
});

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import Chat from '../../app/chat';
import type { MockServer } from '../../lib/mock/server';
import { getTransport, setTransport } from '../../lib/transport';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
const requests = (path: string) => server.log.filter((r) => r.method === 'POST' && r.path === path);
const push = router.push as jest.Mock;

beforeEach(async () => {
  push.mockClear();
  server = await useMockServer();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await resetApi();
});

/** Holds /assistant requests until release() so the in-between state can be seen. */
function gateAssistant() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const base = getTransport();
  setTransport({ ...base, fetch: (url, init) => (url.includes('/assistant/') ? gate.then(() => base.fetch(url, init)) : base.fetch(url, init)) });
  return () => act(async () => release());
}

test('the welcome offers examples; picking one asks it straight away', async () => {
  await renderScreen(<Chat />);
  expect(await screen.findByText('What can Ava do for you?')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Who called while I was out?' }));
  expect(await screen.findByText(/^Today: /)).toBeTruthy();
  expect(requests('/assistant/chat')[0].body).toEqual({ text: 'Who called while I was out?', shared: '', history: [] });
  expect(screen.queryByTestId('chat-welcome')).toBeNull();
});

test('a message shows at once with a thinking indicator, and nothing else sends meanwhile', async () => {
  const release = gateAssistant();
  await renderScreen(<Chat />);
  await fireEvent.changeText(await screen.findByLabelText('Message Ava'), 'Who called today?');
  await fireEvent.press(screen.getByTestId('composer-send'));
  expect(screen.getByTestId('outbox-sending')).toHaveTextContent(/Who called today\?.*Sending…/);
  expect(screen.getByTestId('chat-thinking')).toHaveTextContent('Ava is thinking…');
  await fireEvent.changeText(screen.getByLabelText('Message Ava'), 'And yesterday?');
  await fireEvent.press(screen.getByTestId('composer-send'));
  await release();
  expect(await screen.findByText(/^Today: /)).toBeTruthy();
  expect(screen.queryByTestId('chat-thinking')).toBeNull();
  expect(requests('/assistant/chat')).toHaveLength(1);
});

test('the conversation so far goes with the next message', async () => {
  await renderScreen(<Chat />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Who called while I was out?' }));
  await screen.findByText(/^Today: /);
  await fireEvent.changeText(screen.getByLabelText('Message Ava'), 'Remind me tomorrow');
  await fireEvent.press(screen.getByTestId('composer-send'));
  await waitFor(() => expect(requests('/assistant/chat')).toHaveLength(2));
  const history = (requests('/assistant/chat')[1].body as { history: { role: string }[] }).history;
  expect(history.map((h) => h.role)).toEqual(['user', 'assistant']);
});

test('what the assistant changed shows as chips that open the right screen', async () => {
  await renderScreen(<Chat />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Call Paradise and book a table for 4 at 8' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Calling Paradise Biryani' }));
  expect(push).toHaveBeenCalledWith('/tasks');
  expect(server.state.tasks[0]).toMatchObject({ kind: 'book', target_name: 'Paradise Biryani', status: 'queued' });

  await fireEvent.changeText(screen.getByLabelText('Message Ava'), 'Tell couriers to leave parcels with the guard');
  await fireEvent.press(screen.getByTestId('composer-send'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Instruction: Tell couriers to leave parcels with the guard' }));
  expect(push).toHaveBeenCalledWith('/instructions');
  expect(server.state.profile.instructions.at(-1)).toMatchObject({ text: 'Tell couriers to leave parcels with the guard', applies_to: 'delivery' });
});

test('a message that fails stays with the reason, and Retry sends it', async () => {
  const base = getTransport();
  let fail = true;
  setTransport({ ...base, fetch: async (url, init) => (fail && url.includes('/assistant/chat') ? Promise.reject(new Error('Network request failed')) : base.fetch(url, init)) });
  await renderScreen(<Chat />);
  await fireEvent.changeText(await screen.findByLabelText('Message Ava'), 'Who called today?');
  await fireEvent.press(screen.getByTestId('composer-send'));
  expect(await screen.findByText('Not sent: Network request failed')).toBeTruthy();
  fail = false;
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/^Today: /)).toBeTruthy();
  expect(screen.queryByTestId('outbox-failed')).toBeNull();
});

test('a voice message shows its length, then what was heard and the reply', async () => {
  const release = gateAssistant();
  let now = 1_760_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await renderScreen(<Chat />);
  const mic = await screen.findByRole('button', { name: 'Hold to talk' });
  await act(async () => fireEvent(mic, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }));
  now += 4200;
  await fireEvent.press(await screen.findByRole('button', { name: 'Send recording' }));
  const pending = await screen.findByTestId('outbox-sending');
  expect(pending).toHaveTextContent(/Voice message · 0:04.*Sending your recording…/);
  expect(screen.getByTestId('chat-thinking')).toHaveTextContent('Ava is listening to your recording…');
  await release();
  expect(await screen.findByText('"Who called while I was in the meeting?"')).toBeTruthy();
  expect(screen.getByText(/^Today: /)).toBeTruthy();
  expect(requests('/assistant/voice')).toHaveLength(1);
});

test('New chat clears the conversation', async () => {
  await renderScreen(<Chat />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Who called while I was out?' }));
  await screen.findByText(/^Today: /);
  await fireEvent.press(screen.getByRole('button', { name: 'New chat' }));
  expect(screen.getByTestId('chat-welcome')).toBeTruthy();
  expect(screen.queryByText(/^Today: /)).toBeNull();
});
