import { createFixtures } from '../mock/fixtures';
import type { VoiceInfo } from '../types';
import {
  DEMO_IDLE,
  choosePatch,
  chosenVoiceId,
  demoReducer,
  levelFromMetering,
  loudness,
  recordingHint,
  samplePathFor,
  statusChanges,
  suggestName,
  takeProblem,
  voiceGroups,
  type DemoEvent,
  type DemoState,
} from '../voices';

const fx = createFixtures(1_760_000_000);

describe('voiceGroups', () => {
  test('caller languages first, in their order, then the rest by name', () => {
    const groups = voiceGroups(fx.voices, ['te', 'en', 'hi', 'ta']);
    expect(groups.map((g) => [g.lang, g.primary])).toEqual([
      ['te', true],
      ['en', true],
      ['hi', true],
      ['ta', true],
    ]);
    const other = voiceGroups(fx.voices, ['te']);
    expect(other.map((g) => g.lang)).toEqual(['te', 'en', 'hi', 'ta']);
    expect(other.filter((g) => !g.primary).map((g) => g.lang)).toEqual(['en', 'hi', 'ta']);
  });

  test('ready recorded voices join the caller languages they speak, first', () => {
    const groups = voiceGroups(fx.voices, ['te', 'en', 'hi']);
    const ids = (lang: string) => groups.find((g) => g.lang === lang)!.voices.map((v) => v.id);
    // XTTS speaks English and Hindi, not Telugu; "Dad" is still preparing.
    expect(ids('en').slice(0, 2)).toEqual(['clone:my-voice-3f2a1c', 'kokoro:af_heart']);
    expect(ids('hi')[0]).toBe('clone:my-voice-3f2a1c');
    expect(ids('te')).toEqual(['piper:te_IN-padmavathi-medium', 'piper:te_IN-venkatesh-medium']);
    expect(groups.flatMap((g) => g.voices).some((v) => v.id === 'clone:dad-91b2e0')).toBe(false);
    // Recorded voices never make groups of their own.
    expect(voiceGroups(fx.voices, []).map((g) => g.lang)).toEqual(['en', 'hi', 'ta', 'te']);
  });

  test('a caller language with no voice still gets a group, so the screen can say so', () => {
    const groups = voiceGroups(fx.voices, ['bn', 'en']);
    expect(groups[0]).toEqual({ lang: 'bn', primary: true, voices: [] });
  });
});

test('the voice for a language, and the patch that picks one', () => {
  const p = { voice: 'kokoro:af_heart', voices_by_language: { te: 'piper:te_IN-padmavathi-medium' } };
  expect(chosenVoiceId(p, 'te')).toBe('piper:te_IN-padmavathi-medium');
  expect(chosenVoiceId(p, 'en')).toBe('kokoro:af_heart');
  expect(chosenVoiceId(p, 'hi')).toBeUndefined();
  expect(choosePatch(p, 'hi', 'kokoro:hm_omega')).toEqual({
    voices_by_language: { te: 'piper:te_IN-padmavathi-medium', hi: 'kokoro:hm_omega' },
  });
  expect(choosePatch(p, 'en', 'clone:my-voice-3f2a1c')).toEqual({
    voice: 'clone:my-voice-3f2a1c',
    voices_by_language: { te: 'piper:te_IN-padmavathi-medium', en: 'clone:my-voice-3f2a1c' },
  });
});

test('samplePathFor asks for the demo in the right language', () => {
  const v = { id: 'clone:my-voice-3f2a1c', sample_url: '/voices/clone%3Amy-voice-3f2a1c/sample.wav?lang=en&v=3f2a1c' };
  expect(samplePathFor(v, 'hi')).toBe('/voices/clone%3Amy-voice-3f2a1c/sample.wav?lang=hi&v=3f2a1c');
  expect(samplePathFor({ id: 'x', sample_url: '/voices/x/sample.wav' }, 'te')).toBe('/voices/x/sample.wav?lang=te');
  expect(samplePathFor({ id: 'kokoro:af_heart', sample_url: '' }, 'en')).toMatch(/^\/assistant\/speak\?voice=kokoro%3Aaf_heart&lang=en&text=/);
});

test('suggestName avoids names already used', () => {
  expect(suggestName([])).toBe('My voice');
  expect(suggestName(['My voice', 'Dad'])).toBe('My voice 2');
  expect(suggestName(['my voice', 'My voice 2'])).toBe('My voice 3');
});

test('statusChanges reports recorded voices that stopped preparing', () => {
  const dad = fx.voices.find((v) => v.id === 'clone:dad-91b2e0')!;
  const before = new Map(fx.voices.map((v) => [v.id, v.status] as const));
  const after: VoiceInfo[] = fx.voices.map((v) => (v.id === dad.id ? { ...v, status: 'ready' } : v));
  expect(statusChanges(before, after).map((c) => c.voice.id)).toEqual([dad.id]);
  expect(statusChanges(before, fx.voices)).toEqual([]);
  // A voice seen for the first time is not announced.
  expect(statusChanges(new Map(), after)).toEqual([]);
});

describe('demo player', () => {
  const run = (...events: DemoEvent[]) => events.reduce<DemoState>(demoReducer, DEMO_IDLE);
  const status = (over: Partial<Extract<DemoEvent, { type: 'status' }>> = {}): DemoEvent => ({
    type: 'status',
    playing: false,
    isBuffering: false,
    didJustFinish: false,
    error: null,
    ...over,
  });

  test('tap loads, playing shows playing, and the end goes back to idle', () => {
    expect(run({ type: 'tap', key: 'a' })).toEqual({ key: 'a', phase: 'loading', error: null });
    expect(run({ type: 'tap', key: 'a' }, status({ playing: true }))).toMatchObject({ key: 'a', phase: 'playing' });
    expect(run({ type: 'tap', key: 'a' }, status({ playing: true }), status({ didJustFinish: true }))).toEqual(DEMO_IDLE);
  });

  test('tapping the same demo again stops it; another one switches', () => {
    expect(run({ type: 'tap', key: 'a' }, status({ playing: true }), { type: 'tap', key: 'a' })).toEqual(DEMO_IDLE);
    expect(run({ type: 'tap', key: 'a' }, { type: 'tap', key: 'a' })).toEqual(DEMO_IDLE);
    expect(run({ type: 'tap', key: 'a' }, status({ playing: true }), { type: 'tap', key: 'b' })).toEqual({ key: 'b', phase: 'loading', error: null });
  });

  test('buffering while playing is not the end', () => {
    expect(run({ type: 'tap', key: 'a' }, status({ playing: true }), status({ isBuffering: true }))).toMatchObject({ phase: 'playing' });
    expect(run({ type: 'tap', key: 'a' }, status({ playing: true }), status())).toEqual(DEMO_IDLE);
  });

  test('a demo that never starts, or fails, says so; a later tap retries', () => {
    const timedOut = run({ type: 'tap', key: 'a' }, { type: 'timeout', key: 'a' });
    expect(timedOut).toMatchObject({ key: 'a', phase: 'error' });
    expect(timedOut.error).toMatch(/didn't start/);
    // A timeout for a demo you already left changes nothing.
    expect(run({ type: 'tap', key: 'a' }, { type: 'tap', key: 'b' }, { type: 'timeout', key: 'a' })).toMatchObject({ key: 'b', phase: 'loading' });
    expect(run({ type: 'tap', key: 'a' }, status({ error: 'HTTP 409' }))).toEqual({ key: 'a', phase: 'error', error: 'HTTP 409' });
    expect(run({ type: 'tap', key: 'a' }, status({ error: 'x' }), { type: 'tap', key: 'a' })).toEqual({ key: 'a', phase: 'loading', error: null });
  });
});

describe('recording checks', () => {
  test('level meter', () => {
    expect(levelFromMetering(undefined)).toBe(0);
    expect(levelFromMetering(-160)).toBe(0);
    expect(levelFromMetering(-30)).toBeCloseTo(0.5);
    expect(levelFromMetering(0)).toBe(1);
  });

  test('loudness from metering samples', () => {
    expect(loudness([-20, -22])).toBe('unknown');
    expect(loudness(Array(30).fill(-50))).toBe('quiet');
    expect(loudness([...Array(20).fill(-55), ...Array(10).fill(-18)])).toBe('good');
    expect(loudness([...Array(20).fill(-20), ...Array(10).fill(-0.2)])).toBe('clipping');
  });

  test('hints and problems', () => {
    expect(recordingHint(3)).toBe('Keep reading…');
    expect(recordingHint(10)).toMatch(/^Good/);
    expect(recordingHint(20)).toMatch(/^Great/);
    expect(recordingHint(42)).toBe('Stopping at 45 seconds.');
    expect(takeProblem(5, 'good')).toMatchObject({ blocking: true, title: 'That was 5 seconds' });
    expect(takeProblem(16, 'quiet')).toMatchObject({ blocking: false, title: 'It sounds quiet' });
    expect(takeProblem(16, 'good')).toBeNull();
    expect(takeProblem(16, 'unknown')).toBeNull();
  });
});
