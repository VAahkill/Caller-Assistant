import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from './useAsyncAction';

export interface Resource<T> {
  data: T | undefined;
  error: string | null;
  /** First load, nothing to show yet: render skeletons. */
  loading: boolean;
  /** Pull-to-refresh in progress. */
  refreshing: boolean;
  /** Re-fetch quietly (after an event or on focus). */
  reload: () => Promise<void>;
  /** Pull-to-refresh. */
  refresh: () => Promise<void>;
  /** Optimistic local edits. */
  mutate: (update: (prev: T | undefined) => T | undefined) => void;
}

/** Loads data for a screen with loading, error and refresh states.
 *  `key` changes trigger a quiet reload (keep data, replace when it arrives). */
export function useResource<T>(fetcher: () => Promise<T>, key: unknown = 0, enabled = true): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // True until the first answer arrives; only shown while the resource is enabled.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await latest.current();
      if (mine !== seq.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [key, enabled, load]);

  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const mutate = useCallback((update: (prev: T | undefined) => T | undefined) => setData((d) => update(d)), []);

  return { data, error, loading: enabled && loading && data === undefined, refreshing, reload: load, refresh, mutate };
}
