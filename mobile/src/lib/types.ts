// Mirrors backend/opencall/models.py

export type Speaker = 'caller' | 'assistant' | 'user' | 'system';

export interface TranscriptLine {
  speaker: Speaker;
  text: string;
  at: number;
  kind: 'speech' | 'hold_question' | 'alert' | 'note';
}

export interface HoldQuestion {
  id: string;
  question: string;
  asked_at: number;
  answer: string | null;
}

export interface CallRecord {
  id: string;
  direction: 'inbound' | 'outbound';
  number: string;
  contact_name: string;
  category: string;
  status: 'ringing' | 'active' | 'on_hold' | 'ended' | 'rejected';
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
}

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

export interface Task {
  id: string;
  kind: TaskKind;
  number: string;
  goal: string;
  target_name: string;
  status: 'queued' | 'dialing' | 'in_call' | 'waiting_user' | 'done' | 'failed';
  outcome: string;
  result: string;
  call_id: string | null;
  created_at: number;
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

export interface Instruction {
  id: string;
  text: string;
}

export interface KnowledgeNote {
  id: string;
  text: string;
  share_with: 'anyone' | 'contacts';
}

export interface Profile {
  user_name: string;
  assistant_name: string;
  enabled: boolean;
  available: boolean;
  home_country_code: string;
  block_international: boolean;
  answer_unknown_numbers: boolean;
  voice: string;
  location: Location;
  instructions: Instruction[];
  knowledge: KnowledgeNote[];
}

export interface Voice {
  id: string;
  name: string;
  kind: 'builtin' | 'clone';
  languages: string[];
  gender: string;
}

export type ServerEvent =
  | { event: 'call_started' | 'call_snapshot' | 'call_ended'; call: CallRecord; call_id?: string }
  | { event: 'call_rejected'; call: CallRecord; reason: string }
  | { event: 'transcript'; call_id: string; line: TranscriptLine }
  | { event: 'hold_question' | 'task_needs_decision'; call_id: string; hold_id: string; question: string; who: string; task_id?: string }
  | { event: 'hold_resolved'; call_id: string; hold_id: string; answered: boolean }
  | { event: 'sensitive_request'; call_id: string; kind: string; text: string; who: string }
  | { event: 'call_category'; call_id: string; category: string }
  | { event: 'message_taken'; message: CallerMessage; who: string }
  | { event: 'task_update'; task: Task; title: string }
  | { event: 'profile_updated' };
