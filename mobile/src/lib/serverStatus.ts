// What the server can do yet, from GET /health: whether it is still the first
// version (its health has no "version"), and its phone line. Android doesn't
// let apps answer or speak on phone calls, so real calls reach the assistant
// only through the server's own line (docs/TELEPHONY.md).

import type { Health, PhoneLine } from './types';

const DOCS = 'https://github.com/VAahkill/Caller-Assistant/blob/claude/ai-reception-assistant-n4ffi3/docs';
/** The setup guide's steps for a server still on the first version. */
export const UPDATE_GUIDE_URL = `${DOCS}/TRY_IT.md#updating-from-the-first-version`;
/** How to give the server a phone line: Bluetooth from a Linux computer, or a USB SIM modem. */
export const PHONE_LINE_GUIDE_URL = `${DOCS}/TELEPHONY.md`;

/** The first version of the server answers /health without a version. */
export const firstVersion = (h: Health | null | undefined): boolean => !!h && h.ok && !h.version;

/** Older than 2.1: it doesn't report its phone line (the first version and 2.0), so
 *  the app can't tell whether real calls reach the assistant, and there is no
 *  practice Call for me. */
export const serverOutdated = (h: Health | null | undefined): boolean => !!h && h.ok && !h.phone_line;

export const SERVER_OUTDATED_TITLE = 'Your server needs updating';

/** What an older server can't do, and where the update steps are. */
export function serverOutdatedText(h: Health | null | undefined): string {
  const steps = 'Update it with the steps under "Updating from the first version" in the setup guide.';
  return firstVersion(h)
    ? `Your server is still the first version, so voice demos, practising Call for me and checking whether real calls can reach your assistant won't work. ${steps}`
    : `Your server is an older version, so practising Call for me and checking whether real calls can reach your assistant won't work. ${steps}`;
}

/** Real calls can't reach the assistant: the server says it has no line for them.
 *  Servers too old to say are not flagged here (see lineUnknown). */
export const noLineForCalls = (h: Health | null | undefined): boolean => !!h?.phone_line && !h.phone_line.inbound;

/** The server answered but is too old to say whether it has a phone line. */
export const lineUnknown = serverOutdated;

/** Practice Call for me needs a server that knows it (2.1, which reports its line). */
export const canPractiseCalls = (h: Health | null | undefined): boolean => !!h?.phone_line;

/** What turning the assistant on means now, for the toast. */
export function assistantOnText(assistant: string, h: Health | null | undefined): string {
  if (noLineForCalls(h)) return `${assistant} is on. Real calls reach ${assistant} once your server has a phone line.`;
  if (lineUnknown(h)) return `${assistant} is on. Update your server to see whether real calls can reach ${assistant}.`;
  return `${assistant} is answering calls.`;
}

/** Call for me can place a real call. Until health is in, assume it can;
 *  servers that don't report their line go by the dialer. */
export function canCallOut(h: Health | null | undefined): boolean {
  if (!h) return true;
  return h.phone_line ? h.phone_line.outbound : h.dialer !== 'none';
}

/** Why the app can't answer calls itself, and where a free phone line can run. */
export const whyPhoneLine = (assistant: string) =>
  `Android doesn't let apps answer or speak on phone calls, so calls reach ${assistant} through your server's phone line. ` +
  'The free lines (Bluetooth to your phone, or a USB SIM modem) need the server on a Linux computer: Docker Desktop on Windows or a Mac can\'t reach them.';

/** What the server said about its line, or a plain stand-in when it said nothing. */
export function phoneLineDetail(h: Health | null | undefined): string {
  if (h?.phone_line?.detail) return h.phone_line.detail;
  if (lineUnknown(h)) return "Your server is too old to say whether it has a phone line. Update it to find out.";
  return h && !canCallOut(h) ? "Your server can't place calls yet." : 'Your server has no phone line connected yet.';
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
  if (!line) return h.dialer === 'none' ? 'Not set up' : 'Not checked · update your server';
  if (line.kind === 'none') return 'Not connected yet';
  return `${LINE_NAMES[line.kind]} · ${line.ok ? 'connected' : 'not connected'}`;
}
