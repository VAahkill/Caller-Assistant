import {
  endsSoon,
  filterRules,
  notesForCaller,
  ruleCounts,
  rulesForCaller,
  ruleState,
  sortRules,
} from '../rules';
import type { Instruction, KnowledgeNote } from '../types';

// 8 Oct 2026, 14:10 local time.
const NOW = new Date(2026, 9, 8, 14, 10, 0).getTime();
const S = NOW / 1000;
const HOUR = 3600;

const rule = (id: string, over: Partial<Instruction> = {}): Instruction => ({
  id,
  text: id,
  enabled: true,
  applies_to: 'everyone',
  numbers: [],
  category: 'general',
  expires_at: null,
  created_at: S - HOUR,
  updated_at: S - HOUR,
  ...over,
});

const note = (id: string, over: Partial<KnowledgeNote> = {}): KnowledgeNote => ({
  id,
  text: id,
  enabled: true,
  share_with: 'contacts',
  numbers: [],
  expires_at: null,
  created_at: S - HOUR,
  updated_at: S - HOUR,
  ...over,
});

const list = [
  rule('old-on', { created_at: S - 10 * HOUR }),
  rule('new-on', { created_at: S - HOUR }),
  rule('off', { enabled: false }),
  rule('ended', { expires_at: S - 60 }),
  // An ended rule that is also switched off counts as ended.
  rule('ended-off', { enabled: false, expires_at: S - 60, created_at: S - 2 * HOUR }),
];

test('a rule is in use, off, or ended once its end date passes', () => {
  expect(ruleState({ enabled: true, expires_at: null }, NOW)).toBe('active');
  expect(ruleState({ enabled: false, expires_at: S + HOUR }, NOW)).toBe('paused');
  expect(ruleState({ enabled: true, expires_at: S }, NOW)).toBe('ended');
});

test('rules sort in use, off, ended, newest first in each', () => {
  expect(sortRules(list, NOW).map((r) => r.id)).toEqual(['new-on', 'old-on', 'off', 'ended', 'ended-off']);
});

test('filters and their counts agree', () => {
  expect(ruleCounts(list, NOW)).toEqual({ all: 5, active: 2, paused: 1, ended: 2 });
  expect(filterRules(list, 'active', NOW).map((r) => r.id)).toEqual(['new-on', 'old-on']);
  expect(filterRules(list, 'paused', NOW).map((r) => r.id)).toEqual(['off']);
  expect(filterRules(list, 'ended', NOW).map((r) => r.id)).toEqual(['ended', 'ended-off']);
  expect(filterRules(list, 'all', NOW)).toHaveLength(5);
  expect(filterRules([], 'active', NOW)).toEqual([]);
});

test('endsSoon is true only for a rule still in use that ends within a day', () => {
  expect(endsSoon(S + 2 * HOUR, NOW)).toBe(true);
  expect(endsSoon(S + 30 * HOUR, NOW)).toBe(false);
  expect(endsSoon(S - 1, NOW)).toBe(false);
  expect(endsSoon(null, NOW)).toBe(false);
});

describe("who's calling preview", () => {
  const rules = [
    rule('all'),
    rule('contacts', { applies_to: 'contacts' }),
    rule('unknown', { applies_to: 'unknown' }),
    rule('delivery', { applies_to: 'delivery' }),
    rule('amma', { applies_to: 'numbers', numbers: ['+919848012345'] }),
    rule('paused-delivery', { applies_to: 'delivery', enabled: false }),
    rule('ended-all', { expires_at: S - 1 }),
  ];
  test.each([
    ['contact', ['all', 'contacts']],
    ['unknown', ['all', 'unknown']],
    ['delivery', ['all', 'delivery']],
  ] as const)('a %s caller gets %p', (kind, ids) => {
    expect(rulesForCaller(rules, kind, NOW).map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  test('notes reach only the callers they are shared with', () => {
    const notes = [
      note('anyone', { share_with: 'anyone' }),
      note('contacts'),
      note('delivery', { share_with: 'delivery' }),
      note('numbers', { share_with: 'numbers', numbers: ['+919848012345'] }),
      note('off', { share_with: 'anyone', enabled: false }),
    ];
    expect(notesForCaller(notes, 'contact', NOW).map((n) => n.id).sort()).toEqual(['anyone', 'contacts']);
    expect(notesForCaller(notes, 'unknown', NOW).map((n) => n.id)).toEqual(['anyone']);
    expect(notesForCaller(notes, 'delivery', NOW).map((n) => n.id).sort()).toEqual(['anyone', 'delivery']);
  });
});
