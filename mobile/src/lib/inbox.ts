// Filters, search and day grouping for the Inbox. Messages are filtered by the
// call they came from (joined on call_id), so one set of chips works on both tabs.

import type { CallSummary, CallerMessage } from './types';

export type InboxFilter = 'all' | 'contacts' | 'unknown' | 'delivery' | 'spam' | 'blocked';

export const INBOX_FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'spam', label: 'Spam' },
  { value: 'blocked', label: 'Blocked' },
];

export function isInboxFilter(v: unknown): v is InboxFilter {
  return INBOX_FILTERS.some((f) => f.value === v);
}

/** Does this call belong under the chip? Blocked calls only show under Blocked and Spam. */
export function callMatches(filter: InboxFilter, c: CallSummary): boolean {
  const blocked = c.status === 'rejected';
  switch (filter) {
    case 'all':
      return true;
    case 'contacts':
      return !blocked && (c.category === 'contact' || (!!c.contact_name && c.direction === 'inbound' && !['spam', 'delivery'].includes(c.category)));
    case 'unknown':
      return !blocked && !c.contact_name && !['spam', 'delivery', 'contact'].includes(c.category);
    case 'delivery':
      return c.category === 'delivery';
    case 'spam':
      return c.category === 'spam';
    case 'blocked':
      return blocked;
  }
}

/** A message matches when its call does; without the call, only All and (by name) Unknown can tell. */
export function messageMatches(filter: InboxFilter, m: CallerMessage, call: CallSummary | undefined): boolean {
  if (filter === 'all') return true;
  if (call) return callMatches(filter, call);
  return filter === 'unknown' && !m.caller_name;
}

/** Case-insensitive search across fields; digits also match a number typed with spaces or +91. */
export function searchMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/[\s+()-]/g, '');
  const numeric = /^\d{3,}$/.test(digits);
  return fields.some((f) => {
    if (!f) return false;
    const v = f.toLowerCase();
    return v.includes(q) || (numeric && v.replace(/\D/g, '').includes(digits));
  });
}

export interface DayGroup<T> {
  key: string;
  title: string;
  items: T[];
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", a weekday this week, or a date; for section headers. */
export function dayTitle(ts: number, now: Date = new Date()): string {
  const days = Math.round((dayStart(now) - dayStart(new Date(ts * 1000))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(ts * 1000);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** Groups items (already newest first) into consecutive days. */
export function groupByDay<T>(items: T[], at: (item: T) => number, now: Date = new Date()): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const ts = at(item);
    const key = String(dayStart(new Date(ts * 1000)));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, title: dayTitle(ts, now), items: [item] });
  }
  return groups;
}
