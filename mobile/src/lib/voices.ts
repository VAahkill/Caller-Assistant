// Voices screen logic: voices grouped by the languages callers speak, which
// voice answers each language, the demo player's states, checks on a fresh
// recording, and the status changes worth telling the owner about.

import type { MediaProbe } from './api';
import { languageName } from './languages';
import { voiceSamplePath } from './normalize';
import type { Profile, ProfilePatch, VoiceInfo, VoiceStatus } from './types';

export interface VoiceGroup {
  lang: string;
  /** A language callers speak (caller_languages); the rest go under "More languages". */
  primary: boolean;
  /** Your ready recorded voices first, then built-in voices. */
  voices: VoiceInfo[];
}

/** Voices by language, in the order the owner listed caller languages, then
 *  the other languages the server has voices for, by name. Recorded voices
 *  join only the caller languages they can speak, not all seventeen. */
export function voiceGroups(voices: VoiceInfo[], callerLanguages: string[]): VoiceGroup[] {
  const builtIn = new Map<string, VoiceInfo[]>();
  for (const v of voices) {
    if (v.kind === 'clone') continue;
    for (const lang of v.languages.length ? v.languages : ['en']) builtIn.set(lang, [...(builtIn.get(lang) ?? []), v]);
  }
  const clones = voices.filter((v) => v.kind === 'clone' && v.status === 'ready');
  const callers = [...new Set(callerLanguages)];
  const primary = callers.map((lang) => ({
    lang,
    primary: true,
    voices: [...clones.filter((c) => c.languages.includes(lang)), ...(builtIn.get(lang) ?? [])],
  }));
  const others = [...builtIn.keys()]
    .filter((lang) => !callers.includes(lang))
    .sort((a, b) => languageName(a).localeCompare(languageName(b)))
    .map((lang) => ({ lang, primary: false, voices: builtIn.get(lang) ?? [] }));
  return [...primary, ...others];
}

type VoicePrefs = Pick<Profile, 'voice' | 'voices_by_language'>;

/** The voice picked for a language; English falls back to the main voice. */
export const chosenVoiceId = (p: VoicePrefs, lang: string): string | undefined =>
  p.voices_by_language[lang] || (lang === 'en' ? p.voice : undefined);

/** Picking a voice for a language. English is also the main voice. */
export function choosePatch(p: VoicePrefs, lang: string, id: string): ProfilePatch {
  const byLang = { ...p.voices_by_language, [lang]: id };
  return lang === 'en' ? { voice: id, voices_by_language: byLang } : { voices_by_language: byLang };
}

/** The demo of a voice in one language (sample.wav takes ?lang=). */
export function samplePathFor(v: Pick<VoiceInfo, 'id' | 'sample_url'>, lang: string): string {
  const url = v.sample_url;
  if (!url || url.startsWith('/assistant/speak')) return voiceSamplePath(v.id, lang);
  if (/[?&]lang=/.test(url)) return url.replace(/([?&]lang=)[^&]*/, `$1${encodeURIComponent(lang)}`);
  return `${url}${url.includes('?') ? '&' : '?'}lang=${encodeURIComponent(lang)}`;
}

/** Demos worth fetching ahead of a tap. /assistant/speak is made on demand
 *  (servers without cached demos), so fetching every one ahead would keep the
 *  server busy speaking demos nobody asked for. */
export const preloadable = (path: string): boolean => !!path && !path.startsWith('/assistant/speak');

/** "My voice", or "My voice 2" when that name is taken. */
export function suggestName(existing: string[], base = 'My voice'): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export const STATUS_LABEL: Record<VoiceStatus, string> = { ready: 'Ready', preparing: 'Getting ready', failed: "Didn't work" };

/** Recorded voices that finished preparing since the last list, to announce. */
export function statusChanges(before: Map<string, VoiceStatus>, after: VoiceInfo[]): { voice: VoiceInfo; from: VoiceStatus }[] {
  return after
    .filter((v) => v.kind === 'clone' && before.get(v.id) === 'preparing' && v.status !== 'preparing')
    .map((voice) => ({ voice, from: 'preparing' as const }));
}

// ------------------------------------------------------------ demo player

export type DemoPhase = 'idle' | 'loading' | 'playing' | 'error';

export interface DemoState {
  /** Which demo the player is on (a voice and language, or a recording). */
  key: string | null;
  phase: DemoPhase;
  error: string | null;
  /** It failed or didn't start, and the app is asking the server why. Still shown as loading. */
  checking: boolean;
  /** Played again once, after the server said the demo was ready. */
  retried: boolean;
}

export const DEMO_IDLE: DemoState = { key: null, phase: 'idle', error: null, checking: false, retried: false };

export type DemoEvent =
  | { type: 'tap'; key: string }
  | { type: 'status'; playing: boolean; isBuffering: boolean; didJustFinish: boolean; error: string | null }
  | { type: 'timeout'; key: string }
  /** What asking the server found: play it again, or why it can't play. */
  | { type: 'checked'; key: string; retry: true }
  | { type: 'checked'; key: string; retry: false; error: string }
  | { type: 'fail'; key: string; error: string }
  | { type: 'stop' };

export const DEMO_TIMEOUT_MS = 10_000;

const DEMO_UNPLAYABLE = "Your server sent the demo, but this phone couldn't play it. Try again in a moment.";
const DEMO_OUTDATED =
  'Your server is still the first version, which can\'t play voice demos properly. Update it with the steps under "Updating from the first version" in the setup guide.';

/** One player for every demo: tap to play, tap the same one again to stop,
 *  tap another to switch. A demo that fails or doesn't start in time is
 *  checked with the server (still loading), then played again or explained. */
export function demoReducer(s: DemoState, e: DemoEvent): DemoState {
  switch (e.type) {
    case 'tap':
      if (s.key === e.key && (s.phase === 'loading' || s.phase === 'playing')) return DEMO_IDLE;
      return { ...DEMO_IDLE, key: e.key, phase: 'loading' };
    case 'stop':
      return DEMO_IDLE;
    case 'timeout':
      return s.key === e.key && s.phase === 'loading' && !s.checking ? { ...s, checking: true } : s;
    case 'checked':
      if (s.key !== e.key || !s.checking) return s;
      if (e.retry && !s.retried) return { ...s, checking: false, retried: true };
      return { ...s, phase: 'error', checking: false, error: e.retry ? DEMO_UNPLAYABLE : e.error };
    case 'fail':
      return s.key === e.key ? { ...s, phase: 'error', checking: false, error: e.error } : s;
    case 'status':
      if (!s.key || s.phase === 'idle' || s.phase === 'error') return s;
      // While checking, only a late start counts; the check says why it failed.
      if (s.checking) return e.playing ? { ...s, phase: 'playing', checking: false } : s;
      if (e.error) return { ...s, phase: 'loading', checking: true };
      if (s.phase === 'loading') {
        if (e.playing) return { ...s, phase: 'playing' };
        return e.didJustFinish ? DEMO_IDLE : s;
      }
      // Playing: it ends when the clip finishes or the player stops (not while buffering).
      return e.didJustFinish || (!e.playing && !e.isBuffering) ? DEMO_IDLE : s;
  }
}

export interface DemoCheckContext {
  /** The server's address, to name it when it can't be reached. */
  server: string;
  /** The server is the first version (serverOutdated). */
  outdated: boolean;
  /** The demo was already played again once. */
  retried: boolean;
}

/**
 * Turns what asking the server for a demo found into what to do: play it again
 * (once: the server has it ready now), or a message saying why it can't play.
 * null: the check was cancelled (the owner moved on).
 */
export function demoProblem(probe: MediaProbe, ctx: DemoCheckContext): { retry: true } | { retry: false; message: string } | null {
  const fail = (message: string) => ({ retry: false as const, message });
  switch (probe.kind) {
    case 'cancelled':
      return null;
    case 'unreachable':
      return fail(`Couldn't reach your server at ${ctx.server}. Check that the phone and the computer are on the same Wi-Fi and that the server is running.`);
    case 'slow':
      return fail(ctx.outdated ? DEMO_OUTDATED : 'Your server is taking too long to make this demo. It may be busy; try again in a minute.');
  }
  const { status, detail } = probe;
  if (status < 300 || status === 304) {
    if (!ctx.retried) return { retry: true };
    return fail(ctx.outdated ? DEMO_OUTDATED : DEMO_UNPLAYABLE);
  }
  if (status === 401 || status === 403) return fail("Your server didn't accept this phone's token. Pair the phone again in Settings.");
  if (status === 404) return fail(ctx.outdated ? DEMO_OUTDATED : "This voice isn't on your server any more. Pull down to refresh the list.");
  if (status === 409 || status === 503) return fail(detail || "Your server can't make this demo right now. Try again in a minute.");
  if (status >= 500) return fail(`Your server had a problem making this demo (error ${status}). Try again in a minute.`);
  return fail(`Your server turned down this demo (error ${status}).${detail ? ` ${detail}` : ''}`);
}

// ------------------------------------------------------------ recording

export const MIN_SECONDS = 8;
export const GOOD_SECONDS = 15;
/** Recording stops on its own here; longer adds nothing. */
export const MAX_SECONDS = 45;

/** Microphone metering (dB, -160 to 0) as 0 to 1 for the level meter. */
export const levelFromMetering = (db: number | undefined): number => (db == null || !Number.isFinite(db) ? 0 : Math.max(0, Math.min(1, (db + 60) / 60)));

export type Loudness = 'unknown' | 'quiet' | 'good' | 'clipping';

/** Judges a recording from its metering samples: the loudest third should be
 *  well above the room, and the peaks should not hit the top. */
export function loudness(samplesDb: number[]): Loudness {
  const valid = samplesDb.filter((x) => Number.isFinite(x) && x > -160);
  if (valid.length < 5) return 'unknown';
  const sorted = [...valid].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
  const avg = top.reduce((a, b) => a + b, 0) / top.length;
  if (avg < -35) return 'quiet';
  if (sorted.filter((x) => x > -1).length > Math.max(2, sorted.length * 0.05)) return 'clipping';
  return 'good';
}

/** What to say under the timer while recording. */
export function recordingHint(seconds: number): string {
  if (seconds < MIN_SECONDS) return 'Keep reading…';
  if (seconds < GOOD_SECONDS) return 'Good. A little more is better.';
  if (seconds < MAX_SECONDS - 5) return 'Great. Tap stop when you finish.';
  return `Stopping at ${MAX_SECONDS} seconds.`;
}

/** A problem with the take worth showing before it is saved, or null. */
export function takeProblem(seconds: number, level: Loudness): { title: string; message: string; blocking: boolean } | null {
  if (seconds < MIN_SECONDS)
    return { title: `That was ${Math.round(seconds)} seconds`, message: `Record at least ${MIN_SECONDS} seconds so it sounds like you.`, blocking: true };
  if (level === 'quiet') return { title: 'It sounds quiet', message: 'Hold the phone closer, about a hand away, and read a little louder.', blocking: false };
  if (level === 'clipping') return { title: 'It sounds too loud', message: 'Hold the phone a little further away so your voice is not distorted.', blocking: false };
  return null;
}
