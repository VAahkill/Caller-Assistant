import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Plays the assistant's sentences (one WAV each, from the practice socket) in
 * order, without gaps or overlaps. Files go to the cache and are deleted after
 * playing.
 */
export function useSentencePlayer(onError: (message: string) => void) {
  const queue = useRef<File[]>([]);
  const player = useRef<AudioPlayer | null>(null);
  const seq = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  });

  const discard = (file: File) => {
    try {
      file.delete();
    } catch (e) {
      console.warn('Could not delete a played sentence from the cache', e);
    }
  };

  const playNext = useCallback(function next() {
    if (player.current) return;
    const file = queue.current.shift();
    if (!file) {
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    const p = createAudioPlayer({ uri: file.uri });
    player.current = p;
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (!s.didJustFinish) return;
      sub.remove();
      p.remove();
      player.current = null;
      discard(file);
      next();
    });
    p.play();
  }, []);

  const push = useCallback(
    (wav: ArrayBuffer) => {
      try {
        const file = new File(Paths.cache, `practice-${Date.now()}-${seq.current++}.wav`);
        file.create();
        file.write(new Uint8Array(wav));
        queue.current.push(file);
        playNext();
      } catch (e) {
        errorRef.current(`Couldn't play the assistant's voice: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [playNext],
  );

  const stop = useCallback(() => {
    for (const f of queue.current.splice(0)) discard(f);
    player.current?.remove();
    player.current = null;
    setSpeaking(false);
  }, []);

  const prepare = useCallback(async () => {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
  }, []);

  useEffect(() => stop, [stop]);

  return { push, stop, prepare, speaking };
}
