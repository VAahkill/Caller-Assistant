// Today against the in-memory v2 server and its live events socket.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import Today from '../../app/(tabs)/index';
import { isToday } from '../../lib/format';
import { LIVE_CALL_ID, NO_LINE } from '../../lib/mock/fixtures';
import type { MockServer } from '../../lib/mock/server';
import { PHONE_LINE_GUIDE_URL, UPDATE_GUIDE_URL } from '../../lib/serverStatus';
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

test("practice calls and their messages don't count on Today", async () => {
  const answered = server.state.calls.filter((c) => isToday(c.started_at) && c.direction === 'inbound' && c.status !== 'rejected').length;
  const practice = { ...server.state.calls[0], id: 'call-practice', number: '+919800000000', contact_name: '', status: 'ended' as const, started_at: Date.now() / 1000 };
  server.state.calls = [practice, ...server.state.calls];
  server.state.messages = [
    { ...server.state.messages[0], id: 'msg-practice', call_id: practice.id, number: practice.number, caller_name: '', status: 'new', created_at: Date.now() / 1000 },
    ...server.state.messages,
  ];
  await renderScreen(<Today />);
  expect(await screen.findByRole('button', { name: `Answered: ${answered}` })).toBeTruthy();
  const list = within(screen.getByTestId('latest-messages'));
  expect(list.getByText('New messages · 2')).toBeTruthy();
  expect(list.queryByText(/Practice/)).toBeNull();
});

test('"I can answer questions now" on Today saves availability, so holds wait for the owner', async () => {
  server.state.profile = { ...server.state.profile, available: false };
  await renderScreen(<Today />);
  const hero = within(await screen.findByTestId('availability'));
  expect(hero.getByText('Callers on hold wait only 20 s, then Ava takes a message.')).toBeTruthy();
  await fireEvent(hero.getByLabelText('I can answer questions now'), 'valueChange', true);
  expect(await screen.findByText('Ava will put callers on hold to ask you.')).toBeTruthy();
  expect(server.state.profile.available).toBe(true);
  expect(requests('PATCH', '/profile').at(-1)?.body).toEqual({ available: true });
});

test('turning the assistant off saves and says what happens to calls', async () => {
  await renderScreen(<Today />);
  await fireEvent(await screen.findByLabelText('Assistant answers calls'), 'valueChange', false);
  expect(await screen.findByText('Calls will ring through as usual.')).toBeTruthy();
  expect(server.state.profile.enabled).toBe(false);
  expect(screen.getByText('Assistant is off')).toBeTruthy();
});

describe('the phone line', () => {
  test("with no line, Today doesn't say real calls are answered, says why, and offers practice", async () => {
    server.state.health = { ...server.state.health, phone_line: { ...NO_LINE } };
    server.state.calls = server.state.calls.filter((x) => x.id !== LIVE_CALL_ID);
    await renderScreen(<Today />);
    expect(await screen.findByText('Ava is on · no phone line yet')).toBeTruthy();
    expect(screen.getByText('Real calls ring through as usual until your server has a phone line.')).toBeTruthy();
    const card = within(screen.getByTestId('phone-line'));
    expect(card.getByText("Real calls can't reach Ava yet")).toBeTruthy();
    expect(
      card.getByText(
        "Android doesn't let apps answer or speak on phone calls, so calls reach Ava through your server's phone line. " +
          "The free lines (Bluetooth to your phone, or a USB SIM modem) need the server on a Linux computer: Docker Desktop on Windows or a Mac can't reach them.",
      ),
    ).toBeTruthy();
    expect(card.getByText(NO_LINE.detail)).toBeTruthy();
    await fireEvent.press(card.getByRole('button', { name: 'Try a practice call' }));
    expect(push).toHaveBeenCalledWith('/practice');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(card.getByRole('button', { name: 'How to connect a phone line' }));
    expect(openURL).toHaveBeenCalledWith(PHONE_LINE_GUIDE_URL);
    openURL.mockRestore();
    // The chip and its sheet say the same.
    await fireEvent.press(screen.getByRole('button', { name: 'Ready · no phone line yet. Details' }));
    const sheet = within(await screen.findByTestId('readiness-sheet'));
    expect(sheet.getByText('Not connected yet')).toBeTruthy();
    expect(within(sheet.getByTestId('ready-phone-line')).getByText(NO_LINE.detail)).toBeTruthy();
  });

  test('with a working line there is no card, and the sheet names the line', async () => {
    await renderScreen(<Today />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Connected · everything ready. Details' }));
    const sheet = within(await screen.findByTestId('readiness-sheet'));
    expect(sheet.getByText('Bluetooth phone · connected')).toBeTruthy();
    expect(screen.queryByTestId('phone-line')).toBeNull();
  });
});

test('a first-version server is pointed to the update steps', async () => {
  server.state.health = { ...server.state.health, version: '', phone_line: null, ready: null };
  server.state.calls = server.state.calls.filter((x) => x.id !== LIVE_CALL_ID);
  await renderScreen(<Today />);
  const banner = within(await screen.findByTestId('server-outdated'));
  expect(banner.getByText('Your server needs updating')).toBeTruthy();
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await fireEvent.press(banner.getByRole('button', { name: 'Open the setup guide' }));
  expect(openURL).toHaveBeenCalledWith(UPDATE_GUIDE_URL);
  openURL.mockRestore();
  // Servers this old don't report a line: Today doesn't claim real calls are answered.
  const card = within(screen.getByTestId('phone-line'));
  expect(card.getByText('Real calls need a phone line')).toBeTruthy();
  expect(card.getByText('Your server is too old to say whether it has a phone line. Update it to find out.')).toBeTruthy();
  expect(screen.getByText('Ava is on')).toBeTruthy();
  expect(screen.getByText('Update your server to see whether real calls can reach Ava.')).toBeTruthy();
  expect(screen.queryByText(/is answering/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Connected · server needs updating. Details' })).toBeTruthy();
});
