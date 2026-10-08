// Helpers shared by Instructions and "What callers may know": expiry presets,
// the numbers list, and the plain-English preview of what a rule does.

import { cleanNumber } from './format';
import type { AppliesTo, ShareWith } from './types';

export type ExpiryPreset = 'never' | 'today' | 'week' | 'custom';

export const EXPIRY_LABEL: Record<Exclude<ExpiryPreset, 'custom'>, string> = {
  never: 'Never',
  today: 'End of today',
  week: 'In a week',
};

const DAY = 24 * 60 * 60;

/** Epoch seconds for a preset, counted from `now` (ms). */
export function expiryFor(preset: Exclude<ExpiryPreset, 'custom'>, now: number = Date.now()): number | null {
  if (preset === 'never') return null;
  if (preset === 'week') return Math.floor(now / 1000) + 7 * DAY;
  const end = new Date(now);
  end.setHours(23, 59, 0, 0);
  return Math.floor(end.getTime() / 1000);
}

/** Which preset chip a stored expiry matches (within a minute), else custom. */
export function presetOf(expiresAt: number | null, now: number = Date.now()): ExpiryPreset {
  if (expiresAt == null) return 'never';
  if (Math.abs(expiresAt - (expiryFor('today', now) ?? 0)) < 60) return 'today';
  if (Math.abs(expiresAt - (expiryFor('week', now) ?? 0)) < 60) return 'week';
  return 'custom';
}

export const isExpired = (expiresAt: number | null, now: number = Date.now()): boolean =>
  expiresAt != null && expiresAt * 1000 <= now;

/** "Ends today, 11:59 pm", "Ends tomorrow", "Ends 15 Oct", or "Ended". */
export function expiryText(expiresAt: number | null, now: number = Date.now()): string | null {
  if (expiresAt == null) return null;
  if (isExpired(expiresAt, now)) return 'Ended';
  const at = new Date(expiresAt * 1000);
  const today = new Date(now);
  const dayDiff = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      (DAY * 1000),
  );
  if (dayDiff === 0) return `Ends today, ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  if (dayDiff === 1) return 'Ends tomorrow';
  return `Ends ${at.getDate()} ${at.toLocaleString('en', { month: 'short' })}`;
}

/** Numbers typed or pasted as a list (commas, spaces or new lines), cleaned and de-duplicated. */
export function parseNumbers(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const n = cleanNumber(part);
    if (n.replace(/\D/g, '').length >= 5 && !out.includes(n)) out.push(n);
  }
  return out;
}

const WHO: Record<AppliesTo, string> = {
  everyone: 'anyone calls',
  contacts: 'one of your saved contacts calls',
  unknown: 'an unknown number calls',
  delivery: 'a delivery partner calls',
  numbers: 'one of the chosen numbers calls',
};

const SHARE: Record<ShareWith, string> = {
  anyone: 'any caller who asks',
  contacts: 'your saved contacts when they ask',
  delivery: 'delivery partners when they ask',
  numbers: 'the chosen numbers when they ask',
};

const quote = (text: string) => `"${text.trim().replace(/[.\s]+$/, '')}."`;

/** What the assistant will do, in one sentence, for the editor preview. */
export function instructionPreview(text: string, appliesTo: AppliesTo, assistant: string, expiresAt: number | null, now = Date.now()): string {
  if (!text.trim()) return `Write what ${assistant} should do, and when.`;
  const until = expiryText(expiresAt, now);
  return `When ${WHO[appliesTo]}, ${assistant} follows: ${quote(text)}${until ? ` ${until}.` : ''}`;
}

export function notePreview(text: string, shareWith: ShareWith, assistant: string, expiresAt: number | null, now = Date.now()): string {
  if (!text.trim()) return `Write a fact ${assistant} may tell callers.`;
  const until = expiryText(expiresAt, now);
  return `${assistant} may tell ${SHARE[shareWith]}: ${quote(text)} Anything else, it checks with you first.${until ? ` ${until}.` : ''}`;
}
