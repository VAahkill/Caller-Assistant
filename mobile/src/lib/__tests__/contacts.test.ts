const mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
const mockGetAllDetails = jest.fn();

jest.mock('expo-contacts', () => ({
  ContactField: { FULL_NAME: 'fullName', PHONES: 'phones' },
  requestPermissionsAsync: jest.fn(async () => mockPermission),
  Contact: { getAllDetails: (...args: unknown[]) => mockGetAllDetails(...args) },
}));

import { cleanNumber, flattenContacts, lastSync, syncContacts } from '../contacts';
import { resetApi, useMockServer } from '../../test/mockApi';

afterEach(resetApi);

test.each([
  ['+91 98480-12345', '+919848012345'],
  ['(040) 2345 6789', '04023456789'],
  ['0091 98480 12345', '+919848012345'],
  ['  ', ''],
])('cleanNumber(%p) = %p', (raw, clean) => expect(cleanNumber(raw)).toBe(clean));

test('flattenContacts keeps one entry per number, in the server form, and skips short codes', () => {
  expect(
    flattenContacts([
      { fullName: 'Amma', phones: [{ number: '+91 98480 12345' }, { number: '098480 12345' }] },
      { fullName: ' Priya ', phones: [{ number: '98665 54433' }] },
      { fullName: 'Bank SMS', phones: [{ number: '121' }] },
      { fullName: 'Office', phones: [{ number: '(040) 2345 6789' }] },
      { fullName: null, phones: null },
    ]),
  ).toEqual([
    { number: '+919848012345', name: 'Amma' },
    { number: '+919866554433', name: 'Priya' },
    { number: '+914023456789', name: 'Office' },
  ]);
});

test('flattenContacts uses the home country code and prefers the copy with a name', () => {
  expect(
    flattenContacts(
      [
        { fullName: '', phones: [{ number: '(415) 555-0134' }] },
        { fullName: 'Sam', phones: [{ number: '+1 415 555 0134' }] },
      ],
      '+1',
    ),
  ).toEqual([{ number: '+14155550134', name: 'Sam' }]);
});

test('sync reads names and phones only, uploads them and remembers when', async () => {
  const server = await useMockServer();
  mockGetAllDetails.mockResolvedValueOnce([
    { fullName: 'Amma', phones: [{ number: '+91 98480 12345' }] },
    { fullName: 'Kiran', phones: [{ number: '+91 91770 01122' }] },
  ]);
  const r = await syncContacts('+91');
  expect(mockGetAllDetails).toHaveBeenCalledWith(['fullName', 'phones']);
  expect(r).toEqual({ ok: true, count: 2, at: expect.any(Number) });
  expect(server.log.at(-1)).toMatchObject({ method: 'PUT', path: '/contacts' });
  expect(server.log.at(-1)?.body).toEqual([
    { number: '+919848012345', name: 'Amma' },
    { number: '+919177001122', name: 'Kiran' },
  ]);
  expect(await lastSync()).toEqual({ at: r.ok ? r.at : 0, count: 2 });
});

test('a refusal is explained, with a different message when Android will not ask again', async () => {
  await useMockServer();
  Object.assign(mockPermission, { granted: false, canAskAgain: true, status: 'denied' });
  expect(await syncContacts()).toMatchObject({ ok: false, canAskAgain: true, message: expect.stringContaining('needs contacts access') });
  Object.assign(mockPermission, { canAskAgain: false });
  expect(await syncContacts()).toMatchObject({ ok: false, canAskAgain: false, message: expect.stringContaining('Turn it on in Settings') });
  Object.assign(mockPermission, { granted: true, canAskAgain: true, status: 'granted' });
});

test('without a country code, sync asks the server which country the owner is in', async () => {
  const server = await useMockServer();
  server.state.profile = { ...server.state.profile, home_country_code: '+44' };
  mockGetAllDetails.mockResolvedValueOnce([{ fullName: 'Jo', phones: [{ number: '07700 900123' }] }]);
  await syncContacts();
  expect(server.log.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /profile', 'PUT /contacts']);
  expect(server.log.at(-1)?.body).toEqual([{ number: '+447700900123', name: 'Jo' }]);
});

test('a failure reading the phone contacts is not reported as a sync', async () => {
  await useMockServer();
  const before = await lastSync();
  mockGetAllDetails.mockRejectedValueOnce(new Error('Contacts provider crashed'));
  await expect(syncContacts('+91')).rejects.toThrow('Contacts provider crashed');
  expect(await lastSync()).toEqual(before);
});
