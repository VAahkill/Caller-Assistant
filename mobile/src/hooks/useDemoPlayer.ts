import { clearAllPreloadedSources, clearPreloadedSource, preload, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { currentConfig, probeMedia, PROBE_TIMEOUT_MS, type MediaSource } from '../lib/api';
import { DEMO_IDLE, DEMO_TIMEOUT_MS, demoProblem, demoReducer, type DemoPhase } from '../lib/voices';

export interface DemoPlayer {
  /** The state of one demo: idle, loading, playing or error. */
  phaseOf: (key: string) => DemoPhase;
  /** Play a demo, or stop it if it is the one playing. */
  toggle: (key: string, source: MediaSource | null) => void;
  stop: () => void;
  /** 0 to 1 through the demo that is playing. */
  progress: number;
  /** The demo playing now, if any. */
  current: string | null;
  /** A tapped demo is loading (or being checked): preloading waits meanwhile. */
  loading: boolean;
}

export interface DemoPlayerOptions {
  /** The server is the first version (serverOutdated), so failures are explained as that. */
  outdated?: boolean;
  timeoutMs?: number;
  checkTimeoutMs?: number;
}

/** One audio player for every demo on a screen, so only one plays at a time.
 *  The player itself only says that a demo failed, so a demo that fails or
 *  doesn't start in time is asked for again directly; `onError` hears the
 *  reason that finds, or nothing if the demo was ready and plays on a retry. */
export function useDemoPlayer(onError?: (message: string) => void, options: DemoPlayerOptions = {}): DemoPlayer {
  const { outdated = false, timeoutMs = DEMO_TIMEOUT_MS, checkTimeoutMs = PROBE_TIMEOUT_MS } = options;
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [state, dispatch] = useReducer(demoReducer, DEMO_IDLE);
  // The demo the player is on, to ask for it again; and the player error from
  // before it started, which belongs to an earlier demo.
  const active = useRef<{ key: string; source: MediaSource } | null>(null);
  const staleError = useRef<string | null>(null);
  const outdatedNow = useRef(outdated);
  const latestStatusError = useRef(status.error);
  useEffect(() => {
    outdatedNow.current = outdated;
    latestStatusError.current = status.error;
  });

  useEffect(() => {
    if (!status.error) staleError.current = null;
    dispatch({
      type: 'status',
      playing: status.playing,
      isBuffering: status.isBuffering,
      didJustFinish: status.didJustFinish,
      error: status.error && status.error !== staleError.current ? status.error : null,
    });
  }, [status.playing, status.isBuffering, status.didJustFinish, status.error]);

  // Loading that doesn't turn into playing in time is checked, not a spinner forever.
  useEffect(() => {
    if (state.phase !== 'loading' || state.checking || !state.key) return;
    const key = state.key;
    const timer = setTimeout(() => dispatch({ type: 'timeout', key }), timeoutMs);
    return () => clearTimeout(timer);
  }, [state.phase, state.key, state.checking, state.retried, timeoutMs]);

  // Checking: ask the server for the same demo, then play it again once or say why not.
  // Tapping stop or another demo cancels the check.
  useEffect(() => {
    const a = active.current;
    if (!state.checking || !state.key || a?.key !== state.key) return;
    const { key, source } = a;
    const retried = state.retried;
    const controller = new AbortController();
    void probeMedia(source, controller.signal, checkTimeoutMs).then((probe) => {
      if (controller.signal.aborted) return;
      const found = demoProblem(probe, { server: currentConfig()?.url ?? 'its address', outdated: outdatedNow.current, retried });
      if (!found) return;
      if (found.retry) {
        // The player may have started on its own meanwhile (it waited for the same
        // demo); replacing it would restart the clip.
        if (player.playing) {
          dispatch({ type: 'checked', key, retry: true });
          return;
        }
        try {
          staleError.current = latestStatusError.current ?? null;
          player.replace(source);
          player.play();
        } catch (e) {
          dispatch({ type: 'fail', key, error: `Couldn't play it: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
        dispatch({ type: 'checked', key, retry: true });
      } else dispatch({ type: 'checked', key, retry: false, error: found.message });
    });
    return () => controller.abort();
  }, [state.checking, state.key, state.retried, checkTimeoutMs, player]);

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase === 'error' && state.error && reported.current !== state.error) {
      reported.current = state.error;
      player.pause();
      onError?.(state.error);
    }
    if (state.phase !== 'error') reported.current = null;
  }, [state.phase, state.error, player, onError]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const toggle = useCallback(
    (key: string, source: MediaSource | null) => {
      const s = stateRef.current;
      const stopping = s.key === key && (s.phase === 'loading' || s.phase === 'playing');
      dispatch({ type: 'tap', key });
      if (stopping) {
        active.current = null;
        player.pause();
        return;
      }
      if (!source) {
        active.current = null;
        dispatch({ type: 'fail', key, error: 'Connect to your server to hear this.' });
        return;
      }
      active.current = { key, source };
      staleError.current = latestStatusError.current ?? null;
      try {
        player.replace(source);
        player.play();
      } catch (e) {
        dispatch({ type: 'fail', key, error: `Couldn't play it: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [player],
  );

  const stop = useCallback(() => {
    active.current = null;
    dispatch({ type: 'stop' });
    player.pause();
  }, [player]);

  const progress = state.phase === 'playing' && status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const phaseOf = useCallback((key: string): DemoPhase => (state.key === key ? state.phase : 'idle'), [state.key, state.phase]);
  return { phaseOf, toggle, stop, progress, current: state.phase === 'playing' ? state.key : null, loading: state.phase === 'loading' };
}

/** Preloads one source at a time, in the order given, each once per visit;
 *  a failed one is left for the tap. While held, the next one waits. */
function preloadQueue(heldAtFirst: boolean) {
  const tried = new Set<string>();
  let list: MediaSource[] = [];
  let busy = false;
  let held = heldAtFirst;
  let open = true;
  const next = (): void => {
    if (busy || held || !open) return;
    const s = list.find((x) => !tried.has(x.uri));
    if (!s) return;
    tried.add(s.uri);
    busy = true;
    // Promise.resolve: the web build's version returns nothing instead of a promise.
    Promise.resolve()
      .then(() => preload(s))
      .catch((e: unknown) => console.warn('Voice demo preload failed', s.uri, e))
      .finally(() => {
        busy = false;
        if (open) next();
        // Finished after the screen closed: let it go too.
        else {
          Promise.resolve()
            .then(() => clearPreloadedSource(s))
            .catch((e: unknown) => console.warn('Releasing a voice demo failed', s.uri, e));
        }
      });
  };
  return {
    set(sources: MediaSource[]) {
      list = sources;
      next();
    },
    hold(on: boolean) {
      held = on;
      next();
    },
    open() {
      open = true;
      next();
    },
    close() {
      open = false;
      tried.clear();
      Promise.resolve()
        .then(() => clearAllPreloadedSources())
        .catch((e: unknown) => console.warn('Clearing preloaded demos failed', e));
    },
  };
}

/** Fetches the demos (with the Authorization header) one at a time, in list
 *  order, so a tap plays at once without the server making dozens together.
 *  `paused` (a tapped demo is loading) holds the next one back, so the server
 *  works on the tap first. They are released when the screen closes. */
export function usePreloadedSources(sources: MediaSource[], paused = false): void {
  const [queue] = useState(() => preloadQueue(paused));
  const key = sources.map((s) => s.uri).join('\n');
  const latest = useRef(sources);
  useEffect(() => {
    latest.current = sources;
  });

  useEffect(() => {
    queue.open();
    return () => queue.close();
  }, [queue]);
  useEffect(() => {
    queue.set(latest.current);
  }, [key, queue]);
  useEffect(() => {
    queue.hold(paused);
  }, [paused, queue]);
}
