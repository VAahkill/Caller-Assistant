jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

import { act, renderHook } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';

import { MockFile } from '../../test/expoFileSystemMock';
import { useSentencePlayer } from '../useSentencePlayer';

// Each created player remembers its file and lets the test finish it.
interface FakePlayer {
  uri: string;
  play: jest.Mock;
  remove: jest.Mock;
  finish: () => void;
}
let players: FakePlayer[] = [];

beforeEach(() => {
  players = [];
  MockFile.written = [];
  MockFile.deleted = [];
  (createAudioPlayer as jest.Mock).mockImplementation((src: { uri: string }) => {
    let listener: (s: { didJustFinish: boolean }) => void = () => undefined;
    const p: FakePlayer = {
      uri: src.uri,
      play: jest.fn(),
      remove: jest.fn(),
      finish: () => listener({ didJustFinish: true }),
    };
    players.push(p);
    return {
      ...p,
      addListener: (_: string, fn: typeof listener) => {
        listener = fn;
        return { remove: jest.fn() };
      },
    };
  });
});

const wav = () => new ArrayBuffer(8);
const playing = () => players.filter((p) => p.play.mock.calls.length > 0 && p.remove.mock.calls.length === 0);

test('sentences play in order, one at a time, with the next one loaded early', async () => {
  const { result } = await renderHook(() => useSentencePlayer(jest.fn()));
  await act(async () => {
    result.current.push(wav());
    result.current.push(wav());
    result.current.push(wav());
  });
  // The first plays; the second is loaded and waiting; the third is only on disk.
  expect(players).toHaveLength(2);
  expect(playing()).toHaveLength(1);
  expect(players[0].play).toHaveBeenCalledTimes(1);
  expect(players[1].play).not.toHaveBeenCalled();
  expect(result.current.speaking).toBe(true);

  await act(async () => players[0].finish());
  // The second starts at once and the third is loaded behind it.
  expect(players[0].remove).toHaveBeenCalled();
  expect(players[1].play).toHaveBeenCalledTimes(1);
  expect(players).toHaveLength(3);
  expect(playing()).toHaveLength(1);

  await act(async () => players[1].finish());
  await act(async () => players[2].finish());
  expect(players.map((p) => p.play.mock.calls.length)).toEqual([1, 1, 1]);
  expect(result.current.speaking).toBe(false);
  // Every sentence file is deleted after playing.
  expect(MockFile.deleted).toEqual(MockFile.written);
});

test('a finish event from an old player never skips a sentence', async () => {
  const { result } = await renderHook(() => useSentencePlayer(jest.fn()));
  await act(async () => {
    result.current.push(wav());
    result.current.push(wav());
  });
  // The preloaded (not yet playing) clip reports a finish: ignored.
  await act(async () => players[1].finish());
  expect(players[0].remove).not.toHaveBeenCalled();
  expect(players[1].play).not.toHaveBeenCalled();
});

test('mute stops playback and skips what arrives while muted', async () => {
  const { result } = await renderHook(() => useSentencePlayer(jest.fn()));
  await act(async () => {
    result.current.push(wav());
    result.current.push(wav());
  });
  await act(async () => result.current.setMuted(true));
  expect(players.every((p) => p.remove.mock.calls.length === 1)).toBe(true);
  expect(result.current.speaking).toBe(false);
  expect(result.current.muted).toBe(true);
  await act(async () => result.current.push(wav()));
  expect(players).toHaveLength(2);

  await act(async () => result.current.setMuted(false));
  await act(async () => result.current.push(wav()));
  expect(players).toHaveLength(3);
  expect(players[2].play).toHaveBeenCalled();
});

test('a sentence that cannot be saved is reported, not dropped silently', async () => {
  const onError = jest.fn();
  const write = jest.spyOn(MockFile.prototype, 'write').mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  const { result } = await renderHook(() => useSentencePlayer(onError));
  await act(async () => result.current.push(wav()));
  expect(onError).toHaveBeenCalledWith("Couldn't play the assistant's voice: disk full");
  write.mockRestore();
});
