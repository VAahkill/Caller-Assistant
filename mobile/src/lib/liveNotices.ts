// What the app shows in the notification shade for a live event, while it runs
// and the server can't push to this phone. Kept apart from the provider so the
// wording and the channel of each one can be tested.

import type { ServerEvent } from './events';
import { taskUpdateText } from './tasks';

/** normal: the "calls" channel. urgent: the "calls-urgent" channel (max
 *  priority, through Do Not Disturb). hold: urgent, plus the reply box. */
export type NoticeKind = 'normal' | 'urgent' | 'hold';

export interface LiveNotice {
  title: string;
  body: string;
  data: Record<string, unknown>;
  kind: NoticeKind;
  /** A notice with the same id replaces the one before it (one per call). */
  id?: string;
  vibrate?: number[];
}

const MAX_BODY = 240;

function clip(text: string, max = MAX_BODY): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The server's title is "Urgent: <who>: <summary>"; the shade shows it as a title and a body. */
function urgentText(ev: Extract<ServerEvent, { event: 'urgent_call' }>): { title: string; body: string } {
  const who = ev.who || 'A caller';
  if (ev.reason === 'vip') {
    return { title: ev.title || `VIP ${who} is calling`, body: 'Your assistant is answering. Tap to follow live.' };
  }
  const prefix = `Urgent: ${ev.who}: `;
  const summary = ev.title.startsWith(prefix) ? ev.title.slice(prefix.length) : ev.title.replace(/^Urgent:\s*/, '');
  return { title: `Urgent call from ${who}`, body: clip(summary || 'Tap to see what they said.') };
}

export function liveNotice(ev: ServerEvent): LiveNotice | null {
  switch (ev.event) {
    case 'call_started':
      return {
        title: 'Assistant answering',
        body: `${ev.who || 'Unknown caller'}. Tap to follow live.`,
        data: { call_id: ev.call_id },
        kind: 'normal',
        id: `call-${ev.call_id}`,
      };
    case 'urgent_call':
      return { ...urgentText(ev), data: { call_id: ev.call_id }, kind: 'urgent', id: `call-${ev.call_id}`, vibrate: [0, 600, 200, 600] };
    case 'hold_question':
    case 'task_needs_decision':
      return {
        title: `${ev.who} is waiting`,
        body: ev.question,
        data: { call_id: ev.call_id, hold_id: ev.hold_id },
        kind: 'hold',
        vibrate: [0, 400, 200, 400],
      };
    case 'sensitive_request':
      return { title: 'Security alert', body: clip(`${ev.who}: ${ev.text}`), data: { call_id: ev.call_id }, kind: 'normal', vibrate: [0, 600] };
    case 'message_taken':
      return { title: `Message from ${ev.who}`, body: clip(ev.message.text), data: { message_id: ev.message.id }, kind: 'normal' };
    case 'task_update':
      // A practice task is the owner's own test, played in the app: nothing to announce.
      return !ev.task.practice && (ev.task.status === 'done' || ev.task.status === 'failed')
        ? { title: 'Call task finished', body: taskUpdateText(ev.task, ev.title), data: { task_id: ev.task.id }, kind: 'normal' }
        : null;
    default:
      return null;
  }
}
