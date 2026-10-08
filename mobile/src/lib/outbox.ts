// What the owner (or, in a practice call, the pretend caller) has sent but the
// transcript doesn't show yet. Each send appears at once as a bubble that says
// "Sending", then "Sent", and goes away when the server's own transcript line
// for it arrives. A failed send stays, with the reason and Retry.
//
// Matching is by order, not by text: the server may scrub or translate what was
// sent, and sends are one at a time, so the first new line from the same
// speaker after a send is that send's line.

import type { Speaker, TranscriptLine } from './types';

export type OutboxState = 'sending' | 'sent' | 'failed';

export interface OutboxItem {
  id: string;
  /** Who the line will be in the transcript: the owner ('user') or the practice caller. */
  speaker: Extract<Speaker, 'user' | 'caller'>;
  kind: 'text' | 'voice';
  /** What was typed, or for a recording what the server heard (once known). */
  text: string;
  /** Recording length. */
  seconds?: number;
  /** Language it was written or spoken in. */
  lang: string;
  state: OutboxState;
  error?: string;
  /** Transcript length when it was sent; its line comes after this. */
  after: number;
}

export type OutboxAction =
  | { type: 'add'; item: OutboxItem }
  | { type: 'sent'; id: string; text?: string; seconds?: number }
  | { type: 'failed'; id: string; error: string }
  | { type: 'retry'; id: string; after: number }
  | { type: 'remove'; id: string }
  | { type: 'settle'; lines: TranscriptLine[] }
  | { type: 'clear' };

/** Drops items whose transcript line has arrived. Failed items stay until retried or removed. */
export function settleOutbox(items: OutboxItem[], lines: TranscriptLine[]): OutboxItem[] {
  if (!items.length) return items;
  const used = new Set<number>();
  const kept = items.filter((item) => {
    if (item.state === 'failed') return true;
    for (let i = item.after; i < lines.length; i++) {
      if (used.has(i) || lines[i].speaker !== item.speaker) continue;
      used.add(i);
      return false;
    }
    return true;
  });
  return kept.length === items.length ? items : kept;
}

export function outboxReducer(items: OutboxItem[], action: OutboxAction): OutboxItem[] {
  switch (action.type) {
    case 'add':
      return [...items, action.item];
    case 'sent':
      return items.map((i) =>
        i.id === action.id
          ? { ...i, state: 'sent', error: undefined, text: action.text || i.text, seconds: action.seconds ?? i.seconds }
          : i,
      );
    case 'failed':
      return items.map((i) => (i.id === action.id ? { ...i, state: 'failed', error: action.error } : i));
    case 'retry':
      return items.map((i) => (i.id === action.id ? { ...i, state: 'sending', error: undefined, after: action.after } : i));
    case 'remove':
      return items.filter((i) => i.id !== action.id);
    case 'settle':
      return settleOutbox(items, action.lines);
    case 'clear':
      return items.length ? [] : items;
  }
}

/** Status words under a pending bubble. */
export function outboxLabel(item: OutboxItem, assistantName: string): string {
  if (item.state === 'failed') return 'Not sent';
  if (item.state === 'sending') return item.kind === 'voice' ? 'Sending your recording…' : 'Sending…';
  if (item.speaker === 'user') return `Sent · ${assistantName} is saying it`;
  return item.kind === 'voice' ? 'Sent · transcribing' : 'Sent';
}
