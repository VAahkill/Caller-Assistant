// What the server can do yet, from GET /health: whether it is still the first
// version (its health has no "version"), and its phone line. Android doesn't
// let apps answer or speak on phone calls, so real calls reach the assistant
// only through the server's own line (docs/TELEPHONY.md).

import { dialerName } from './format';
import type { Health, PhoneLine } from './types';

const DOCS = 'https://github.com/VAahkill/Caller-Assistant/blob/claude/ai-reception-assistant-n4ffi3/docs';
/** The setup guide's steps for a server still on the first version. */
export const UPDATE_GUIDE_URL = `${DOCS}/TRY_IT.md#updating-from-the-first-version`;
/** How to give the server a phone line: Bluetooth from a Linux computer, or a USB SIM modem. */
export const PHONE_LINE_GUIDE_URL = `${DOCS}/TELEPHONY.md`;

/** The first version of the server answers /health without a version. */
export const serverOutdated = (h: Health | null | undefined): boolean => !!h && h.ok && !h.version;

export const SERVER_OUTDATED_TITLE = 'Your server needs updating';
export const SERVER_OUTDATED =
  'Your server is still the first version, so voice demos, Call for me and other new parts won\'t work properly. Update it with the steps under "Updating from the first version" in the setup guide.';

/** Real calls can't reach the assistant: the server says it has no line for them.
 *  Servers too old to say are not flagged; the app can't tell. */
export const noLineForCalls = (h: Health | null | undefined): boolean => !!h?.phone_line && !h.phone_line.inbound;

/** Call for me can place a real call. Until health is in, assume it can;
 *  servers that don't report their line go by the dialer. */
export function canCallOut(h: Health | null | undefined): boolean {
  if (!h) return true;
  return h.phone_line ? h.phone_line.outbound : h.dialer !== 'none';
}

/** Why the app can't answer calls itself, in one sentence. */
export const whyPhoneLine = (assistant: string) =>
  `Android doesn't let apps answer or speak on phone calls, so calls reach ${assistant} through your server's phone line.`;

/** What the server said about its line, or a plain stand-in when it said nothing. */
export function phoneLineDetail(h: Health | null | undefined): string {
  return h?.phone_line?.detail || (h && !canCallOut(h) ? "Your server can't place calls yet." : 'Your server has no phone line connected yet.');
}

const LINE_NAMES: Record<PhoneLine['kind'], string> = {
  bluetooth: 'Bluetooth phone',
  gsm: 'USB SIM modem',
  twilio: 'Twilio',
  none: 'None yet',
};

/** The "Phone line" fact: which line and whether it works now. Servers that
 *  don't report one show how they place calls instead. */
export function phoneLineText(h: Health): string {
  const line = h.phone_line;
  if (!line) return h.dialer === 'none' ? 'Not set up' : dialerName(h.dialer);
  if (line.kind === 'none') return 'Not connected yet';
  return `${LINE_NAMES[line.kind]} · ${line.ok ? 'connected' : 'not connected'}`;
}
