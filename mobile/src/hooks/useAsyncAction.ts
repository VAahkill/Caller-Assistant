import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '../components/ui/Toast';
import { haptic } from '../lib/haptics';

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong.';

export interface AsyncActionOptions<R> {
  /** Toast shown on success; a function gets the result. Omit for no toast. */
  success?: string | ((result: R) => string);
  /** Toast shown on failure; `false` keeps the error inline only (read `error`). */
  error?: string | ((e: unknown) => string) | false;
  /** How long `succeeded` stays true, for a "Saved" tick on the button. */
  successMs?: number;
}

export interface AsyncAction<A extends unknown[], R> {
  /** Runs the action unless it is already running. Resolves to the result, or undefined on failure. */
  run: (...args: A) => Promise<R | undefined>;
  busy: boolean;
  error: string | null;
  succeeded: boolean;
  reset: () => void;
}

/** Every async control goes through this: progress while it runs, a result
 *  afterwards (toast and/or inline error), haptics, and no double taps. */
export function useAsyncAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: AsyncActionOptions<R> = {},
): AsyncAction<A, R> {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ fn, options });
  useEffect(() => {
    latest.current = { fn, options };
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      const { fn: action, options: opts } = latest.current;
      setBusy(true);
      setError(null);
      setSucceeded(false);
      try {
        const result = await action(...args);
        if (!mounted.current) return result;
        const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
        if (message) toast.success(message);
        else haptic.success();
        setSucceeded(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => mounted.current && setSucceeded(false), opts.successMs ?? 1800);
        return result;
      } catch (e) {
        const detail = errorMessage(e);
        if (!mounted.current) {
          console.warn('Action failed after the screen closed:', detail);
          return undefined;
        }
        setError(detail);
        if (opts.error === false) haptic.error();
        else toast.error(typeof opts.error === 'function' ? opts.error(e) : opts.error ?? detail);
        return undefined;
      } finally {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [toast],
  );

  const reset = useCallback(() => {
    setError(null);
    setSucceeded(false);
  }, []);

  return { run, busy, error, succeeded, reset };
}
