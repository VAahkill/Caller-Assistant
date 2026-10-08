import { callMatches, dayTitle, groupByDay, INBOX_FILTERS, isInboxFilter, messageMatches, searchMatches, type InboxFilter } from '../inbox';
import { createFixtures } from '../mock/fixtures';

const now = new Date(2026, 9, 8, 18, 0, 0);
const fx = createFixtures(now.getTime() / 1000);
const ids = (f: InboxFilter) => fx.calls.filter((c) => callMatches(f, c)).map((c) => c.id);

describe('call filters', () => {
  test('All shows everything', () => {
    expect(ids('all')).toHaveLength(fx.calls.length);
  });

  test('Contacts: saved people, not businesses the assistant called, not spam', () => {
    expect(ids('contacts')).toEqual(['call-amma', 'call-priya']);
  });

  test('Unknown: numbers with no name that are not spam, deliveries or blocked', () => {
    expect(ids('unknown')).toEqual(['call-rajesh']);
  });

  test('Delivery, Spam and Blocked', () => {
    expect(ids('delivery')).toEqual(['call-live-swiggy', 'call-bluedart']);
    expect(ids('spam')).toEqual(['call-kyc', 'call-loan']);
    expect(ids('blocked')).toEqual(['call-loan']);
  });

  test('a blocked call is never under Contacts or Unknown', () => {
    const blocked = { ...fx.calls.find((c) => c.id === 'call-amma')!, status: 'rejected' as const };
    expect(callMatches('contacts', blocked)).toBe(false);
    expect(callMatches('unknown', { ...blocked, contact_name: '', category: 'unknown' })).toBe(false);
    expect(callMatches('blocked', blocked)).toBe(true);
  });
});

describe('message filters use the call the message was left on', () => {
  const byId = new Map(fx.calls.map((c) => [c.id, c]));
  const shown = (f: InboxFilter) => fx.messages.filter((m) => messageMatches(f, m, byId.get(m.call_id))).map((m) => m.id);

  test('by the call', () => {
    expect(shown('all')).toEqual(['msg-amma', 'msg-rajesh', 'msg-priya']);
    expect(shown('contacts')).toEqual(['msg-amma', 'msg-priya']);
    expect(shown('unknown')).toEqual(['msg-rajesh']);
    expect(shown('spam')).toEqual([]);
  });

  test('without its call, only All matches, and Unknown when the caller gave no name', () => {
    const m = fx.messages[0];
    expect(messageMatches('all', m, undefined)).toBe(true);
    expect(messageMatches('contacts', m, undefined)).toBe(false);
    expect(messageMatches('unknown', { ...m, caller_name: '' }, undefined)).toBe(true);
  });
});

describe('search', () => {
  test('matches any field, ignoring case', () => {
    expect(searchMatches('KITCHEN', 'Rajesh', 'Please call before 11 about the revised kitchen design.')).toBe(true);
    expect(searchMatches('pizza', 'Rajesh', 'kitchen')).toBe(false);
    expect(searchMatches('  ', 'anything')).toBe(true);
  });

  test('a number typed with spaces or +91 finds it', () => {
    expect(searchMatches('99123 45678', '+919912345678')).toBe(true);
    expect(searchMatches('+91 99123', '+919912345678')).toBe(true);
    expect(searchMatches('12', '+919912345678')).toBe(true); // plain substring
    expect(searchMatches('55555', '+919912345678')).toBe(false);
  });

  test('empty fields are skipped', () => {
    expect(searchMatches('amma', '', undefined, null, 'Amma')).toBe(true);
  });
});

describe('days', () => {
  const at = (d: Date) => d.getTime() / 1000;

  test('titles', () => {
    expect(dayTitle(at(new Date(2026, 9, 8, 9)), now)).toBe('Today');
    expect(dayTitle(at(new Date(2026, 9, 7, 23)), now)).toBe('Yesterday');
    expect(dayTitle(at(new Date(2026, 9, 5, 12)), now)).toBe(new Date(2026, 9, 5).toLocaleDateString(undefined, { weekday: 'long' }));
    expect(dayTitle(at(new Date(2026, 8, 1, 12)), now)).toBe(new Date(2026, 8, 1).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }));
    expect(dayTitle(at(new Date(2025, 8, 1, 12)), now)).toContain('2025');
  });

  test('groups consecutive items by day, keeping order', () => {
    const items = [new Date(2026, 9, 8, 17), new Date(2026, 9, 8, 8), new Date(2026, 9, 7, 20), new Date(2026, 9, 1, 9)].map(at);
    const groups = groupByDay(items, (x) => x, now);
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      [dayTitle(items[3], now), 1],
    ]);
  });
});

test('filter values from a link are checked', () => {
  expect(INBOX_FILTERS.map((f) => f.label)).toEqual(['All', 'Contacts', 'Unknown', 'Delivery', 'Spam', 'Blocked']);
  expect(isInboxFilter('spam')).toBe(true);
  expect(isInboxFilter('everything')).toBe(false);
  expect(isInboxFilter(undefined)).toBe(false);
});
