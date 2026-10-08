// Today against the in-memory v2 server and its live events socket.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import Today from '../../app/(tabs)/index';
import { LIVE_CALL_ID } from '../../lib/mock/fixtures';
import type { MockServer } from '../../lib/mock/server';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
const requests = (method: string, path: string) => server.log.filter((r) => r.method === method && r.path === path);
const push = router.push as jest.Mock;

beforeEach(async () => {
  push.mockClear();
  server = await useMockServer();
});
afterEach(resetApi);

/** Sends an event from the server over the open events socket. */
async function serverSays(ev: Record<string, unknown>) {
  await waitFor(() => expect(server.liveSockets.size).toBe(1));
  await act(async () => {
    for (const s of server.liveSockets) s.push(ev, 0);
    await new Promise((r) => setTimeout(r, 5));
  });
}

test('the live call shows what the assistant is doing and the last thing said, in English', async () => {
  await renderScreen(<Today />);
  const card = within(await screen.findByTestId(`live-${LIVE_CALL_ID}`));
  expect(card.getByText('On hold, waiting for you')).toBeTruthy();
  expect(card.getByText('Should I leave it with security, or bring it up?')).toBeTruthy();
  expect(card.getByText('Telugu')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /^Live call with \+91 97001 12233/ }));
  expect(push).toHaveBeenCalledWith(`/call/${LIVE_CALL_ID}`);
});

test('a quick answer to the caller on hold goes to the server, with a toast', async () => {
  await renderScreen(<Today />);
  const needs = within(await screen.findByTestId('needs-you'));
  await fireEvent.press(needs.getByRole('button', { name: "I'll call them back" }));
  await waitFor(() => expect(requests('POST', `/calls/${LIVE_CALL_ID}/answer`)).toHaveLength(1));
  expect(requests('POST', `/calls/${LIVE_CALL_ID}/answer`)[0].body).toEqual({ text: "I'll call them back", hold_id: 'hold-gate' });
  expect(await screen.findByText('Sent. Ava is telling +91 97001 12233.')).toBeTruthy();
});

test('a security alert says what was asked; dismiss offers Undo', async () => {
  await renderScreen(<Today />);
  await screen.findByTestId('needs-you');
  await serverSays({
    event: 'sensitive_request',
    call_id: LIVE_CALL_ID,
    who: '+919700112233',
    kind: 'otp',
    text: 'Caller asked for your otp. Nothing was shared.',
    said: 'OTP cheppandi',
  });
  expect(await screen.findByText('+91 97001 12233 asked for your OTP')).toBeTruthy();
  expect(screen.getByText(/^They said: "OTP cheppandi"\. Ava refused and shared nothing\./)).toBeTruthy();
  expect(screen.getByText('Needs you · 2')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('+91 97001 12233 asked for your OTP')).toBeNull();
  await fireEvent.press(await screen.findByRole('button', { name: 'Undo' }));
  expect(await screen.findByText('+91 97001 12233 asked for your OTP')).toBeTruthy();
});

test('the readiness chip opens what the server has ready, part by part', async () => {
  server.state.health = { ...server.state.health, ready: { ...server.state.health.ready!, tts: false }, llm_model: 'qwen2.5-3b-instruct-q4' };
  await renderScreen(<Today />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Getting ready: voice. Details' }));
  const sheet = within(await screen.findByTestId('readiness-sheet'));
  expect(sheet.getByLabelText('Voice: still loading')).toBeTruthy();
  expect(sheet.getByLabelText('Hearing: ready')).toBeTruthy();
  expect(sheet.getByText('The language model · qwen2.5-3b-instruct-q4')).toBeTruthy();
  server.state.health = { ...server.state.health, ready: { ...server.state.health.ready!, tts: true } };
  await fireEvent.press(sheet.getByRole('button', { name: 'Check again' }));
  expect(await sheet.findByLabelText('Voice: ready')).toBeTruthy();
});

test("today's numbers open the matching Inbox list", async () => {
  await renderScreen(<Today />);
  await fireEvent.press(await screen.findByRole('button', { name: /^Spam stopped: \d+$/ }));
  expect(push).toHaveBeenCalledWith('/inbox?tab=calls&filter=spam');
});

test('latest messages: new first; opening one marks it read', async () => {
  await renderScreen(<Today />);
  const list = within(await screen.findByTestId('latest-messages'));
  expect(list.getByText('New messages · 2')).toBeTruthy();
  await fireEvent.press(list.getByRole('button', { name: /^New message from Amma/ }));
  expect(push).toHaveBeenCalledWith('/call/call-amma');
  await waitFor(() => expect(requests('POST', '/messages/msg-amma/read')).toHaveLength(1));
  expect(list.getByText('New messages · 1')).toBeTruthy();
});

test('turning the assistant off saves and says what happens to calls', async () => {
  await renderScreen(<Today />);
  await fireEvent(await screen.findByLabelText('Assistant answers calls'), 'valueChange', false);
  expect(await screen.findByText('Calls will ring through as usual.')).toBeTruthy();
  expect(server.state.profile.enabled).toBe(false);
  expect(screen.getByText('Assistant is off')).toBeTruthy();
});
