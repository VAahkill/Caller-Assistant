import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';

import { api } from './api';
import { cleanNumber } from './format';
import { isDialable, normalizeNumber } from './phone';
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

export { cleanNumber };

const LAST_SYNC_KEY = 'contacts_sync';

/** Names and numbers only, one entry per number, in the server's form
 *  ("+919848012345"), so "098480 12345" and "+91 98480 12345" are one contact. */
export function flattenContacts(
  list: { fullName?: string | null; phones?: { number?: string | null }[] | null }[],
  homeCc = '+91',
): PhoneContact[] {
  const seen = new Map<string, PhoneContact>();
  for (const c of list) {
    for (const p of c.phones ?? []) {
      const raw = p.number ?? '';
      if (!isDialable(raw)) continue;
      const number = normalizeNumber(raw, homeCc);
      const name = (c.fullName ?? '').trim();
      const before = seen.get(number);
      // The same number saved twice: keep the entry that has a name.
      if (!before || (!before.name && name)) seen.set(number, { number, name });
    }
  }
  return [...seen.values()];
}

/**
 * Sends the phone's contacts (names and numbers only) to the server so saved
 * contacts always get through. A refused permission comes back as a result
 * the screen explains, with a link to Settings when Android won't ask again.
 */
export async function syncContacts(homeCc?: string): Promise<SyncResult> {
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
  // The new contacts API: SDK 57's old getContactsAsync always throws.
  const details = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES]);
  const cc = homeCc ?? (await api.profile()).home_country_code;
  const list = flattenContacts(details, cc);
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
