// Call for me against the in-memory v2 server: templates, paste on tap only,
// contacts, starting a call, and each task's steps as task_update events arrive.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => ''), setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import CallForMe from '../../app/(tabs)/tasks';
import { NO_LINE } from '../../lib/mock/fixtures';
import type { MockServer } from '../../lib/mock/server';
import { PHONE_LINE_GUIDE_URL } from '../../lib/serverStatus';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
beforeEach(async () => {
  jest.clearAllMocks();
  server = await useMockServer();
});
afterEach(resetApi);

const requests = (method: string, path: string) => server.log.filter((r) => r.method === method && r.path === path);

async function open() {
  await renderScreen(<CallForMe />);
  await screen.findByTestId('task-task-paradise');
  // The live socket is open once the server's snapshot of live calls is in.
  await waitFor(() => expect(server.liveSockets.size).toBe(1));
}

async function startTask() {
  await fireEvent.press(screen.getByTestId('template-table'));
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '040 2345 6789');
  await fireEvent.changeText(screen.getByLabelText('Place or person (optional)'), 'Paradise Biryani');
  await fireEvent.press(screen.getByRole('button', { name: 'Call Paradise Biryani' }));
  expect(await screen.findByText('Calling Paradise Biryani now. Follow it below.')).toBeTruthy();
  return server.state.tasks[0];
}

test('a template fills in what to do and the kind, and says what that kind does', async () => {
  await open();
  await fireEvent.press(screen.getByTestId('template-order'));
  expect(screen.getByLabelText('What should your assistant do?').props.value).toBe('Ask when my order will be delivered. Order number: ');
  expect(screen.getByTestId('template-order').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByRole('button', { name: 'Just ask' }).props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByText("Asks and tells you the answer. It won't agree to anything for you.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId('template-table'));
  expect(screen.getByRole('button', { name: 'Ask and book' }).props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByText('If it is available, it books it for you. Anything different, it asks you first.')).toBeTruthy();
});

test('the clipboard is read only when Paste is tapped, and the result is said', async () => {
  await open();
  await fireEvent(screen.getByLabelText('Phone number'), 'focus');
  expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
  (Clipboard.getStringAsync as jest.Mock).mockResolvedValueOnce('Paradise Biryani · 040 2345 6789 · Open now');
  await fireEvent.press(screen.getByRole('button', { name: 'Paste' }));
  await waitFor(() => expect(screen.getByLabelText('Phone number').props.value).toBe('+914023456789'));
  expect(screen.getByText('Pasted +91 40 2345 6789.')).toBeTruthy();
  (Clipboard.getStringAsync as jest.Mock).mockResolvedValueOnce('see you at 8');
  await fireEvent.press(screen.getByRole('button', { name: 'Paste' }));
  expect(await screen.findByText('No phone number on the clipboard. Copy one from Maps, WhatsApp or a website.')).toBeTruthy();
});

test('a number can be picked from contacts, with the name', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Pick from contacts' }));
  await fireEvent.press(within(screen.getByTestId('task-contacts')).getByRole('button', { name: 'Priya, +91 98665 54433' }));
  expect(screen.getByLabelText('Phone number').props.value).toBe('+919866554433');
  expect(screen.getByLabelText('Place or person (optional)').props.value).toBe('Priya');
  expect(screen.getByRole('button', { name: 'Call Priya' })).toBeTruthy();
});

test('Start needs a number and a goal, and a short number is pointed out', async () => {
  await open();
  const startButton = () => screen.getByTestId('start-task');
  expect(startButton()).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '1234');
  expect(screen.getByText('That number looks too short.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('What should your assistant do?'), 'Ask if they are open on Sunday.');
  expect(startButton()).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '9876500001');
  expect(startButton()).not.toBeDisabled();
});

test('a started call shows in progress and moves through its steps live, then lands in Earlier', async () => {
  await open();
  const task = await startTask();
  expect(requests('POST', '/tasks')[0].body).toEqual({ number: '040 2345 6789', goal: 'Book a table for 2 tonight at 8 PM under my name.', kind: 'book', target_name: 'Paradise Biryani' });
  // The form is ready for the next one.
  expect(screen.getByLabelText('Phone number').props.value).toBe('');
  const active = within(screen.getByTestId('tasks-active'));
  expect(active.getByText('+91 40 2345 6789 · just now')).toBeTruthy();
  const step = (key: string) => screen.getByTestId(`timeline-${task.id}-${key}`).props.accessibilityLabel as string;
  expect(step('queued')).toMatch(/^Queued, now/);

  server.advanceTask(task.id, 'dialing');
  await waitFor(() => expect(step('dialing')).toMatch(/^Calling Paradise Biryani, now/));
  expect(step('queued')).toMatch(/^Queued, done/);

  server.advanceTask(task.id, 'in_call');
  await waitFor(() => expect(step('in_call')).toMatch(/^Talking to them now, now/));
  expect(step('dialing')).toMatch(/^Dialled, done, /);

  server.advanceTask(task.id, 'done', { outcome: 'booked', result: 'Booked for 2 at 8 PM.' });
  expect(await screen.findByText('Booked for 2 at 8 PM.')).toBeTruthy();
  // Finished: no timeline, and only the Amazon call is still in progress.
  expect(screen.queryByTestId(`timeline-${task.id}`)).toBeNull();
  expect(within(screen.getByTestId('tasks-active')).queryByTestId(`task-${task.id}`)).toBeNull();
  expect(screen.getByText('In progress · 1')).toBeTruthy();
});

test("the place's question waits in the task's card, and the answer goes to that call", async () => {
  await open();
  const task = await startTask();
  server.advanceTask(task.id, 'waiting_user', { call_id: 'call-out-1' });
  server.liveSockets.forEach((sk) =>
    sk.push(
      {
        event: 'task_needs_decision',
        call_id: 'call-out-1',
        who: 'Paradise Biryani',
        hold_id: 'hold-1',
        question: 'They have 8:30 instead of 8. Is that OK?',
        title: 'Paradise Biryani needs a decision',
        task_id: task.id,
      },
      0,
    ),
  );
  const decision = within(await screen.findByTestId(`decision-${task.id}`));
  expect(decision.getByText('They have 8:30 instead of 8. Is that OK?')).toBeTruthy();
  expect(screen.getByTestId(`timeline-${task.id}-waiting_user`).props.accessibilityLabel).toMatch(/^Waiting for your decision, now/);
  await fireEvent.press(decision.getByRole('button', { name: 'Yes, that works' }));
  await waitFor(() => expect(server.log.some((r) => r.method === 'POST' && r.path === '/calls/call-out-1/answer')).toBe(true));
});

test('a call that did not work can be tried again in one tap', async () => {
  await open();
  const card = within(screen.getByTestId('task-task-dentist'));
  expect(card.getByText("No one answered after 3 tries. I'll stop here.")).toBeTruthy();
  await fireEvent.press(card.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Trying Smile Dental again.')).toBeTruthy();
  expect(requests('POST', '/tasks').at(-1)?.body).toMatchObject({ number: '+919000012345', target_name: 'Smile Dental' });
});

test('a finished call opens its transcript', async () => {
  await open();
  await fireEvent.press(within(screen.getByTestId('task-task-paradise')).getByRole('button', { name: 'See the call' }));
  expect(router.push).toHaveBeenCalledWith('/call/call-paradise');
});

describe('without a phone line', () => {
  beforeEach(() => {
    server.state.health = { ...server.state.health, phone_line: { ...NO_LINE } };
  });

  test("says so with the server's reason, and offers to practise the call instead", async () => {
    await open();
    const banner = within(await screen.findByTestId('no-line'));
    expect(banner.getByText('No phone line yet')).toBeTruthy();
    expect(banner.getByText(`${NO_LINE.detail} You can still practise: you play the place, and Ava calls you here in the app.`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start the call' })).toBeNull();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(banner.getByRole('button', { name: 'How to connect a phone line' }));
    expect(openURL).toHaveBeenCalledWith(PHONE_LINE_GUIDE_URL);
    openURL.mockRestore();
  });

  test('Practise this call opens practice with the call filled in; the practice number stands in for a missing one', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Practise this call' })).toBeDisabled();
    await fireEvent.press(screen.getByTestId('template-table'));
    await fireEvent.changeText(screen.getByLabelText('Place or person (optional)'), 'Paradise Biryani');
    await fireEvent.press(screen.getByRole('button', { name: 'Practise this call' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/practice',
      params: { goal: 'Book a table for 2 tonight at 8 PM under my name.', kind: 'book', target: 'Paradise Biryani', number: '+919800000000' },
    });
    expect(requests('POST', '/tasks')).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Phone number'), '040 2345 6789');
    await fireEvent.press(screen.getByRole('button', { name: 'Practise this call' }));
    expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ number: '040 2345 6789' }) }));
  });
});

test('an older server that reports no line goes by how it places calls', async () => {
  server.state.health = { ...server.state.health, phone_line: null, dialer: 'none' };
  await open();
  const banner = within(await screen.findByTestId('no-line'));
  expect(banner.getByText(/^Your server can't place calls yet\. You can still practise/)).toBeTruthy();
});

test('with a phone line, the call can still be practised first', async () => {
  await open();
  expect(screen.queryByTestId('no-line')).toBeNull();
  expect(screen.getByTestId('practise-first')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('template-order'));
  await fireEvent.press(screen.getByTestId('practise-first'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/practice',
    params: { goal: 'Ask when my order will be delivered. Order number:', kind: 'enquire', target: '', number: '+919800000000' },
  });
});

test("a call the server turns down says the server's reason, and the screen then offers practice", async () => {
  await open();
  server.state.health = { ...server.state.health, phone_line: { ...NO_LINE } };
  await fireEvent.press(screen.getByTestId('template-table'));
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '040 2345 6789');
  await fireEvent.press(screen.getByRole('button', { name: 'Start the call' }));
  expect(await screen.findByText(NO_LINE.detail)).toBeTruthy();
  expect(await screen.findByTestId('no-line')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Practise this call' })).toBeTruthy();
});

test("a call that failed on the server's side is explained in a sentence, not the raw error", async () => {
  const dentist = server.state.tasks.find((x) => x.id === 'task-dentist')!;
  dentist.outcome = 'failed';
  dentist.result = 'All connection attempts failed';
  await open();
  const card = within(screen.getByTestId('task-task-dentist'));
  expect(card.getByText("Your server couldn't reach its phone line, so the call wasn't placed.")).toBeTruthy();
  expect(card.queryByText('All connection attempts failed')).toBeNull();
});

test('a practice call is marked Practice and can be practised again', async () => {
  server.state.tasks.unshift({
    ...server.state.tasks.find((x) => x.id === 'task-paradise')!,
    id: 'task-practice',
    number: '+919800000000',
    target_name: '',
    call_id: null,
    result: 'They said: "Yes, 8 PM is fine."',
    practice: true,
  });
  await open();
  const card = within(screen.getByTestId('task-task-practice'));
  expect(card.getByTestId('practice-task-practice')).toBeTruthy();
  expect(card.getByText('In the app only: nothing is really booked or arranged.')).toBeTruthy();
  expect(card.getByText('The place')).toBeTruthy();
  expect(within(screen.getByTestId('task-task-paradise')).queryByText('Practice')).toBeNull();
  await fireEvent.press(card.getByRole('button', { name: 'Practise again' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/practice', params: expect.objectContaining({ number: '+919800000000', target: '' }) });
  expect(requests('POST', '/tasks')).toHaveLength(0);
});
