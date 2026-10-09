import { contactName, displayNumber, isDialable, normalizeNumber, numbersLabel, sameNumber, searchContacts } from '../phone';

// The same cases backend/opencall/screening.normalize_number gives.
test.each([
  ['+91 98480-12345', '+91', '+919848012345'],
  ['98480 12345', '+91', '+919848012345'],
  ['098480 12345', '+91', '+919848012345'],
  ['919848012345', '+91', '+919848012345'],
  ['0091 98480 12345', '+91', '+919848012345'],
  ['(040) 2345 6789', '+91', '+914023456789'],
  ['07700 900123', '+44', '+447700900123'],
  ['+1 (415) 555-0134', '+91', '+14155550134'],
  ['  ', '+91', ''],
  ['', '+91', ''],
])('normalizeNumber(%p, %p) = %p', (raw, cc, out) => expect(normalizeNumber(raw, cc)).toBe(out));

test('sameNumber matches however the number was written', () => {
  expect(sameNumber('098480 12345', '+91 98480 12345')).toBe(true);
  expect(sameNumber('98480 12345', '98480 12346')).toBe(false);
  expect(sameNumber('', '')).toBe(false);
});

test('contactName and displayNumber find saved names across formats', () => {
  const contacts = [
    { number: '+919848012345', name: 'Amma' },
    { number: '9866554433', name: 'Priya' },
    { number: '+919000000000', name: '' },
  ];
  expect(contactName(contacts, '98480 12345')).toBe('Amma');
  expect(contactName(contacts, '+919866554433')).toBe('Priya');
  expect(contactName(contacts, '+919000000000')).toBeUndefined();
  expect(displayNumber(contacts, '+919866554433')).toBe('Priya');
  expect(displayNumber(contacts, '9177001122')).toBe('+91 91770 01122');
});

test('numbersLabel names up to two people and counts the rest', () => {
  const contacts = [
    { number: '+919848012345', name: 'Amma' },
    { number: '+919866554433', name: 'Priya' },
  ];
  expect(numbersLabel([], contacts)).toBe('Specific numbers');
  expect(numbersLabel(['+919848012345'], contacts)).toBe('Amma');
  expect(numbersLabel(['+919848012345', '9177001122'], contacts)).toBe('Amma, +91 91770 01122');
  expect(numbersLabel(['+919848012345', '+919866554433', '+919177001122', '+919000000001'], contacts)).toBe('Amma, Priya +2');
});

test('isDialable leaves out service codes', () => {
  expect(isDialable('121')).toBe(false);
  expect(isDialable('1909')).toBe(false);
  expect(isDialable('98480')).toBe(true);
});

test('searchContacts matches names or digits, names A to Z', () => {
  const contacts = [
    { number: '+919866554433', name: 'Priya' },
    { number: '+919848012345', name: 'Amma' },
    { number: '+919177001122', name: 'Kiran (office)' },
  ];
  expect(searchContacts(contacts, '').map((c) => c.name)).toEqual(['Amma', 'Kiran (office)', 'Priya']);
  expect(searchContacts(contacts, 'off').map((c) => c.name)).toEqual(['Kiran (office)']);
  expect(searchContacts(contacts, '9866 5').map((c) => c.name)).toEqual(['Priya']);
  expect(searchContacts(contacts, '9')).toEqual([]);
});
