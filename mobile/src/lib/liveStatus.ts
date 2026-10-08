// What the assistant is doing on a live or practice call, in words, from the
// server's assistant_status events (API contract v2).

import type { IconName } from './design';
import type { AssistantState } from './types';

export type StatusTone = 'success' | 'primary' | 'info' | 'warning' | 'danger' | 'neutral';

export interface LiveStatus {
  /** e.g. "Ava is translating" */
  title: string;
  icon: IconName;
  tone: StatusTone;
  /** Working on a turn: show motion. */
  busy: boolean;
}

export interface LiveStatusInput {
  state: AssistantState;
  assistantName: string;
  detail?: string;
  /** The call is on hold waiting for the owner. */
  onHold?: boolean;
  /** Audio is playing on this phone (practice), which beats the server's state. */
  speaking?: boolean;
  phase?: 'connecting' | 'live' | 'ended';
}

/** Short words for each state, e.g. for a pill. */
export const STATE_WORD: Record<AssistantState, string> = {
  listening: 'Listening',
  transcribing: 'Transcribing',
  translating: 'Translating',
  thinking: 'Thinking',
  speaking: 'Speaking',
  idle: 'Waiting',
  error: 'Had a problem',
};

/** States in which a reply is being worked on (a typing indicator shows). */
export const WORKING: ReadonlySet<AssistantState> = new Set(['transcribing', 'translating', 'thinking']);

export function liveStatus({ state, assistantName, detail, onHold, speaking, phase = 'live' }: LiveStatusInput): LiveStatus {
  const name = assistantName || 'Your assistant';
  if (phase === 'connecting') return { title: 'Connecting…', icon: 'sync-outline', tone: 'neutral', busy: true };
  if (phase === 'ended') return { title: 'Call ended', icon: 'call-outline', tone: 'neutral', busy: false };
  if (speaking) return { title: `${name} is speaking`, icon: 'volume-high-outline', tone: 'info', busy: true };
  if (onHold && state !== 'error' && state !== 'speaking' && !WORKING.has(state)) {
    return { title: 'On hold, waiting for you', icon: 'hand-left-outline', tone: 'warning', busy: false };
  }
  switch (state) {
    case 'listening':
      return { title: `${name} is listening`, icon: 'ear-outline', tone: 'success', busy: false };
    case 'transcribing':
      return { title: `${name} is transcribing`, icon: 'create-outline', tone: 'primary', busy: true };
    case 'translating':
      return { title: `${name} is translating`, icon: 'language-outline', tone: 'primary', busy: true };
    case 'thinking':
      return { title: `${name} is thinking`, icon: 'sparkles-outline', tone: 'primary', busy: true };
    case 'speaking':
      return { title: `${name} is speaking`, icon: 'volume-high-outline', tone: 'info', busy: true };
    case 'error':
      return { title: detail ? `Problem: ${detail}` : `${name} had a problem`, icon: 'alert-circle-outline', tone: 'danger', busy: false };
    case 'idle':
      return { title: detail ? `${name} is ${detail}` : `${name} is waiting`, icon: 'time-outline', tone: 'neutral', busy: false };
  }
}

/** Words under the typing indicator while a reply is worked on. */
export function workingText(state: AssistantState, assistantName: string): string {
  const name = assistantName || 'Your assistant';
  if (state === 'transcribing') return `${name} is writing down what was said…`;
  if (state === 'translating') return `${name} is translating…`;
  return `${name} is thinking…`;
}

/** "96% sure" for a language-detection confidence (0..1); empty when unknown. */
export function confidenceText(confidence: number): string {
  if (!(confidence > 0)) return '';
  return `${Math.round(Math.min(1, confidence) * 100)}% sure`;
}
