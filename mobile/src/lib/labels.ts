// Words and icons for server values, in one place so every screen says the
// same thing.

import type { IconName } from './design';
import { prettyNumber } from './format';
import { isPracticeNumber } from './practiceCalls';
import type { PillTone } from '../components/ui/StatusPill';
import type { AppliesTo, Away, CallRecord, CallSummary, ShareWith, Task } from './types';

export const CATEGORY: Record<string, { label: string; icon: IconName; tone: PillTone }> = {
  delivery: { label: 'Delivery', icon: 'bicycle-outline', tone: 'info' },
  contact: { label: 'Contact', icon: 'person-outline', tone: 'success' },
  business: { label: 'Business', icon: 'briefcase-outline', tone: 'primary' },
  spam: { label: 'Spam', icon: 'ban-outline', tone: 'danger' },
  unknown: { label: 'Unknown', icon: 'help-circle-outline', tone: 'neutral' },
};

export const categoryOf = (c: string) => CATEGORY[c] ?? { label: c.charAt(0).toUpperCase() + c.slice(1), icon: 'call-outline' as IconName, tone: 'neutral' as PillTone };

/** The caller's saved name, else their number spaced for reading. */
export function callerName(c: Pick<CallRecord, 'contact_name' | 'number'>): string {
  if (!c.contact_name && isPracticeNumber(c.number)) return 'Practice call';
  return c.contact_name || (c.number ? prettyNumber(c.number) : '') || 'Unknown caller';
}

/** One line for a call in a list. */
export function callLine(c: CallSummary): string {
  if (c.status === 'rejected') return c.reject_reason ? `Blocked: ${c.reject_reason}` : 'Blocked';
  return c.summary || c.message || categoryOf(c.category).label;
}

export const TASK_STATUS: Record<Task['status'], { label: string; tone: PillTone; icon: IconName }> = {
  queued: { label: 'Queued', tone: 'neutral', icon: 'time-outline' },
  dialing: { label: 'Dialling', tone: 'info', icon: 'call-outline' },
  in_call: { label: 'On the call', tone: 'primary', icon: 'radio-outline' },
  waiting_user: { label: 'Needs your decision', tone: 'warning', icon: 'hand-left-outline' },
  done: { label: 'Done', tone: 'success', icon: 'checkmark-circle-outline' },
  failed: { label: "Didn't work", tone: 'danger', icon: 'close-circle-outline' },
};

export const APPLIES_TO: Record<AppliesTo, string> = {
  everyone: 'Everyone',
  contacts: 'Saved contacts',
  unknown: 'Unknown numbers',
  delivery: 'Delivery partners',
  numbers: 'Specific numbers',
};

export const SHARE_WITH: Record<ShareWith, string> = {
  anyone: 'Anyone',
  contacts: 'Saved contacts',
  delivery: 'Delivery partners',
  numbers: 'Specific numbers',
};

export const INSTRUCTION_CATEGORY: Record<string, { label: string; icon: IconName }> = {
  general: { label: 'General', icon: 'list-outline' },
  delivery: { label: 'Deliveries', icon: 'bicycle-outline' },
  family: { label: 'Family and friends', icon: 'people-outline' },
  work: { label: 'Work', icon: 'briefcase-outline' },
  sales: { label: 'Sales and spam', icon: 'ban-outline' },
  privacy: { label: 'Privacy', icon: 'lock-closed-outline' },
  availability: { label: 'Availability', icon: 'calendar-outline' },
};

export const categoryLabel = (c: string) => INSTRUCTION_CATEGORY[c]?.label ?? c.charAt(0).toUpperCase() + c.slice(1);

/** The owner's name as typed, or '' for the server's stand-in ("the user")
 *  so a form starts empty instead of showing it as if it were a name. */
export const ownName = (n: string): string => (/^\s*the user\s*$/i.test(n) ? '' : n);

const isUpper = (s: string) => s !== s.toLowerCase() && s === s.toUpperCase();
const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Arjun is in a meeting until 3 PM." from an away message, as the server says
 * it (prompts.away_sentence): a leading "I'm" or "Arjun is" goes, and the first
 * letter is lowered unless it starts an acronym.
 */
export function awaySentence(userName: string, message: string): string {
  let msg = message.trim().replace(/[.!]+$/, '');
  if (!msg) return '';
  const user = userName.trim();
  const low = msg.toLowerCase();
  const lead = ["i'm ", 'i am ', 'im '].find((x) => low.startsWith(x));
  if (lead) msg = msg.slice(lead.length);
  else if (user && low.startsWith(`${user.toLowerCase()} is `)) msg = msg.slice(user.length + 4);
  if (isUpper(msg.charAt(0)) && !isUpper(msg.slice(0, 2))) msg = msg.charAt(0).toLowerCase() + msg.slice(1);
  return `${capitalised(user || 'the owner')} is ${msg}.`;
}

/** The line callers hear first, in English (matches the server's opening_line):
 *  while an away status is on, it takes the place of "can't take the call". */
export function greetingLine(userName: string, assistantName: string, away?: Pick<Away, 'message'> | null): string {
  const user = userName.trim() || 'the owner';
  const assistant = assistantName.trim() || 'the assistant';
  const middle = (away && awaySentence(userName, away.message)) || `${capitalised(user)} can't take the call right now.`;
  return `Hi, this is ${assistant}, ${user}'s assistant. ${middle} How can I help?`;
}

const ENGINE: Record<string, string> = { kokoro: 'Kokoro', piper: 'Piper', mms: 'MMS', xtts: 'XTTS', espeak: 'eSpeak' };

/** A speech engine's proper name, e.g. "kokoro" -> "Kokoro". */
export const engineName = (e: string) => ENGINE[e.toLowerCase()] ?? e.charAt(0).toUpperCase() + e.slice(1);
