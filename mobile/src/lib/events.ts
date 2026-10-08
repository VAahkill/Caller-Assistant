// Live events from /ws/events (and the practice socket, /ws/simulate), typed
// per API contract v2, and the reducer that turns them into app state.

import { normalizeCall, normalizeLine } from './normalize';
import type { AssistantState, CallRecord, CallerMessage, Task, TranscriptLine } from './types';

interface CallEventBase {
  call_id: string;
  /** Contact name or number, for notifications. */
  who: string;
}

export type ServerEvent =
  | { event: 'call_snapshot'; call: CallRecord }
  | ({ event: 'call_started'; call: CallRecord } & CallEventBase)
  | ({ event: 'call_rejected'; call: CallRecord; reason: string } & CallEventBase)
  | ({ event: 'call_ended'; call: CallRecord } & CallEventBase)
  | ({ event: 'transcript'; line: TranscriptLine } & CallEventBase)
  | ({ event: 'transcript_update'; line_id: string; translation: string; translation_lang: string } & CallEventBase)
  | ({ event: 'assistant_status'; state: AssistantState; detail?: string } & CallEventBase)
  | ({ event: 'call_language'; language: string; confidence: number } & CallEventBase)
  | ({ event: 'turn_error'; detail: string } & CallEventBase)
  | ({ event: 'call_category'; category: string } & CallEventBase)
  | ({
      event: 'hold_question' | 'task_needs_decision';
      hold_id: string;
      question: string;
      title: string;
      task_id: string | null;
    } & CallEventBase)
  | ({ event: 'hold_resolved'; hold_id: string; answered: boolean } & CallEventBase)
  | ({ event: 'sensitive_request'; kind: string; text: string; said: string } & CallEventBase)
  | { event: 'message_taken'; message: CallerMessage; call_id: string; who: string }
  | { event: 'task_update'; task: Task; task_id: string; title: string }
  | { event: 'profile_updated' }
  /** A request the server couldn't act on; on /ws/events it names the call. */
  | { event: 'error'; detail: string; call_id?: string };

/** Only /ws/simulate sends these. */
export type SimulateEvent =
  | { event: 'started'; call_id: string }
  | { event: 'rejected'; reason: string }
  | { event: 'ack'; kind: 'text' | 'audio' | 'say' | 'say_audio' | 'answer'; seconds?: number };

export type AnyEvent = ServerEvent | SimulateEvent;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' ? v : '');

// Required fields per event; anything else is optional or defaulted.
const REQUIRED: Record<AnyEvent['event'], string[]> = {
  call_snapshot: ['call'],
  call_started: ['call'],
  call_rejected: ['call'],
  call_ended: ['call'],
  transcript: ['call_id', 'line'],
  transcript_update: ['call_id', 'line_id'],
  assistant_status: ['call_id', 'state'],
  call_language: ['call_id', 'language'],
  turn_error: ['call_id'],
  call_category: ['call_id', 'category'],
  hold_question: ['call_id', 'hold_id', 'question'],
  task_needs_decision: ['call_id', 'hold_id', 'question'],
  hold_resolved: ['call_id', 'hold_id'],
  sensitive_request: ['call_id'],
  message_taken: ['message'],
  task_update: ['task'],
  profile_updated: [],
  error: [],
  started: ['call_id'],
  rejected: [],
  ack: [],
};

export type ParseResult = { ok: true; event: AnyEvent } | { ok: false; reason: string };

/**
 * Checks one websocket message. Unknown event names are reported, not thrown,
 * so a newer server can add events without breaking an older app.
 */
export function parseEvent(data: unknown): ParseResult {
  let raw: unknown = data;
  if (typeof data === 'string') {
    try {
      raw = JSON.parse(data);
    } catch {
      return { ok: false, reason: 'not JSON' };
    }
  }
  if (!isObj(raw) || typeof raw.event !== 'string') return { ok: false, reason: 'no event name' };
  const name = raw.event as AnyEvent['event'];
  const required = REQUIRED[name];
  if (!required) return { ok: false, reason: `unknown event ${raw.event}` };
  const missing = required.filter((k) => raw[k] === undefined || raw[k] === null);
  if (missing.length) return { ok: false, reason: `${raw.event} without ${missing.join(', ')}` };

  const ev: Raw = { ...raw };
  if ('call' in ev && isObj(ev.call)) ev.call = normalizeCall(ev.call);
  if (name === 'transcript') ev.line = normalizeLine(ev.line, `${s(ev.call_id)}-${Date.now()}`);
  if (name === 'call_started' || name === 'call_ended' || name === 'call_rejected') {
    const call = ev.call as CallRecord;
    ev.call_id = s(ev.call_id) || call.id;
    ev.who = s(ev.who) || call.contact_name || call.number;
  }
  if ('call_id' in ev && name !== 'error') ev.who = s(ev.who);
  if (name === 'transcript_update') {
    ev.translation = s(ev.translation);
    ev.translation_lang = s(ev.translation_lang);
  }
  if (name === 'turn_error' || name === 'error') ev.detail = s(ev.detail) || 'Something went wrong on the server.';
  if (name === 'call_language') ev.confidence = typeof ev.confidence === 'number' ? ev.confidence : 0;
  if (name === 'sensitive_request') {
    ev.kind = s(ev.kind);
    ev.text = s(ev.text);
    ev.said = s(ev.said);
  }
  if (name === 'hold_question' || name === 'task_needs_decision') {
    ev.title = s(ev.title);
    ev.task_id = s(ev.task_id) || null;
  }
  if (name === 'hold_resolved') ev.answered = !!ev.answered;
  if (name === 'rejected') ev.reason = s(ev.reason);
  return { ok: true, event: ev as unknown as AnyEvent };
}

// ---------------------------------------------------------------- one call

export interface CallView {
  record: CallRecord;
  /** What the assistant is doing now, from assistant_status. */
  status: AssistantState;
  statusDetail: string;
  /** The caller's language, from call_language (falls back to record.language). */
  language: string;
  languageConfidence: number;
  /** Turn errors and refused owner actions, newest last. */
  errors: { at: number; detail: string }[];
}

export function callView(record: CallRecord): CallView {
  return {
    record,
    status: record.status === 'ended' || record.status === 'rejected' ? 'idle' : 'listening',
    statusDetail: '',
    language: record.language,
    languageConfidence: 0,
    errors: [],
  };
}

function upsertLine(lines: TranscriptLine[], line: TranscriptLine): TranscriptLine[] {
  const i = lines.findIndex((l) => l.id === line.id);
  if (i === -1) return [...lines, line];
  const next = lines.slice();
  // A repeat may carry the translation; never lose one already shown.
  next[i] = { ...line, translation: line.translation || lines[i].translation, translation_lang: line.translation_lang || lines[i].translation_lang };
  return next;
}

/** Applies one event for this call; returns the same object when nothing changed. */
export function reduceCall(view: CallView, ev: AnyEvent, now = Date.now() / 1000): CallView {
  const r = view.record;
  switch (ev.event) {
    case 'call_snapshot':
    case 'call_started':
      return { ...view, record: ev.call, language: ev.call.language || view.language };
    case 'call_ended':
    case 'call_rejected':
      // Keep the lines already shown if the final record arrives without them.
      return {
        ...view,
        record: { ...ev.call, transcript: ev.call.transcript.length ? ev.call.transcript : r.transcript },
        status: 'idle',
        statusDetail: '',
      };
    case 'transcript':
      return { ...view, record: { ...r, transcript: upsertLine(r.transcript, ev.line) } };
    case 'transcript_update': {
      const i = r.transcript.findIndex((l) => l.id === ev.line_id);
      if (i === -1) return view;
      const transcript = r.transcript.slice();
      transcript[i] = { ...transcript[i], translation: ev.translation, translation_lang: ev.translation_lang };
      return { ...view, record: { ...r, transcript } };
    }
    case 'assistant_status':
      return { ...view, status: ev.state, statusDetail: ev.detail ?? '' };
    case 'call_language':
      return { ...view, language: ev.language, languageConfidence: ev.confidence, record: { ...r, language: ev.language } };
    case 'turn_error':
    case 'error':
      return { ...view, errors: [...view.errors, { at: now, detail: ev.detail }].slice(-5) };
    case 'call_category':
      return { ...view, record: { ...r, category: ev.category } };
    case 'hold_question':
    case 'task_needs_decision':
      if (r.holds.some((h) => h.id === ev.hold_id)) return { ...view, record: { ...r, status: 'on_hold' } };
      return {
        ...view,
        record: {
          ...r,
          status: 'on_hold',
          holds: [...r.holds, { id: ev.hold_id, question: ev.question, asked_at: now, answer: null, answered_at: null, sensitive: false }],
        },
      };
    case 'hold_resolved':
      return { ...view, record: { ...r, status: r.status === 'on_hold' ? 'active' : r.status } };
    default:
      return view;
  }
}

// ---------------------------------------------------------------- the whole app

export interface PendingQuestion {
  callId: string;
  holdId: string;
  question: string;
  who: string;
  isTask: boolean;
  taskId: string | null;
  at: number;
}

export interface SecurityAlert {
  id: string;
  callId: string;
  who: string;
  kind: string;
  text: string;
  at: number;
}

export interface LiveData {
  calls: Record<string, CallView>;
  questions: PendingQuestion[];
  alerts: SecurityAlert[];
  tasks: Record<string, Task>;
  /** Bumps when stored lists (calls, messages, tasks, profile) may have changed. */
  refreshKey: number;
  profileKey: number;
}

export const initialLive: LiveData = { calls: {}, questions: [], alerts: [], tasks: {}, refreshKey: 0, profileKey: 0 };

export type LiveAction = { type: 'event'; event: ServerEvent; now?: number } | { type: 'dismissAlert'; id: string } | { type: 'reset' };

function withCall(state: LiveData, callId: string, ev: AnyEvent, now: number): LiveData {
  const view = state.calls[callId];
  if (!view) return state;
  const next = reduceCall(view, ev, now);
  return next === view ? state : { ...state, calls: { ...state.calls, [callId]: next } };
}

export function liveReducer(state: LiveData, action: LiveAction): LiveData {
  // A new connection: live calls come again as snapshots. Alerts stay until dismissed.
  if (action.type === 'reset') return { ...state, calls: {}, questions: [], refreshKey: state.refreshKey + 1 };
  if (action.type === 'dismissAlert') return { ...state, alerts: state.alerts.filter((a) => a.id !== action.id) };
  const ev = action.event;
  const now = action.now ?? Date.now() / 1000;
  switch (ev.event) {
    case 'call_snapshot':
    case 'call_started': {
      const prev = state.calls[ev.call.id];
      const view = prev ? reduceCall(prev, ev, now) : callView(ev.call);
      // A snapshot of a call on hold restores its unanswered questions.
      const open = ev.call.holds.filter((h) => !h.answer && !state.questions.some((q) => q.holdId === h.id));
      const who = ev.call.contact_name || ev.call.number;
      return {
        ...state,
        calls: { ...state.calls, [ev.call.id]: view },
        questions:
          ev.call.status === 'on_hold' && open.length
            ? [
                ...state.questions,
                ...open.map((h) => ({
                  callId: ev.call.id,
                  holdId: h.id,
                  question: h.question,
                  who,
                  isTask: ev.call.direction === 'outbound',
                  taskId: ev.call.task_id,
                  at: h.asked_at,
                })),
              ]
            : state.questions,
        refreshKey: ev.event === 'call_started' ? state.refreshKey + 1 : state.refreshKey,
      };
    }
    case 'call_ended':
    case 'call_rejected': {
      const { [ev.call.id]: _ended, ...calls } = state.calls;
      return {
        ...state,
        calls,
        questions: state.questions.filter((q) => q.callId !== ev.call.id),
        refreshKey: state.refreshKey + 1,
      };
    }
    case 'hold_question':
    case 'task_needs_decision': {
      const next = withCall(state, ev.call_id, ev, now);
      if (next.questions.some((q) => q.holdId === ev.hold_id)) return next;
      return {
        ...next,
        questions: [
          ...next.questions,
          {
            callId: ev.call_id,
            holdId: ev.hold_id,
            question: ev.question,
            who: ev.who,
            isTask: ev.event === 'task_needs_decision',
            taskId: ev.task_id,
            at: now,
          },
        ],
      };
    }
    case 'hold_resolved': {
      const next = withCall(state, ev.call_id, ev, now);
      return { ...next, questions: next.questions.filter((q) => q.holdId !== ev.hold_id) };
    }
    case 'sensitive_request': {
      const alert: SecurityAlert = {
        id: `${ev.call_id}-${now}-${state.alerts.length}`,
        callId: ev.call_id,
        who: ev.who,
        kind: ev.kind,
        text: ev.text,
        at: now,
      };
      return { ...withCall(state, ev.call_id, ev, now), alerts: [alert, ...state.alerts].slice(0, 20) };
    }
    case 'message_taken':
      return { ...state, refreshKey: state.refreshKey + 1 };
    case 'task_update':
      return { ...state, tasks: { ...state.tasks, [ev.task.id]: ev.task }, refreshKey: state.refreshKey + 1 };
    case 'profile_updated':
      return { ...state, profileKey: state.profileKey + 1 };
    case 'error':
      return ev.call_id ? withCall(state, ev.call_id, ev, now) : state;
    default:
      return withCall(state, ev.call_id, ev, now);
  }
}

export const ASSISTANT_STATE_LABEL: Record<AssistantState, string> = {
  listening: 'Listening',
  transcribing: 'Hearing',
  translating: 'Translating',
  thinking: 'Thinking',
  speaking: 'Speaking',
  idle: 'Waiting',
  error: 'Had a problem',
};
