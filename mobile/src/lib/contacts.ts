import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';

import { api } from './api';
import { storage } from './storage';

export interface PhoneContact {
  number: string;
  name: string;
}

export interface LastSync {
  at: number;
  count: number;
}

export type SyncResult =
  | { ok: true; count: number; at: number }
  | { ok: false; denied: true; canAskAgain: boolean; message: string };

const LAST_SYNC_KEY = 'contacts_sync';

/** "+91 98480-12345" -> "+919848012345"; keeps a leading + and the digits. */
export function cleanNumber(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return trimmed.startsWith('+') ? `+${digits}` : trimmed.startsWith('00') ? `+${digits.slice(2)}` : digits;
}

/** Names and numbers only, one entry per number. */
export function flattenContacts(list: { fullName?: string | null; phones?: { number?: string | null }[] | null }[]): PhoneContact[] {
  const seen = new Map<string, PhoneContact>();
  for (const c of list) {
    for (const p of c.phones ?? []) {
      const number = cleanNumber(p.number ?? '');
      if (number.replace('+', '').length < 5 || seen.has(number)) continue;
      seen.set(number, { number, name: (c.fullName ?? '').trim() });
    }
  }
  return [...seen.values()];
}

/**
 * Sends the phone's contacts (names and numbers only) to the server so saved
 * contacts always get through. A refused permission comes back as a result
 * the screen explains, with a link to Settings when Android won't ask again.
 */
export async function syncContacts(): Promise<SyncResult> {
  const perm = await requestPermissionsAsync();
  if (!perm.granted) {
    return {
      ok: false,
      denied: true,
      canAskAgain: perm.canAskAgain,
      message: perm.canAskAgain
        ? 'OpenCall needs contacts access to let your saved contacts through.'
        : 'Contacts access is off for OpenCall. Turn it on in Settings, then sync again.',
    };
  }
  const details = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES]);
  const list = flattenContacts(details);
  const { count } = await api.putContacts(list);
  const at = Date.now() / 1000;
  await storage.set(LAST_SYNC_KEY, JSON.stringify({ at, count } satisfies LastSync));
  return { ok: true, count, at };
}

export async function lastSync(): Promise<LastSync | null> {
  const raw = await storage.get(LAST_SYNC_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LastSync;
    return typeof v.at === 'number' && typeof v.count === 'number' ? v : null;
  } catch (e) {
    console.warn('Forgot an unreadable contacts sync record', e);
    return null;
  }
}
