// The Inbox against the in-memory v2 server: tabs, search, filter chips on both
// tabs, day groups, mark read, and the loading/error states.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import Inbox from '../../app/(tabs)/inbox';
import { OFFLINE } from '../../lib/api';
import { dayTitle } from '../../lib/inbox';
import type { MockServer } from '../../lib/mock/server';
import { getTransport, setTransport } from '../../lib/transport';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
const requests = (method: string, path: string) => server.log.filter((r) => r.method === method && r.path === path);
const params = useLocalSearchParams as jest.Mock;
const messageIds = () => screen.queryAllByTestId(/^message-/).map((n) => n.props.testID);
const callNames = () =>
  screen
    .queryAllByRole('button', { name: /^Call (from|to) / })
    .map((n) => String(n.props.accessibilityLabel).replace(/^Call (from|to) /, '').split(',')[0]);

beforeEach(async () => {
  params.mockReturnValue({});
  (router.push as jest.Mock).mockClear();
  server = await useMockServer();
});
afterEach(resetApi);

describe('Messages', () => {
  test('lists messages under day headings, new ones marked', async () => {
    await renderScreen(<Inbox />);
    await screen.findByTestId('message-msg-amma');
    expect(messageIds()).toEqual(['message-msg-amma', 'message-msg-rajesh', 'message-msg-priya']);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('2 new messages')).toBeTruthy();
    expect(within(screen.getByTestId('message-msg-rajesh')).getByText(/· Urgent$/)).toBeTruthy();
  });

  test('the filter chips work on messages, by the call each was left on', async () => {
    await renderScreen(<Inbox />);
    await screen.findByTestId('message-msg-amma');
    await fireEvent.press(screen.getByRole('button', { name: 'Contacts, 2' }));
    expect(messageIds()).toEqual(['message-msg-amma', 'message-msg-priya']);
    await fireEvent.press(screen.getByRole('button', { name: 'Unknown, 1' }));
    expect(messageIds()).toEqual(['message-msg-rajesh']);
    await fireEvent.press(screen.getByRole('button', { name: 'Spam' }));
    expect(messageIds()).toEqual([]);
    expect(screen.getByText('No messages match')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(messageIds()).toHaveLength(3);
  });

  test('search finds words in the message and numbers typed with spaces', async () => {
    await renderScreen(<Inbox />);
    await screen.findByTestId('message-msg-amma');
    await fireEvent.changeText(screen.getByLabelText('Search messages'), 'kitchen');
    expect(messageIds()).toEqual(['message-msg-rajesh']);
    await fireEvent.changeText(screen.getByLabelText('Search messages'), '98480 12345');
    expect(messageIds()).toEqual(['message-msg-amma']);
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(messageIds()).toHaveLength(3);
  });

  test('opening a new message marks it read and opens its call', async () => {
    await renderScreen(<Inbox />);
    await fireEvent.press(await screen.findByLabelText(/^Message from Amma/));
    expect(router.push).toHaveBeenCalledWith('/call/call-amma');
    await waitFor(() => expect(requests('POST', '/messages/msg-amma/read')).toHaveLength(1));
    expect(await screen.findByText('1 new message')).toBeTruthy();
  });

  test('Mark all read marks every new message and says how many', async () => {
    await renderScreen(<Inbox />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('Marked 2 messages read.')).toBeTruthy();
    expect(requests('POST', '/messages/msg-amma/read')).toHaveLength(1);
    expect(requests('POST', '/messages/msg-rajesh/read')).toHaveLength(1);
    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });
});

describe('Calls', () => {
  test('every call under its day; chips filter and show counts', async () => {
    await renderScreen(<Inbox />);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Calls' }));
    await waitFor(() => expect(callNames()).toHaveLength(8));
    await fireEvent.press(screen.getByRole('button', { name: 'Spam, 2' }));
    expect(callNames()).toEqual(['+91 88001 12233', '+91 14012 34567']);
    await fireEvent.press(screen.getByRole('button', { name: 'Blocked, 1' }));
    expect(callNames()).toEqual(['+91 14012 34567']);
    await fireEvent.press(screen.getByRole('button', { name: 'Delivery, 2' }));
    expect(callNames()).toEqual(['+91 97001 12233', '+91 95500 11223']);
    // The fixtures are hours before "now", so which days they fall on depends on the time the test runs.
    const days = server.state.calls.filter((c) => ['+919700112233', '+919550011223'].includes(c.number)).map((c) => dayTitle(c.started_at));
    expect(days).toHaveLength(2);
    for (const day of new Set(days)) expect(screen.getByText(day)).toBeTruthy();
  });

  test('search reads summaries too', async () => {
    await renderScreen(<Inbox />);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Calls' }));
    await fireEvent.changeText(screen.getByLabelText('Search calls'), 'biryani');
    await waitFor(() => expect(callNames()).toEqual(['Paradise Biryani']));
  });

  test('a link from Today opens Calls with its filter', async () => {
    params.mockReturnValue({ tab: 'calls', filter: 'spam' });
    await renderScreen(<Inbox />);
    await waitFor(() => expect(callNames()).toEqual(['+91 88001 12233', '+91 14012 34567']));
    expect(screen.getByRole('button', { name: 'Spam, 2' })).toBeSelected();
  });

  test("a list that can't load says why and retries", async () => {
    const base = getTransport();
    let fail = true;
    setTransport({
      ...base,
      fetch: async (url, init) => {
        if (fail && url.includes('/calls')) throw new Error('Network request failed');
        return base.fetch(url, init);
      },
    });
    params.mockReturnValue({ tab: 'calls' });
    await renderScreen(<Inbox />);
    expect(await screen.findByText("Couldn't load this")).toBeTruthy();
    // Said plainly, not as the platform's "Network request failed".
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(callNames()).toHaveLength(8));
  });
});
