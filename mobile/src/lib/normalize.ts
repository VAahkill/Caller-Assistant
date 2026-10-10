// The v2 API is additive: a server that has not been updated yet sends the
// older shapes. These fill in the v2 fields with the documented defaults so
// screens can rely on them, whichever server version answers.

import { isPracticeNumber } from './practiceCalls';
import type {
  CallRecord,
  CallSummary,
  Health,
  HoldQuestion,
  Profile,
  ReadyFlags,
  Task,
  TranscriptLine,
  VoiceEngine,
  VoiceInfo,
} from './types';

type Loose<T> = { [K in keyof T]?: unknown };
type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const strings = (v: unknown, d: string[] = []): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : d;

export const DEFAULT_CALLER_LANGUAGES = ['en', 'hi', 'te', 'ta'];

export function normalizeProfile(raw: unknown): Profile {
  const p = (isObj(raw) ? raw : {}) as Loose<Profile> & { languages?: unknown };
  // v1 kept an unused `languages` list; v2 replaces it with caller_languages.
  const legacy = strings(p.languages);
  const callerLanguages = strings(p.caller_languages, legacy.length ? legacy : DEFAULT_CALLER_LANGUAGES);
  const away = isObj(p.away)
    ? {
        preset: str(p.away.preset),
        message: str(p.away.message),
        until: numOrNull(p.away.until),
        set_at: num(p.away.set_at, 0),
      }
    : null;
  return {
    ...(p as unknown as Profile),
    user_name: str(p.user_name),
    assistant_name: str(p.assistant_name, 'Ava'),
    enabled: bool(p.enabled, true),
    available: bool(p.available, false),
    home_country_code: str(p.home_country_code, '+91'),
    block_international: bool(p.block_international, true),
    answer_unknown_numbers: bool(p.answer_unknown_numbers, true),
    voice: str(p.voice),
    blocked_prefixes: strings(p.blocked_prefixes),
    caller_languages: callerLanguages.length ? callerLanguages : DEFAULT_CALLER_LANGUAGES,
    owner_language: str(p.owner_language, 'en') || 'en',
    translate_live: bool(p.translate_live, true),
    voices_by_language: isObj(p.voices_by_language)
      ? Object.fromEntries(Object.entries(p.voices_by_language).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {},
    blocked_numbers: strings(p.blocked_numbers),
    vip_numbers: strings(p.vip_numbers),
    away,
    location: (isObj(p.location) ? p.location : emptyLocation()) as Profile['location'],
    instructions: (Array.isArray(p.instructions) ? p.instructions : []).map((i: Raw, n: number) => ({
      ...i,
      id: str(i.id, `instruction-${n}`),
      text: str(i.text),
      enabled: bool(i.enabled, true),
      applies_to: (str(i.applies_to, 'everyone') || 'everyone') as Profile['instructions'][number]['applies_to'],
      numbers: strings(i.numbers),
      category: str(i.category, 'general') || 'general',
      expires_at: numOrNull(i.expires_at),
      created_at: num(i.created_at, 0),
      updated_at: num(i.updated_at, num(i.created_at, 0)),
    })),
    knowledge: (Array.isArray(p.knowledge) ? p.knowledge : []).map((k: Raw, n: number) => ({
      ...k,
      id: str(k.id, `note-${n}`),
      text: str(k.text),
      enabled: bool(k.enabled, true),
      share_with: (str(k.share_with, 'contacts') || 'contacts') as Profile['knowledge'][number]['share_with'],
      numbers: strings(k.numbers),
      expires_at: numOrNull(k.expires_at),
      created_at: num(k.created_at, 0),
      updated_at: num(k.updated_at, num(k.created_at, 0)),
    })),
    contacts: Array.isArray(p.contacts) ? (p.contacts as Profile['contacts']) : [],
    push_tokens: strings(p.push_tokens),
  };
}

export function emptyLocation(): Profile['location'] {
  return {
    lat: null,
    lng: null,
    address: '',
    building: '',
    floor_unit: '',
    landmarks: '',
    gate_instructions: '',
    geocoded_hint: '',
  };
}

export function normalizeLine(raw: unknown, fallbackId: string): TranscriptLine {
  const l = (isObj(raw) ? raw : {}) as Loose<TranscriptLine>;
  const speaker = str(l.speaker, 'system');
  return {
    id: str(l.id) || fallbackId,
    speaker: (['caller', 'assistant', 'user', 'system'].includes(speaker) ? speaker : 'system') as TranscriptLine['speaker'],
    text: str(l.text),
    lang: str(l.lang),
    translation: str(l.translation),
    translation_lang: str(l.translation_lang),
    english: str(l.english),
    at: num(l.at, 0),
    kind: (str(l.kind, 'speech') || 'speech') as TranscriptLine['kind'],
  };
}

/** A hold the server marks resolved (resolved_at, or timed_out) counts as
 *  answered: nobody is waiting on it any more. */
function normalizeHold(raw: Raw): HoldQuestion {
  const answeredAt = numOrNull(raw.answered_at) ?? numOrNull(raw.resolved_at) ?? (raw.timed_out === true ? num(raw.asked_at, 0) || 1 : null);
  return {
    ...(raw as unknown as HoldQuestion),
    id: str(raw.id),
    question: str(raw.question),
    asked_at: num(raw.asked_at, 0),
    answer: typeof raw.answer === 'string' ? raw.answer : null,
    answered_at: answeredAt,
    sensitive: !!raw.sensitive,
  };
}

export function normalizeCall(raw: unknown): CallRecord {
  const c = (isObj(raw) ? raw : {}) as Loose<CallRecord>;
  const id = str(c.id);
  return {
    ...(c as unknown as CallRecord),
    id,
    number: str(c.number),
    contact_name: str(c.contact_name),
    category: str(c.category, 'unknown') || 'unknown',
    language: str(c.language),
    started_at: num(c.started_at, 0),
    ended_at: numOrNull(c.ended_at),
    summary: str(c.summary),
    message: str(c.message),
    recording: str(c.recording),
    reject_reason: str(c.reject_reason),
    transcript: (Array.isArray(c.transcript) ? c.transcript : []).map((l, i) => normalizeLine(l, `${id}-${i}`)),
    holds: Array.isArray(c.holds) ? (c.holds as Raw[]).map(normalizeHold) : [],
    urgent: bool(c.urgent, false),
    action_items: strings(c.action_items),
    // Set only on practice calls, so a real call's record keeps its shape.
    ...(c.practice === true || (c as { simulated?: unknown }).simulated === true || isPracticeNumber(str(c.number)) ? { practice: true } : {}),
  } as CallRecord;
}

export function normalizeCallSummary(raw: unknown): CallSummary {
  const call = normalizeCall(raw);
  if (!(isObj(raw) && Array.isArray(raw.transcript))) delete (call as CallSummary).transcript;
  return call;
}

const ENGINES: VoiceEngine[] = ['kokoro', 'mms', 'piper', 'xtts', 'parler'];

// A short line in each language for servers that can't serve cached demos yet.
const SAMPLE_LINE: Record<string, string> = {
  en: "Hello, I'm answering calls for you today. How can I help?",
  hi: 'नमस्ते, आज आपकी कॉल मैं संभाल रही हूँ। मैं कैसे मदद करूँ?',
  te: 'నమస్తే, ఈ రోజు మీ కాల్స్ నేను చూసుకుంటున్నాను. ఎలా సహాయం చేయగలను?',
  ta: 'வணக்கம், இன்று உங்கள் அழைப்புகளை நான் கவனிக்கிறேன். எப்படி உதவலாம்?',
};

export function voiceSamplePath(id: string, lang: string): string {
  const text = SAMPLE_LINE[lang] ?? SAMPLE_LINE.en;
  return `/assistant/speak?voice=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
}

export function normalizeVoice(raw: unknown): VoiceInfo {
  const v = (isObj(raw) ? raw : {}) as Loose<VoiceInfo>;
  const id = str(v.id);
  const prefix = id.split(':')[0] as VoiceEngine;
  const kind = str(v.kind) === 'clone' ? 'clone' : 'builtin';
  const languages = strings(v.languages, ['en']);
  return {
    id,
    name: str(v.name, id),
    kind,
    engine: (ENGINES.includes(v.engine as VoiceEngine) ? v.engine : ENGINES.includes(prefix) ? prefix : kind === 'clone' ? 'xtts' : 'kokoro') as VoiceEngine,
    languages,
    gender: str(v.gender),
    sample_url: str(v.sample_url) || voiceSamplePath(id, languages[0] ?? 'en'),
    recording_url: str(v.recording_url),
    seconds: numOrNull(v.seconds),
    created_at: numOrNull(v.created_at),
    status: (['ready', 'preparing', 'failed'].includes(str(v.status)) ? v.status : 'ready') as VoiceInfo['status'],
    ...(str(v.detail) ? { detail: str(v.detail) } : {}),
  };
}

export function normalizeHealth(raw: unknown): Health {
  const h = (isObj(raw) ? raw : {}) as Loose<Health>;
  const r = isObj(h.ready) ? h.ready : null;
  const ready: ReadyFlags | null = r
    ? { stt: !!r.stt, tts: !!r.tts, llm: !!r.llm, mt: !!r.mt, lid: !!r.lid }
    : null;
  return {
    ok: bool(h.ok, false),
    version: str(h.version),
    dialer: str(h.dialer, 'none'),
    active_calls: num(h.active_calls, 0),
    ready,
    llm_model: str(h.llm_model),
  };
}

const TASK_STATUSES: Task['status'][] = ['queued', 'dialing', 'in_call', 'waiting_user', 'done', 'failed'];
const TASK_KINDS: Task['kind'][] = ['enquire', 'book', 'callback', 'custom'];

/** A call task from GET /tasks, POST /tasks or a task_update event. */
export function normalizeTask(raw: unknown): Task {
  const t = (isObj(raw) ? raw : {}) as Loose<Task>;
  const created = num(t.created_at, 0);
  return {
    id: str(t.id),
    kind: TASK_KINDS.includes(t.kind as Task['kind']) ? (t.kind as Task['kind']) : 'custom',
    number: str(t.number),
    goal: str(t.goal),
    target_name: str(t.target_name),
    status: TASK_STATUSES.includes(t.status as Task['status']) ? (t.status as Task['status']) : 'queued',
    outcome: str(t.outcome),
    result: str(t.result),
    call_id: str(t.call_id) || null,
    created_at: created,
    updated_at: num(t.updated_at, created),
  };
}
