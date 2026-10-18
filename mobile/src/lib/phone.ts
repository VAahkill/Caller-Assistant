// Phone numbers the way the server reads them (backend screening.normalize_number),
// so the app matches contacts, VIPs and blocks to the same numbers the server does.

import { cleanNumber, prettyNumber } from './format';

/**
 * "98480 12345" -> "+919848012345" with home code "+91". A leading + or 00 is
 * kept as an international number; a trunk 0 ("040 2345 6789") is dropped.
 * Empty when there are no digits.
 */
export function normalizeNumber(raw: string, homeCc = '+91'): string {
  const trimmed = (raw ?? '').trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  const cc = homeCc.replace(/^\+/, '');
  digits = digits.replace(/^0+/, '');
  if (digits.length > 10 && digits.startsWith(cc)) return `+${digits}`;
  return `+${cc}${digits}`;
}

/** Same person's number, however it was written. */
export const sameNumber = (a: string, b: string, homeCc = '+91'): boolean => {
  const x = normalizeNumber(a, homeCc);
  return !!x && x === normalizeNumber(b, homeCc);
};

export interface NamedNumber {
  number: string;
  name: string;
}

/** The saved contact's name for a number, if any. */
export function contactName(contacts: NamedNumber[], number: string, homeCc = '+91'): string | undefined {
  const n = normalizeNumber(number, homeCc);
  if (!n) return undefined;
  return contacts.find((c) => c.name && normalizeNumber(c.number, homeCc) === n)?.name;
}

/** At least 5 digits: shorter is a service code (121, 1909), not a person. */
export const isDialable = (raw: string): boolean => cleanNumber(raw).replace(/\D/g, '').length >= 5;

/** Contacts whose name or number matches what was typed, names first A to Z. */
export function searchContacts<T extends NamedNumber>(contacts: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const sorted = [...contacts].sort((a, b) => (a.name || '~').localeCompare(b.name || '~') || a.number.localeCompare(b.number));
  if (!q) return sorted;
  return sorted.filter(
    (c) => c.name.toLowerCase().includes(q) || (digits.length >= 2 && c.number.replace(/\D/g, '').includes(digits)),
  );
}

/** "Amma" or "+91 98480 12345". */
export const displayNumber = (contacts: NamedNumber[], number: string, homeCc = '+91'): string =>
  contactName(contacts, number, homeCc) ?? prettyNumber(normalizeNumber(number, homeCc) || number);

/** "Amma", "Amma, Priya", "Amma, Priya +2": who a specific-numbers rule is for. */
export function numbersLabel(numbers: string[], contacts: NamedNumber[], homeCc = '+91', empty = 'Specific numbers'): string {
  if (!numbers.length) return empty;
  const names = numbers.map((n) => displayNumber(contacts, n, homeCc));
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

/** A blocked-number prefix in the form the server compares against
 *  ("+91140"): the server checks it against numbers in full international
 *  form, so "140" or "0140" means the home country's 140 series. */
export function normalizePrefix(raw: string, homeCc = '+91'): string {
  const text = raw.trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (text.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  return `${homeCc}${digits.replace(/^0+/, '')}`;
}
