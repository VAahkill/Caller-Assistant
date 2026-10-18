import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Clip {
  file: File;
  player: AudioPlayer;
  done: { remove: () => void };
}

function discard(file: File) {
  try {
    file.delete();
  } catch (e) {
    console.warn('Could not delete a played sentence from the cache', e);
  }
}

function release(clip: Clip | null) {
  if (!clip) return;
  clip.done.remove();
  clip.player.remove();
  discard(clip.file);
}

/**
 * Plays the assistant's sentences (one WAV each, from the practice socket) in
 * order, one at a time. While a sentence plays, the next one is already loaded,
 * so it starts the moment the first ends: no gaps, no overlaps. Files go to the
 * cache and are deleted once played. Muting stops playback and skips new audio.
 */
export function useSentencePlayer(onError: (message: string) => void) {
  const waiting = useRef<File[]>([]);
  const current = useRef<Clip | null>(null);
  const next = useRef<Clip | null>(null);
  const mutedRef = useRef(false);
  const seq = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(false);
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  });

  // Loads a sentence; it starts when advance() makes it current.
  const load = useCallback(function loadClip(file: File, advance: () => void): Clip {
    const player = createAudioPlayer({ uri: file.uri });
    const clip: Clip = { file, player, done: { remove: () => undefined } };
    clip.done = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish && current.current === clip) advance();
    });
    return clip;
  }, []);

  const advance = useCallback(
    function step() {
      release(current.current);
      current.current = null;
      const upcoming = next.current ?? (waiting.current.length ? load(waiting.current.shift()!, step) : null);
      next.current = null;
      if (!upcoming) {
        setSpeaking(false);
        return;
      }
      current.current = upcoming;
      setSpeaking(true);
      upcoming.player.play();
      if (waiting.current.length) next.current = load(waiting.current.shift()!, step);
    },
    [load],
  );

  const push = useCallback(
    (wav: ArrayBuffer) => {
      if (mutedRef.current) return;
      try {
        const file = new File(Paths.cache, `practice-${Date.now()}-${seq.current++}.wav`);
        file.create();
        file.write(new Uint8Array(wav));
        if (!current.current) {
          waiting.current.push(file);
          advance();
        } else if (!next.current) {
          next.current = load(file, advance);
        } else {
          waiting.current.push(file);
        }
      } catch (e) {
        errorRef.current(`Couldn't play the assistant's voice: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [advance, load],
  );

  const stop = useCallback(() => {
    for (const f of waiting.current.splice(0)) discard(f);
    release(next.current);
    next.current = null;
    release(current.current);
    current.current = null;
    setSpeaking(false);
  }, []);

  const setMuted = useCallback(
    (m: boolean) => {
      mutedRef.current = m;
      setMutedState(m);
      if (m) stop();
    },
    [stop],
  );

  const prepare = useCallback(async () => {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
  }, []);

  useEffect(() => stop, [stop]);

  return { push, stop, prepare, speaking, muted, setMuted };
}
