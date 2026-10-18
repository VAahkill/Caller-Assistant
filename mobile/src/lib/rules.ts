// Helpers shared by Instructions and "What callers may know": expiry presets,
// the numbers list, filters, and plain-English previews of what a rule does.

import { isDialable, normalizeNumber } from './phone';
import type { AppliesTo, Instruction, KnowledgeNote, ShareWith } from './types';

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

/** "6 PM", "9:30 AM". */
export function shortClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Ends today, 6 PM", "Ends tomorrow", "Ends 15 Oct, 9 AM", or "Ended". The time
 *  is left out for a later day when it ends with that day (11:59 PM). */
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
  const endOfDay = at.getHours() === 23 && at.getMinutes() === 59;
  if (dayDiff === 0) return `Ends today, ${shortClock(at)}`;
  const day = dayDiff === 1 ? 'tomorrow' : `${at.getDate()} ${at.toLocaleString('en', { month: 'short' })}`;
  return endOfDay ? `Ends ${day}` : `Ends ${day}, ${shortClock(at)}`;
}

/** Numbers typed or pasted as a list (commas, semicolons or new lines), in the
 *  server's form and de-duplicated. */
export function parseNumbers(text: string, homeCc = '+91'): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    if (!isDialable(part)) continue;
    const n = normalizeNumber(part, homeCc);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** In use, switched off, or past its end date. */
export type RuleState = 'active' | 'paused' | 'ended';

export function ruleState(r: { enabled: boolean; expires_at: number | null }, now: number = Date.now()): RuleState {
  if (isExpired(r.expires_at, now)) return 'ended';
  return r.enabled ? 'active' : 'paused';
}

export type RuleFilter = 'all' | RuleState;

export const RULE_FILTERS: { value: RuleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'In use' },
  { value: 'paused', label: 'Off' },
  { value: 'ended', label: 'Ended' },
];

type Rule = { enabled: boolean; expires_at: number | null; created_at: number };

/** In use first, then off, then ended; newest first within each. */
export function sortRules<T extends Rule>(list: T[], now: number = Date.now()): T[] {
  const rank: Record<RuleState, number> = { active: 0, paused: 1, ended: 2 };
  return [...list].sort((a, b) => rank[ruleState(a, now)] - rank[ruleState(b, now)] || b.created_at - a.created_at);
}

export function filterRules<T extends Rule>(list: T[], filter: RuleFilter, now: number = Date.now()): T[] {
  const sorted = sortRules(list, now);
  return filter === 'all' ? sorted : sorted.filter((r) => ruleState(r, now) === filter);
}

export function ruleCounts(list: Rule[], now: number = Date.now()): Record<RuleFilter, number> {
  const counts: Record<RuleFilter, number> = { all: list.length, active: 0, paused: 0, ended: 0 };
  for (const r of list) counts[ruleState(r, now)]++;
  return counts;
}

/** Ends within the next day: worth a nudge. */
export const endsSoon = (expiresAt: number | null, now: number = Date.now()): boolean =>
  expiresAt != null && !isExpired(expiresAt, now) && expiresAt * 1000 - now < DAY * 1000;

/** Kinds of caller for the "who's calling?" preview. */
export type CallerKind = 'contact' | 'unknown' | 'delivery';

export const CALLER_KINDS: { value: CallerKind; label: string }[] = [
  { value: 'contact', label: 'A saved contact' },
  { value: 'unknown', label: 'An unknown number' },
  { value: 'delivery', label: 'A delivery partner' },
];

// A delivery partner is recognised by what they say and gets the delivery rules,
// not the unknown-number ones (which are mostly about sales calls).
const APPLIES: Record<CallerKind, AppliesTo[]> = {
  contact: ['everyone', 'contacts'],
  unknown: ['everyone', 'unknown'],
  delivery: ['everyone', 'delivery'],
};

const SHARES: Record<CallerKind, ShareWith[]> = {
  contact: ['anyone', 'contacts'],
  unknown: ['anyone'],
  delivery: ['anyone', 'delivery'],
};

/** Instructions in use for this kind of caller (rules for specific numbers are left out). */
export function rulesForCaller(list: Instruction[], kind: CallerKind, now: number = Date.now()): Instruction[] {
  return sortRules(list, now).filter((i) => ruleState(i, now) === 'active' && APPLIES[kind].includes(i.applies_to));
}

/** Notes in use that this kind of caller may hear. */
export function notesForCaller(list: KnowledgeNote[], kind: CallerKind, now: number = Date.now()): KnowledgeNote[] {
  return sortRules(list, now).filter((n) => ruleState(n, now) === 'active' && SHARES[kind].includes(n.share_with));
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
