import { useCallback, useEffect, useReducer, useRef } from 'react';

import { haptic } from '../lib/haptics';
import { outboxReducer, type OutboxItem } from '../lib/outbox';
import type { TranscriptLine } from '../lib/types';
import { errorMessage } from './useAsyncAction';

/** What a send resolves to: what the server heard (for a recording) and its length. */
export interface SendResult {
  text?: string;
  seconds?: number;
}

export type SendFn = () => Promise<SendResult | void>;

export type OutboxDraft = Pick<OutboxItem, 'speaker' | 'kind' | 'text' | 'lang' | 'seconds'>;

export interface Outbox {
  items: OutboxItem[];
  /** True while a send waits for the server; screens disable sending meanwhile. */
  busy: boolean;
  /** Shows the bubble at once, runs the send, then marks it sent or failed. Resolves true when sent. */
  send: (draft: OutboxDraft, fn: SendFn) => Promise<boolean>;
  retry: (id: string) => Promise<boolean>;
  remove: (id: string) => void;
  clear: () => void;
}

let seq = 0;

/** The call's turn errors so far, and the newest one's words. */
export interface TurnErrors {
  count: number;
  detail: string;
}

/**
 * Pending sends for a live or practice call, settled against the transcript.
 * With `turnErrors`, a new turn error fails the oldest recording still waiting
 * for its line: the server acks a recording before hearing it, and one with no
 * words gets a turn error instead of a line.
 */
export function useOutbox(lines: TranscriptLine[], turnErrors?: TurnErrors | null): Outbox {
  const [items, dispatch] = useReducer(outboxReducer, []);
  const fns = useRef(new Map<string, SendFn>());
  const linesRef = useRef(lines);
  const errorsSeen = useRef(turnErrors?.count ?? 0);
  const errorCount = turnErrors?.count ?? 0;
  const errorDetail = turnErrors?.detail ?? '';
  useEffect(() => {
    linesRef.current = lines;
    dispatch({ type: 'settle', lines });
    const fresh = errorCount > errorsSeen.current;
    errorsSeen.current = errorCount;
    if (fresh) dispatch({ type: 'unheard', error: errorDetail || "The server couldn't hear that recording." });
  }, [lines, errorCount, errorDetail]);

  // Forget the send functions of items that are gone.
  useEffect(() => {
    for (const id of fns.current.keys()) if (!items.some((i) => i.id === id)) fns.current.delete(id);
  }, [items]);

  const run = useCallback(async (id: string, fn: SendFn) => {
    try {
      const r = await fn();
      dispatch({ type: 'sent', id, text: r?.text, seconds: r?.seconds });
      // Its line may already be in the transcript (a fast server).
      dispatch({ type: 'settle', lines: linesRef.current });
      return true;
    } catch (e) {
      haptic.error();
      dispatch({ type: 'failed', id, error: errorMessage(e) });
      return false;
    }
  }, []);

  const send = useCallback(
    (draft: OutboxDraft, fn: SendFn) => {
      const id = `out-${Date.now().toString(36)}-${seq++}`;
      fns.current.set(id, fn);
      dispatch({ type: 'add', item: { ...draft, id, state: 'sending', after: linesRef.current.length } });
      return run(id, fn);
    },
    [run],
  );

  const retry = useCallback(
    (id: string) => {
      const fn = fns.current.get(id);
      if (!fn) return Promise.resolve(false);
      dispatch({ type: 'retry', id, after: linesRef.current.length });
      return run(id, fn);
    },
    [run],
  );

  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  return { items, busy: items.some((i) => i.state === 'sending'), send, retry, remove, clear };
}
