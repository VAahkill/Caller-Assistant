// The call screen against the in-memory v2 server: a live call (status, hold
// answers, replies in the owner's language) and a finished one (summary, actions).

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => {
  const { Fragment, createElement } = require('react');
  return {
    ...jest.requireActual('expo-router'),
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useLocalSearchParams: jest.fn(),
    // Renders the header's right-hand buttons so they can be pressed.
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: (p: object) => unknown } }) =>
        createElement(Fragment, null, options?.headerRight ? options.headerRight({}) : null),
    },
  };
});

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Share } from 'react-native';

import CallScreen from '../../app/call/[id]';
import { AMMA, LIVE_CALL_ID } from '../../lib/mock/fixtures';
import type { MockServer } from '../../lib/mock/server';
import { getTransport, setTransport } from '../../lib/transport';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
const params = useLocalSearchParams as jest.Mock;
const requests = (method: string, path: string) => server.log.filter((r) => r.method === method && r.path === path);

beforeEach(async () => {
  server = await useMockServer();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await resetApi();
});

describe('a live call', () => {
  beforeEach(() => params.mockReturnValue({ id: LIVE_CALL_ID }));

  test('says what is happening, which language the caller speaks, and what they asked', async () => {
    await renderScreen(<CallScreen />);
    expect(await screen.findByTestId('live-status-title')).toHaveTextContent('On hold, waiting for you');
    expect(screen.getByText('Caller speaks Telugu')).toBeTruthy();
    expect(screen.getAllByText('Should I leave the order with security, or bring it up to the flat?').length).toBeGreaterThan(0);
    const composer = within(screen.getByTestId('composer'));
    expect(composer.getByText('Answering +91 97001 12233')).toBeTruthy();
    expect(composer.getByText('Ava tells them in Telugu.')).toBeTruthy();
  });

  test('a typed answer shows at once, goes to the hold, and lands in the transcript', async () => {
    await renderScreen(<CallScreen />);
    const box = await screen.findByLabelText('Your answer, in English');
    await fireEvent.changeText(box, 'Please bring it up to the flat');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(requests('POST', `/calls/${LIVE_CALL_ID}/answer`)[0].body).toEqual({ text: 'Please bring it up to the flat', hold_id: 'hold-gate' });
    // The server's transcript line replaces the pending bubble, and the hold is over.
    await waitFor(() => expect(screen.queryByTestId(/^outbox-/)).toBeNull());
    expect(screen.getByText('Please bring it up to the flat')).toBeTruthy();
    expect(await screen.findByLabelText('Reply in English')).toBeTruthy();
    expect(screen.getByText("Reply in English, I'll say it in Telugu.")).toBeTruthy();
  });

  test('replies in English, by quick reply, are said in the caller language', async () => {
    server.state.calls.find((c) => c.id === LIVE_CALL_ID)!.holds[0].answer = 'done';
    server.state.calls.find((c) => c.id === LIVE_CALL_ID)!.status = 'active';
    // Hold the request open to see what shows while it is in flight.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const base = getTransport();
    setTransport({ ...base, fetch: async (url, init) => (url.endsWith('/say') ? gate.then(() => base.fetch(url, init)) : base.fetch(url, init)) });
    await renderScreen(<CallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: "I'm coming down in 2 minutes" }));
    expect(screen.getByTestId('outbox-sending')).toHaveTextContent(/I'm coming down in 2 minutes.*Sending…/);
    await act(async () => release());
    expect(requests('POST', `/calls/${LIVE_CALL_ID}/say`)[0].body).toEqual({ text: "I'm coming down in 2 minutes", lang: 'en' });
    // Then the server's line (Telugu, led by what the owner wrote) replaces it.
    await waitFor(() => expect(screen.queryByTestId(/^outbox-/)).toBeNull());
    expect(screen.getByText('దయచేసి గేట్ 2 దగ్గర సెక్యూరిటీకి ఇవ్వండి.')).toBeTruthy();
    expect(screen.getByText('They heard, in Telugu')).toBeTruthy();
  });

  test('a reply that fails stays on screen with the reason and Retry', async () => {
    server.state.calls.find((c) => c.id === LIVE_CALL_ID)!.holds[0].answer = 'done';
    await renderScreen(<CallScreen />);
    await screen.findByLabelText('Reply in English');
    server.state.calls.find((c) => c.id === LIVE_CALL_ID)!.ended_at = Date.now() / 1000;
    await fireEvent.changeText(screen.getByLabelText('Reply in English'), 'Hello?');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(await screen.findByTestId('outbox-failed')).toBeTruthy();
    expect(screen.getByText(/^Not sent: /)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  test('the translation switch hides and shows the English under Telugu lines', async () => {
    await renderScreen(<CallScreen />);
    const english = "Hello, this is Swiggy. I've brought your order and I'm at the gate.";
    expect(await screen.findByText(english)).toBeTruthy();
    await fireEvent.press(screen.getByRole('switch', { name: 'Show translations in English' }));
    expect(screen.queryByText(english)).toBeNull();
    await fireEvent.press(screen.getByRole('switch', { name: 'Show translations in English' }));
    expect(screen.getByText(english)).toBeTruthy();
  });

  test('losing the connection keeps the call on screen and says it is reconnecting', async () => {
    await renderScreen(<CallScreen />);
    expect(await screen.findByTestId('live-status-title')).toHaveTextContent('On hold, waiting for you');
    expect(screen.queryByTestId('reconnecting')).toBeNull();
    await act(async () => {
      for (const s of server.liveSockets) (s as unknown as { close: (code: number) => void }).close(1006);
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.getByTestId('reconnecting')).toBeTruthy();
    expect(screen.getByTestId('live-status')).toBeTruthy();
    expect(screen.queryByText('The call has ended')).toBeNull();
  });

  test('ending the call asks first, then tells the server', async () => {
    await renderScreen(<CallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'End the call' }));
    expect(requests('POST', `/calls/${LIVE_CALL_ID}/end`)).toHaveLength(0);
    await fireEvent.press(await screen.findByTestId('confirm-sheet-confirm'));
    await waitFor(() => expect(requests('POST', `/calls/${LIVE_CALL_ID}/end`)).toHaveLength(1));
    expect(await screen.findByText('Wrapping up the call.')).toBeTruthy();
  });
});

describe('a finished call', () => {
  test('summary, message, to-do, recording and transcript', async () => {
    params.mockReturnValue({ id: 'call-amma' });
    await renderScreen(<CallScreen />);
    const summary = within(await screen.findByTestId('summary'));
    expect(summary.getByText(/asked whether you are coming for lunch on Sunday/)).toBeTruthy();
    expect(summary.getByText('Message for you')).toBeTruthy();
    expect(summary.getByText('Call Amma back about Sunday lunch')).toBeTruthy();
    expect(screen.getByTestId('recording')).toBeTruthy();
    const english = "Okay, ask him if he's coming for lunch on Sunday. Tell him to call when he's free.";
    expect(screen.getByText(english)).toBeTruthy();
    await fireEvent(screen.getByLabelText('Show the call in English'), 'valueChange', false);
    expect(screen.queryByText(english)).toBeNull();
  });

  test('call back and WhatsApp open the dialler and wa.me', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    params.mockReturnValue({ id: 'call-amma' });
    await renderScreen(<CallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Call Amma back' }));
    expect(open).toHaveBeenCalledWith(`tel:${AMMA}`);
    await fireEvent.press(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(open).toHaveBeenCalledWith(`https://wa.me/${AMMA.replace('+', '')}`);
  });

  test("a phone that can't open the link says so", async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No app'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    params.mockReturnValue({ id: 'call-amma' });
    await renderScreen(<CallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'WhatsApp' }));
    expect(await screen.findByText("Couldn't open WhatsApp on this phone.")).toBeTruthy();
  });

  test('VIP toggles with a toast', async () => {
    params.mockReturnValue({ id: 'call-amma' });
    await renderScreen(<CallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove Amma from VIPs' }));
    expect(await screen.findByText('Amma is no longer a VIP.')).toBeTruthy();
    expect(server.state.profile.vip_numbers).not.toContain(AMMA);
    expect(await screen.findByRole('button', { name: 'Save Amma as a VIP' })).toBeTruthy();
  });

  test('block asks first, then offers Undo', async () => {
    params.mockReturnValue({ id: 'call-rajesh' });
    await renderScreen(<CallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Block +91 99123 45678' }));
    await fireEvent.press(await screen.findByTestId('confirm-sheet-confirm'));
    expect(await screen.findByText('+91 99123 45678 is blocked.')).toBeTruthy();
    expect(server.state.profile.blocked_numbers).toContain('+919912345678');
    expect(await screen.findByRole('button', { name: 'Unblock +91 99123 45678' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(server.state.profile.blocked_numbers).not.toContain('+919912345678'));
  });

  test('share sends the summary and transcript to the share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    params.mockReturnValue({ id: 'call-amma' });
    await renderScreen(<CallScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share the transcript' }));
    const message = share.mock.calls[0][0] as { message: string };
    expect(message.message).toMatch(/^Amma · /);
    expect(message.message).toContain('Amma: సరే, ఆదివారం');
    expect(message.message).toContain("(Okay, ask him if he's coming for lunch on Sunday.");
  });

  test('a blocked call explains why it was blocked', async () => {
    params.mockReturnValue({ id: 'call-loan' });
    await renderScreen(<CallScreen />);
    const summary = within(await screen.findByTestId('summary'));
    expect(summary.getByText('Blocked')).toBeTruthy();
    expect(summary.getByText(/^Why: /)).toBeTruthy();
  });

  test('a call that cannot be loaded offers Retry', async () => {
    params.mockReturnValue({ id: 'call-missing' });
    await renderScreen(<CallScreen />);
    expect(await screen.findByText("Couldn't load this call")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
