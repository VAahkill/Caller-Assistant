import { clearAllPreloadedSources, preload, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { MediaSource } from '../lib/api';
import { DEMO_IDLE, DEMO_TIMEOUT_MS, demoReducer, type DemoPhase } from '../lib/voices';

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
}

/** One audio player for every demo on a screen, so only one plays at a time.
 *  `onError` hears about demos that fail or never start. */
export function useDemoPlayer(onError?: (message: string) => void, timeoutMs = DEMO_TIMEOUT_MS): DemoPlayer {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [state, dispatch] = useReducer(demoReducer, DEMO_IDLE);

  useEffect(() => {
    dispatch({
      type: 'status',
      playing: status.playing,
      isBuffering: status.isBuffering,
      didJustFinish: status.didJustFinish,
      error: status.error ?? null,
    });
  }, [status.playing, status.isBuffering, status.didJustFinish, status.error]);

  // Loading that never turns into playing is an error, not a spinner forever.
  useEffect(() => {
    if (state.phase !== 'loading' || !state.key) return;
    const key = state.key;
    const timer = setTimeout(() => dispatch({ type: 'timeout', key }), timeoutMs);
    return () => clearTimeout(timer);
  }, [state.phase, state.key, timeoutMs]);

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
        player.pause();
        return;
      }
      if (!source) {
        dispatch({ type: 'fail', key, error: 'Connect to your server to hear this.' });
        return;
      }
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
    dispatch({ type: 'stop' });
    player.pause();
  }, [player]);

  const progress = state.phase === 'playing' && status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const phaseOf = useCallback((key: string): DemoPhase => (state.key === key ? state.phase : 'idle'), [state.key, state.phase]);
  return { phaseOf, toggle, stop, progress, current: state.phase === 'playing' ? state.key : null };
}

/** Starts fetching every demo (with the Authorization header) as soon as the
 *  list is known, so a tap plays at once. Each one is fetched once per visit;
 *  they are released when the screen closes. */
export function usePreloadedSources(sources: MediaSource[]): void {
  const done = useRef(new Set<string>());
  const key = sources.map((s) => s.uri).join('\n');
  const latest = useRef(sources);
  useEffect(() => {
    latest.current = sources;
  });

  useEffect(() => {
    for (const s of latest.current) {
      if (done.current.has(s.uri)) continue;
      done.current.add(s.uri);
      // Promise.resolve: the web build's version returns nothing instead of a promise.
      Promise.resolve()
        .then(() => preload(s))
        .catch((e: unknown) => {
          done.current.delete(s.uri);
          console.warn('Voice demo preload failed', s.uri, e);
        });
    }
  }, [key]);

  useEffect(() => {
    const preloaded = done.current;
    return () => {
      preloaded.clear();
      Promise.resolve()
        .then(() => clearAllPreloadedSources())
        .catch((e: unknown) => console.warn('Clearing preloaded demos failed', e));
    };
  }, []);
}
