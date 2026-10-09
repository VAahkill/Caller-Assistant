// Instructions and "What callers may know" against the in-memory v2 server.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import Instructions from '../../app/instructions';
import Notes from '../../app/notes';
import type { MockServer } from '../../lib/mock/server';
import { endsAt } from '../../lib/calendar';
import { expiryText } from '../../lib/rules';
import { resetApi, useMockServer } from '../../test/mockApi';
import { renderScreen } from '../../test/renderScreen';

let server: MockServer;
beforeEach(async () => {
  server = await useMockServer();
});
afterEach(resetApi);

const requests = (method: string, prefix: string) => server.log.filter((r) => r.method === method && r.path.startsWith(prefix));

describe('Instructions', () => {
  test('lists rules with who they apply to, the paused one last', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-delivery');
    expect(screen.getByRole('button', { name: 'In use, 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Off, 1' })).toBeTruthy();
    // A rule for specific numbers names the contact instead of counting numbers.
    const amma = within(screen.getByTestId('instruction-ins-amma'));
    expect(amma.getByText('Amma')).toBeTruthy();
    expect(amma.getByText('Family and friends')).toBeTruthy();
    const trip = screen.getByTestId('instruction-ins-trip');
    const ends = server.state.profile.instructions.find((i) => i.id === 'ins-trip')!.expires_at;
    expect(within(trip).getByText(expiryText(ends)!)).toBeTruthy();
    const order = screen.getAllByTestId(/^instruction-[a-z]+-[a-z]+$/).map((n) => n.props.testID);
    expect(order[order.length - 1]).toBe('instruction-ins-trip');
  });

  test('the switch saves at once', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-trip');
    await act(async () => {
      fireEvent(screen.getByTestId('instruction-ins-trip-switch'), 'valueChange', true);
    });
    await waitFor(() => expect(requests('PATCH', '/instructions/ins-trip')).toHaveLength(1));
    expect(requests('PATCH', '/instructions/ins-trip')[0].body).toEqual({ enabled: true });
    expect(screen.getByTestId('instruction-ins-trip-switch').props.on).toBe(true);
    expect(server.state.profile.instructions.find((i) => i.id === 'ins-trip')?.enabled).toBe(true);
    expect(screen.getByRole('button', { name: 'In use, 5' })).toBeTruthy();
    expect(await screen.findByText('Instruction on. It applies from the next call.')).toBeTruthy();
  });

  test('filters show the rules in use, switched off or ended', async () => {
    const now = Math.floor(Date.now() / 1000);
    server.state.profile.instructions.push({
      id: 'ins-old',
      text: 'Say I am on leave this week.',
      enabled: true,
      applies_to: 'everyone',
      numbers: [],
      category: 'general',
      expires_at: now - 3600,
      created_at: now - 86400,
      updated_at: now - 86400,
    });
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-amma');
    expect(screen.getAllByTestId(/^instruction-ins-[a-z]+$/)).toHaveLength(6);

    await fireEvent.press(screen.getByRole('button', { name: 'Off, 1' }));
    expect(screen.getAllByTestId(/^instruction-ins-[a-z]+$/).map((n) => n.props.testID)).toEqual(['instruction-ins-trip']);

    await fireEvent.press(screen.getByRole('button', { name: 'Ended, 1' }));
    const old = within(screen.getByTestId('instruction-ins-old'));
    expect(old.getByText('Ended')).toBeTruthy();
    expect(screen.queryByTestId('instruction-ins-amma')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'In use, 4' }));
    expect(screen.queryByTestId('instruction-ins-old')).toBeNull();
    expect(screen.queryByTestId('instruction-ins-trip')).toBeNull();
    expect(screen.getByTestId('instruction-ins-amma')).toBeTruthy();
  });

  test('a filter with nothing in it says so', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-amma');
    await fireEvent.press(screen.getByRole('button', { name: 'Ended' }));
    expect(screen.getByText('Nothing has ended')).toBeTruthy();
    expect(screen.queryByTestId('instruction-ins-amma')).toBeNull();
  });

  test('a custom end date is picked on the calendar and saved', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-delivery');
    await fireEvent.press(screen.getByRole('button', { name: 'New instruction' }));
    await fireEvent.changeText(screen.getByLabelText('What should the assistant do?'), 'Say I am at a wedding.');
    await fireEvent.press(screen.getByRole('button', { name: 'Pick a date' }));
    expect(screen.getByText('Pick the day it should stop.')).toBeTruthy();

    // Three days from now; that may be next month on the calendar.
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + 3);
    if (day.getMonth() !== new Date().getMonth()) await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    const label = day.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });
    await fireEvent.press(within(screen.getByTestId('rule-calendar')).getByRole('button', { name: label }));
    await fireEvent.press(within(screen.getByTestId('rule-calendar')).getByRole('button', { name: '6 PM' }));
    const expected = endsAt(day.getTime(), 'evening');
    expect(screen.getByRole('button', { name: expiryText(expected)! })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Add instruction' }));
    await waitFor(() => expect(requests('POST', '/instructions')).toHaveLength(1));
    expect(requests('POST', '/instructions')[0].body).toMatchObject({ text: 'Say I am at a wedding.', expires_at: expected });
  });

  test('days before today cannot be picked', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-delivery');
    await fireEvent.press(screen.getByRole('button', { name: 'New instruction' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Pick a date' }));
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    const today = new Date();
    if (today.getDate() > 1) {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const label = yesterday.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });
      expect(within(screen.getByTestId('rule-calendar')).getByRole('button', { name: label })).toBeDisabled();
    }
  });

  test('specific numbers can be picked from saved contacts', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-delivery');
    await fireEvent.press(screen.getByRole('button', { name: 'New instruction' }));
    await fireEvent.changeText(screen.getByLabelText('What should the assistant do?'), 'Put them straight through.');
    await fireEvent.press(screen.getByRole('button', { name: 'Specific numbers' }));
    const numbers = within(screen.getByTestId('rule-numbers'));
    await fireEvent.changeText(numbers.getByLabelText('Search your contacts'), 'pri');
    expect(numbers.queryByRole('checkbox', { name: /^Amma,/ })).toBeNull();
    await fireEvent.press(numbers.getByRole('checkbox', { name: /^Priya,/ }));
    await fireEvent.changeText(numbers.getByLabelText('Search your contacts'), '');
    await fireEvent.press(numbers.getByRole('checkbox', { name: /^Amma,/ }));
    expect(numbers.getByRole('button', { name: 'Remove Priya' })).toBeTruthy();
    expect(numbers.getByText('2 numbers. Separate them with commas.')).toBeTruthy();
    // Tapping a ticked contact again takes it off.
    await fireEvent.press(numbers.getByRole('button', { name: 'Remove Priya' }));
    expect(numbers.getByText('1 number. Separate them with commas.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add instruction' }));
    await waitFor(() => expect(requests('POST', '/instructions')).toHaveLength(1));
    expect(requests('POST', '/instructions')[0].body).toMatchObject({ applies_to: 'numbers', numbers: ['+919848012345'] });
  });

  test('editing a rule for a contact shows the contact, not the raw number', async () => {
    await renderScreen(<Instructions />);
    await fireEvent.press(within(await screen.findByTestId('instruction-ins-amma')).getAllByRole('button')[0]);
    const numbers = within(screen.getByTestId('rule-numbers'));
    expect(numbers.getByRole('button', { name: 'Remove Amma' })).toBeTruthy();
    expect(numbers.getByLabelText('Phone numbers').props.value).toBe('');
  });

  test("the preview shows what happens for each kind of caller", async () => {
    await renderScreen(<Instructions />);
    const preview = within(await screen.findByTestId('instruction-preview'));
    expect(preview.getByText('When a delivery partner calls, Ava will')).toBeTruthy();
    expect(preview.getByText(/leave the parcel with security at Gate 2/)).toBeTruthy();
    expect(preview.getByText('Gate 2 is open all night; Gate 1 closes at 10 PM.')).toBeTruthy();
    expect(preview.queryByText(/not interested in loans/)).toBeNull();
    await fireEvent.press(preview.getByRole('tab', { name: 'Unknown' }));
    expect(preview.getByText(/not interested in loans/)).toBeTruthy();
    expect(preview.queryByText(/leave the parcel/)).toBeNull();
    // Paused rules are left out; the privacy line is always there.
    expect(preview.queryByText(/back in the office on Monday/)).toBeNull();
    expect(preview.getByText(/Never shared with anyone: OTPs, PINs/)).toBeTruthy();
  });

  test('a new rule from an idea is previewed, then added with its audience and category', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-delivery');
    await fireEvent.press(screen.getByRole('button', { name: 'Ideas' }));
    const idea = server.state.templates.find((tpl) => tpl.applies_to === 'delivery')!;
    await fireEvent.press(await screen.findByRole('button', { name: `Use: ${idea.text}` }));
    expect(screen.getByRole('header', { name: 'New instruction' })).toBeTruthy();
    expect(screen.getByText(/^When a delivery partner calls, Ava follows/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add instruction' }));
    await waitFor(() => expect(requests('POST', '/instructions')).toHaveLength(1));
    expect(requests('POST', '/instructions')[0].body).toMatchObject({ text: idea.text, applies_to: 'delivery', category: idea.category, enabled: true });
    expect(await screen.findByText('Instruction added. It applies from the next call.')).toBeTruthy();
  });

  test('specific numbers need at least one number before saving', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-delivery');
    await fireEvent.press(screen.getByRole('button', { name: 'New instruction' }));
    await fireEvent.changeText(screen.getByLabelText('What should the assistant do?'), 'Put my brother straight through.');
    await fireEvent.press(screen.getByRole('button', { name: 'Specific numbers' }));
    expect(screen.getByRole('button', { name: 'Add instruction' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Phone numbers'), '+91 98665 54433');
    expect(screen.getByText('1 number. Separate them with commas.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add instruction' }));
    await waitFor(() => expect(requests('POST', '/instructions')).toHaveLength(1));
    expect(requests('POST', '/instructions')[0].body).toMatchObject({ applies_to: 'numbers', numbers: ['+919866554433'] });
  });

  test('delete offers Undo, which puts the rule back', async () => {
    await renderScreen(<Instructions />);
    await fireEvent.press(within(await screen.findByTestId('instruction-ins-privacy')).getByRole('button'));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(requests('DELETE', '/instructions/ins-privacy')).toHaveLength(1));
    expect(screen.queryByTestId('instruction-ins-privacy')).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(requests('POST', '/instructions')).toHaveLength(1));
    const list = within(await screen.findByTestId('instruction-list'));
    expect(await list.findByText("Never say when I'm travelling or that nobody is home.")).toBeTruthy();
  });

  test('a failed toggle goes back and says why', async () => {
    await renderScreen(<Instructions />);
    await screen.findByTestId('instruction-ins-trip');
    server.state.profile = { ...server.state.profile, instructions: server.state.profile.instructions.filter((i) => i.id !== 'ins-trip') };
    await act(async () => {
      fireEvent(screen.getByTestId('instruction-ins-trip-switch'), 'valueChange', true);
    });
    expect(await screen.findByText(/^Not changed\. Server said:/)).toBeTruthy();
    // The Android switch is "on" only when the rule is enabled.
    await waitFor(() => expect(screen.getByTestId('instruction-ins-trip-switch').props.on).toBe(false));
  });
});

describe('Notes', () => {
  test('lists notes with who may hear them and adds one for delivery partners', async () => {
    await renderScreen(<Notes />);
    expect(await screen.findByText('My office is at Cyber Towers, Hitech City, 3rd floor.')).toBeTruthy();
    expect(within(screen.getByTestId('note-note-office')).getByText('Saved contacts')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'New note' }));
    await fireEvent.changeText(screen.getByLabelText('What may it tell callers?'), 'Parcels go to the security cabin.');
    await fireEvent.press(screen.getByRole('button', { name: 'Delivery partners' }));
    expect(screen.getByText(/Ava may tell delivery partners when they ask: "Parcels go to the security cabin\."/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(requests('POST', '/knowledge')).toHaveLength(1));
    expect(requests('POST', '/knowledge')[0].body).toMatchObject({ text: 'Parcels go to the security cabin.', share_with: 'delivery', enabled: true });
  });
});
