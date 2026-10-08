// Instructions and "What callers may know" against the in-memory v2 server.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import Instructions from '../../app/instructions';
import Notes from '../../app/notes';
import type { MockServer } from '../../lib/mock/server';
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
    await screen.findByText(/leave the parcel with security at Gate 2/);
    expect(screen.getByText('4 in use')).toBeTruthy();
    const amma = within(screen.getByTestId('instruction-ins-amma'));
    expect(amma.getByText('Specific numbers (1)')).toBeTruthy();
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
    expect(screen.getByText('5 in use')).toBeTruthy();
  });

  test('a new rule from an idea is previewed, then added with its audience and category', async () => {
    await renderScreen(<Instructions />);
    await screen.findByText(/leave the parcel/);
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
    await screen.findByText(/leave the parcel/);
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
    expect(await screen.findByText("Never say when I'm travelling or that nobody is home.")).toBeTruthy();
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
