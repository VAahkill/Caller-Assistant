// Mirrors backend/opencall/models.py, API contract v2 (docs: build spec
// "API contract v2"). Times are seconds since the epoch.

export type Speaker = 'caller' | 'assistant' | 'user' | 'system';
export type LineKind = 'speech' | 'hold_question' | 'alert' | 'note';

export interface TranscriptLine {
  id: string;
  speaker: Speaker;
  /** What was said, in `lang`. For speaker "user": what was spoken to the caller. */
  text: string;
  lang: string;
  /** The line in the owner's language; may arrive later via transcript_update. */
  translation: string;
  translation_lang: string;
  english: string;
  at: number;
  kind: LineKind;
}

export interface HoldQuestion {
  id: string;
  question: string;
  asked_at: number;
  answer: string | null;
  answered_at: number | null;
  sensitive: boolean;
}

export type CallStatus = 'ringing' | 'active' | 'on_hold' | 'ended' | 'rejected';
export type CallCategory = 'spam' | 'delivery' | 'contact' | 'business' | 'unknown' | (string & {});

export interface CallRecord {
  id: string;
  direction: 'inbound' | 'outbound';
  number: string;
  contact_name: string;
  category: CallCategory;
  status: CallStatus;
  language: string;
  started_at: number;
  ended_at: number | null;
  transcript: TranscriptLine[];
  holds: HoldQuestion[];
  summary: string;
  message: string;
  recording: string;
  task_id: string | null;
  reject_reason: string;
  urgent: boolean;
  action_items: string[];
  /** A practice call (/ws/simulate), not a real caller. */
  practice?: boolean;
}

/** GET /calls leaves the transcript out. */
export type CallSummary = Omit<CallRecord, 'transcript'> & { transcript?: TranscriptLine[] };

export interface CallerMessage {
  id: string;
  call_id: string;
  number: string;
  caller_name: string;
  text: string;
  created_at: number;
  status: 'new' | 'read' | 'replied';
  reply: string;
  callback_task_id: string | null;
}

export type TaskKind = 'enquire' | 'book' | 'callback' | 'custom';
export type TaskStatus = 'queued' | 'dialing' | 'in_call' | 'waiting_user' | 'done' | 'failed';

export interface Task {
  id: string;
  kind: TaskKind;
  number: string;
  goal: string;
  target_name: string;
  status: TaskStatus;
  outcome: string;
  result: string;
  call_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Location {
  lat: number | null;
  lng: number | null;
  address: string;
  building: string;
  floor_unit: string;
  landmarks: string;
  gate_instructions: string;
  geocoded_hint: string;
}

export type AppliesTo = 'everyone' | 'contacts' | 'unknown' | 'delivery' | 'numbers';

export interface Instruction {
  id: string;
  text: string;
  enabled: boolean;
  applies_to: AppliesTo;
  numbers: string[];
  category: string;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export type InstructionInput = Pick<Instruction, 'text'> &
  Partial<Pick<Instruction, 'enabled' | 'applies_to' | 'numbers' | 'category' | 'expires_at'>>;

export interface InstructionTemplate {
  category: string;
  text: string;
  applies_to: AppliesTo;
}

export type ShareWith = 'anyone' | 'contacts' | 'delivery' | 'numbers';

export interface KnowledgeNote {
  id: string;
  text: string;
  enabled: boolean;
  share_with: ShareWith;
  numbers: string[];
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export type KnowledgeInput = Pick<KnowledgeNote, 'text'> &
  Partial<Pick<KnowledgeNote, 'share_with' | 'numbers' | 'enabled' | 'expires_at'>>;

export interface Away {
  preset: string;
  /** In English, e.g. "In a meeting until 3 PM". */
  message: string;
  until: number | null;
  set_at: number;
}

export type AwayInput = Pick<Away, 'preset' | 'message' | 'until'>;

export interface Contact {
  number: string;
  name: string;
  blocked: boolean;
}

export interface Profile {
  user_name: string;
  assistant_name: string;
  enabled: boolean;
  available: boolean;
  /** ^\+[1-9]\d{0,3}$, e.g. "+91". Not a phone number. */
  home_country_code: string;
  block_international: boolean;
  answer_unknown_numbers: boolean;
  voice: string;
  blocked_prefixes: string[];
  /** Order is the prior used for language detection. */
  caller_languages: string[];
  owner_language: string;
  translate_live: boolean;
  voices_by_language: Record<string, string>;
  blocked_numbers: string[];
  vip_numbers: string[];
  away: Away | null;
  location: Location;
  instructions: Instruction[];
  knowledge: KnowledgeNote[];
  contacts: Contact[];
  push_tokens: string[];
}

export type ProfilePatch = Partial<Omit<Profile, 'location' | 'instructions' | 'knowledge' | 'contacts' | 'push_tokens'>>;

export type VoiceEngine = 'kokoro' | 'mms' | 'piper' | 'xtts' | 'parler';
export type VoiceStatus = 'ready' | 'preparing' | 'failed';

export interface VoiceInfo {
  id: string;
  name: string;
  kind: 'builtin' | 'clone';
  engine: VoiceEngine;
  languages: string[];
  gender: string;
  /** Relative, e.g. "/voices/kokoro:af_heart/sample.wav?lang=en&v=3f2a1c". */
  sample_url: string;
  recording_url: string;
  seconds: number | null;
  created_at: number | null;
  status: VoiceStatus;
  /** Why a recorded voice failed, when the server says (not in every server version). */
  detail?: string;
}

export interface ReadyFlags {
  stt: boolean;
  tts: boolean;
  llm: boolean;
  mt: boolean;
  lid: boolean;
}

export interface Health {
  ok: boolean;
  version: string;
  dialer: string;
  active_calls: number;
  /** null from servers older than v2, which don't report readiness. */
  ready: ReadyFlags | null;
  llm_model: string;
}

export type AssistantState = 'listening' | 'transcribing' | 'translating' | 'thinking' | 'speaking' | 'idle' | 'error';

/** What the owner chat changed: task_created {task}, instruction_added {text},
 *  note_added {text}, availability {available}, enabled {enabled}. Others are ignored. */
export interface ChatAction {
  type: string;
  [field: string]: unknown;
}

export interface ChatReply {
  reply: string;
  actions: ChatAction[];
}

export interface VoiceChatReply extends ChatReply {
  heard: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SayAudioReply {
  ok: boolean;
  /** What the server heard in the owner's recording. */
  heard: string;
}
