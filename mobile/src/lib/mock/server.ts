// An in-memory OpenCall server speaking API contract v2. Mock mode
// (EXPO_PUBLIC_OPENCALL_MOCK=1) and tests use it in place of the network.

import { normalizeProfile } from '../normalize';
import { normalizeNumber } from '../phone';
import type {
  Transport,
  RequestInitLike,
  ResponseLike,
  SocketLike,
  UploadRequest,
  UploadResultLike,
} from '../transport';
import type { CallRecord, Instruction, KnowledgeNote, Profile, Task, VoiceInfo } from '../types';
import { createFixtures, type MockState } from './fixtures';
import { MockEventsSocket, MockSimulateSocket, ownerTurn } from './socket';

export const MOCK_TOKEN = 'demo-token';

export interface MockOptions {
  /** Delay before each answer, so spinners show in development. */
  latencyMs?: number;
  state?: MockState;
  /** Accept any token (mock mode) or only MOCK_TOKEN (tests of the 401 path). */
  checkToken?: boolean;
}

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  form: FormData | null;
}

export interface MockReply {
  status: number;
  body: unknown;
}

const ok = (body: unknown): MockReply => ({ status: 200, body });
const notFound = (detail = 'Not Found'): MockReply => ({ status: 404, body: { detail } });
const unprocessable = (detail: string): MockReply => ({ status: 422, body: { detail } });

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;
const nowS = () => Date.now() / 1000;

const PROFILE_PATCH_KEYS: (keyof Profile)[] = [
  'user_name',
  'assistant_name',
  'enabled',
  'available',
  'home_country_code',
  'block_international',
  'answer_unknown_numbers',
  'voice',
  'blocked_prefixes',
  'caller_languages',
  'owner_language',
  'translate_live',
  'voices_by_language',
  'blocked_numbers',
  'vip_numbers',
  'away',
];

const COUNTRY_CODE = /^\+[1-9]\d{0,3}$/;

export class MockServer {
  state: MockState;
  /** Every request, for tests. */
  log: MockRequest[] = [];
  readonly latencyMs: number;
  readonly checkToken: boolean;
  /** Open /ws/events sockets: REST actions on a live call show up on them. */
  readonly liveSockets = new Set<{ push: (ev: Record<string, unknown>, after: number) => void }>();
  /** How many GET /voices answers a recorded voice stays "preparing" for
   *  before it turns ready (null: it stays preparing). */
  readyAfterPolls: number | null = 2;
  private polls = new Map<string, number>();

  constructor({ latencyMs = 0, state, checkToken = false }: MockOptions = {}) {
    this.state = state ?? createFixtures();
    this.latencyMs = latencyMs;
    this.checkToken = checkToken;
  }

  /** Plays the owner's words into the live call, on every open events socket. */
  private ownerAction(call: CallRecord, msg: Record<string, unknown>) {
    const all = { push: (ev: Record<string, unknown>, after: number) => this.liveSockets.forEach((sk) => sk.push(ev, after)) };
    ownerTurn(all, call, msg, this.latencyMs ? 400 : 0);
  }

  handle(req: MockRequest, token: string | null): MockReply {
    this.log.push(req);
    const { method, path } = req;
    const open = path === '/health' || path === '/pair/start' || path === '/pair/finish';
    if (!open && this.checkToken && token !== MOCK_TOKEN) return { status: 401, body: { detail: 'bad token' } };
    const s = this.state;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
    const literal = `${method} /${seg.join('/')}`;
    const route = STATIC_ROUTES.has(literal) ? literal : `${method} /${seg.map((x, i) => (isParam(seg[0], i) ? ':id' : x)).join('/')}`;
    const id = seg[0] === 'contacts' ? seg[2] : seg[1];

    switch (route) {
      case 'GET /health':
        return ok({ ...s.health, active_calls: s.calls.filter((c) => !c.ended_at && c.status !== 'rejected').length });
      case 'GET /profile':
        return ok(s.profile);
      case 'PATCH /profile': {
        if (typeof body.home_country_code === 'string' && !COUNTRY_CODE.test(body.home_country_code)) {
          return { status: 422, body: { detail: [{ loc: ['body', 'home_country_code'], msg: 'String should match pattern' }] } };
        }
        const patch = Object.fromEntries(Object.entries(body).filter(([k, v]) => PROFILE_PATCH_KEYS.includes(k as keyof Profile) && v !== null));
        s.profile = normalizeProfile({ ...s.profile, ...patch });
        return ok(s.profile);
      }
      case 'PUT /away':
        if (typeof body.message !== 'string' || !body.message.trim()) return unprocessable('Say what to tell callers.');
        s.profile = {
          ...s.profile,
          away: { preset: String(body.preset ?? 'custom'), message: body.message, until: typeof body.until === 'number' ? body.until : null, set_at: nowS() },
        };
        return ok(s.profile);
      case 'DELETE /away':
        s.profile = { ...s.profile, away: null };
        return ok(s.profile);
      case 'PUT /location':
        s.profile = { ...s.profile, location: { ...(body as unknown as Profile['location']), geocoded_hint: s.profile.location.geocoded_hint || 'Kondapur, Hyderabad' } };
        return ok(s.profile.location);
      case 'POST /location/from-link': {
        const m = /@?(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(String(body.text ?? ''));
        return m ? ok({ lat: Number(m[1]), lng: Number(m[2]) }) : unprocessable("Couldn't find a location in that link.");
      }
      case 'GET /instructions/templates':
        return ok(s.templates);
      case 'POST /instructions': {
        const text = String(body.text ?? '').trim();
        if (!text) return unprocessable('Write the instruction first.');
        const at = nowS();
        const ins: Instruction = {
          id: newId('ins'),
          text,
          enabled: body.enabled !== false,
          applies_to: (body.applies_to as Instruction['applies_to']) ?? 'everyone',
          numbers: (body.numbers as string[]) ?? [],
          category: (body.category as string) ?? 'general',
          expires_at: (body.expires_at as number | null) ?? null,
          created_at: at,
          updated_at: at,
        };
        s.profile = { ...s.profile, instructions: [...s.profile.instructions, ins] };
        return ok(ins);
      }
      case 'PATCH /instructions/:id': {
        const found = s.profile.instructions.find((i) => i.id === id);
        if (!found) return notFound();
        const next = { ...found, ...pick(body, ['text', 'enabled', 'applies_to', 'numbers', 'category', 'expires_at']), updated_at: nowS() } as Instruction;
        s.profile = { ...s.profile, instructions: s.profile.instructions.map((i) => (i.id === id ? next : i)) };
        return ok(next);
      }
      case 'DELETE /instructions/:id':
        s.profile = { ...s.profile, instructions: s.profile.instructions.filter((i) => i.id !== id) };
        return ok({ ok: true });
      case 'POST /knowledge': {
        const text = String(body.text ?? '').trim();
        if (!text) return unprocessable('Write the note first.');
        const at = nowS();
        const note: KnowledgeNote = {
          id: newId('note'),
          text,
          enabled: body.enabled !== false,
          share_with: (body.share_with as KnowledgeNote['share_with']) ?? 'contacts',
          numbers: (body.numbers as string[]) ?? [],
          expires_at: (body.expires_at as number | null) ?? null,
          created_at: at,
          updated_at: at,
        };
        s.profile = { ...s.profile, knowledge: [...s.profile.knowledge, note] };
        return ok(note);
      }
      case 'PATCH /knowledge/:id': {
        const found = s.profile.knowledge.find((k) => k.id === id);
        if (!found) return notFound();
        const next = { ...found, ...pick(body, ['text', 'enabled', 'share_with', 'numbers', 'expires_at']), updated_at: nowS() } as KnowledgeNote;
        s.profile = { ...s.profile, knowledge: s.profile.knowledge.map((k) => (k.id === id ? next : k)) };
        return ok(next);
      }
      case 'DELETE /knowledge/:id':
        s.profile = { ...s.profile, knowledge: s.profile.knowledge.filter((k) => k.id !== id) };
        return ok({ ok: true });
      case 'PUT /contacts': {
        const list = Array.isArray(req.body) ? (req.body as { number: string; name: string }[]) : [];
        s.profile = { ...s.profile, contacts: list.map((c) => ({ number: c.number, name: c.name ?? '', blocked: false })) };
        return ok({ count: list.length });
      }
      case 'POST /contacts/block': {
        const n = String(body.number ?? '');
        if (!n) return unprocessable('Which number?');
        if (!s.profile.blocked_numbers.includes(n)) s.profile = { ...s.profile, blocked_numbers: [...s.profile.blocked_numbers, n] };
        return ok(s.profile);
      }
      case 'DELETE /contacts/block/:id':
        s.profile = { ...s.profile, blocked_numbers: s.profile.blocked_numbers.filter((n) => n !== id) };
        return ok(s.profile);
      case 'POST /push/register':
        return ok({ ok: true });
      case 'GET /calls': {
        const limit = Number(req.query.get('limit') ?? 50);
        return ok(s.calls.slice(0, limit).map(({ transcript: _t, ...rest }) => rest));
      }
      case 'GET /calls/:id': {
        const c = s.calls.find((x) => x.id === id);
        return c ? ok(c) : notFound();
      }
      case 'POST /calls/:id/answer':
      case 'POST /calls/:id/say':
      case 'POST /calls/:id/say-audio':
      case 'POST /calls/:id/end': {
        const c = s.calls.find((x) => x.id === id);
        if (!c || c.ended_at) return notFound('call is not live');
        if (route.endsWith('/end')) {
          c.ended_at = nowS();
          return ok({ ok: true });
        }
        const text = String(body.text ?? '').trim();
        if (!route.endsWith('/say-audio') && !text) return unprocessable('Nothing was said: the text was empty.');
        const action = route.endsWith('/say-audio') ? 'say_audio' : route.endsWith('/answer') ? 'answer' : 'say';
        this.ownerAction(c, { action, text, hold_id: body.hold_id ?? null });
        if (action === 'say_audio') return ok({ ok: true, heard: 'Please leave it with security at Gate 2.' });
        if (action === 'answer') return ok({ ok: true, mode: body.hold_id ? 'hold_answer' : 'said' });
        return ok({ ok: true });
      }
      case 'GET /messages':
        return ok(s.messages);
      case 'POST /messages/:id/read':
      case 'POST /messages/:id/reply': {
        const m = s.messages.find((x) => x.id === id);
        if (!m) return notFound();
        if (route.endsWith('/read') && m.status === 'new') m.status = 'read';
        if (route.endsWith('/reply')) {
          m.status = 'replied';
          m.reply = String(body.text ?? '');
        }
        return ok(m);
      }
      case 'GET /tasks':
        return ok(s.tasks);
      case 'POST /tasks': {
        const at = nowS();
        const task: Task = {
          id: newId('task'),
          kind: (body.kind as Task['kind']) ?? 'enquire',
          // Like the server: stored in full international form.
          number: normalizeNumber(String(body.number ?? ''), s.profile.home_country_code),
          goal: String(body.goal ?? ''),
          target_name: String(body.target_name ?? ''),
          status: 'queued',
          outcome: '',
          result: '',
          call_id: null,
          created_at: at,
          updated_at: at,
        };
        if (!task.number || !task.goal) return unprocessable('A number and a goal are needed.');
        s.tasks = [task, ...s.tasks];
        if (this.latencyMs) this.playTask(task.id);
        return ok(task);
      }
      case 'POST /assistant/chat': {
        const text = String(body.text ?? '').trim();
        if (!text) return unprocessable('Say something first.');
        return ok(chatReply(text, s));
      }
      case 'POST /assistant/voice':
        return ok({ heard: 'Who called while I was in the meeting?', ...chatReply('who called', s) });
      case 'GET /voices':
        this.advanceVoices();
        return ok([...s.voices.filter((v) => v.kind === 'clone'), ...s.voices.filter((v) => v.kind !== 'clone')]);
      case 'PATCH /voices/:id': {
        const v = s.voices.find((x) => x.id === id);
        if (!v) return notFound();
        if (v.kind !== 'clone') return unprocessable('Only your own voices can be renamed.');
        v.name = String(body.label ?? v.name);
        return ok(v);
      }
      case 'DELETE /voices/:id': {
        if (!s.voices.some((v) => v.id === id && v.kind === 'clone')) return { status: 404, body: { detail: 'No such recorded voice.' } };
        s.voices = s.voices.filter((v) => v.id !== id);
        // Like the server: wherever the voice was in use, the default takes over.
        const byLang = Object.fromEntries(Object.entries(s.profile.voices_by_language).filter(([, v]) => v !== id));
        s.profile = { ...s.profile, voice: s.profile.voice === id ? 'kokoro:af_heart' : s.profile.voice, voices_by_language: byLang };
        return ok({ ok: true });
      }
      case 'POST /pair/start':
        return ok({ ok: true, expires_in: 300 });
      case 'POST /pair/finish':
        return String(body.code ?? '') === '482913'
          ? ok({ token: MOCK_TOKEN })
          : { status: 403, body: { detail: "That code didn't match. Check the server log for the latest one." } };
      default:
        return notFound();
    }
  }

  /** Moves a call task on, as the server's TaskManager does, and says so on
   *  the events socket (task_update). */
  advanceTask(id: string, status: Task['status'], patch: Partial<Task> = {}): Task | null {
    const found = this.state.tasks.find((t) => t.id === id);
    if (!found) return null;
    const task: Task = { ...found, ...patch, status, updated_at: nowS() };
    this.state.tasks = this.state.tasks.map((t) => (t.id === id ? task : t));
    const who = task.target_name || task.number;
    const title =
      status === 'dialing' ? `Calling ${who}...` : status === 'in_call' ? `Connected to ${who}` : `${who}: ${task.result || status}`;
    this.liveSockets.forEach((sk) => sk.push({ event: 'task_update', task, task_id: id, title }, 0));
    return task;
  }

  /** Mock mode: a new task dials, talks and reports back over a few seconds. */
  private playTask(id: string) {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task) return;
    const booking = task.kind === 'book';
    const steps: [number, Task['status'], Partial<Task>][] = [
      [1500, 'dialing', {}],
      [4500, 'in_call', {}],
      [
        11000,
        'done',
        booking
          ? { outcome: 'booked', result: 'Booked. They confirmed the table and the time, under your name.' }
          : { outcome: 'available', result: 'They answered: it is on its way and should arrive by 6 PM today.' },
      ],
    ];
    for (const [ms, status, patch] of steps) setTimeout(() => this.advanceTask(id, status, patch), ms);
  }

  /** Each list of voices brings preparing ones closer to ready, and says so on
   *  the events socket (voice_status), like the server does when it finishes. */
  private advanceVoices() {
    if (this.readyAfterPolls == null) return;
    for (const v of this.state.voices) {
      if (v.status !== 'preparing') continue;
      const seen = (this.polls.get(v.id) ?? 0) + 1;
      this.polls.set(v.id, seen);
      if (seen <= this.readyAfterPolls - 1) continue;
      v.status = 'ready';
      this.polls.delete(v.id);
      this.liveSockets.forEach((sk) => sk.push({ event: 'voice_status', voice_id: v.id, status: 'ready', detail: '' }, 0));
    }
  }

  /** POST /voices (multipart label + audio). */
  addVoice(label: string, seconds = 12.4): MockReply {
    const name = label.trim();
    if (!name) return unprocessable('Give the voice a name.');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voice';
    const vid = `clone:${slug}-${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;
    const voice: VoiceInfo = {
      id: vid,
      name,
      kind: 'clone',
      engine: 'xtts',
      languages: ['en', 'hi'],
      gender: '',
      sample_url: `/voices/${encodeURIComponent(vid)}/sample.wav?lang=en&v=000001`,
      recording_url: `/voices/${encodeURIComponent(vid)}/recording`,
      seconds,
      created_at: nowS(),
      status: 'preparing',
    };
    this.state.voices = [voice, ...this.state.voices];
    return ok(voice);
  }
}

// Two-part paths with no parameter in them.
const STATIC_ROUTES = new Set([
  'GET /instructions/templates',
  'POST /contacts/block',
  'POST /location/from-link',
  'POST /pair/start',
  'POST /pair/finish',
  'POST /push/register',
  'POST /assistant/chat',
  'POST /assistant/voice',
]);

function isParam(root: string, index: number): boolean {
  // /contacts/block/{number} has its parameter third; the rest have it second.
  return root === 'contacts' ? index === 2 : index === 1;
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

/** Like the real owner chat: a reply, and what it changed (API contract v2 actions). */
function chatReply(text: string, s: MockState): { reply: string; actions: Record<string, unknown>[] } {
  const t = text.toLowerCase();
  const at = nowS();
  if (/\b(book|reserve|ask|find out)\b/.test(t) && /\bcall\b/.test(t)) {
    const paradise = /paradise/.test(t);
    const task: Task = {
      id: newId('task'),
      kind: /book|reserve/.test(t) ? 'book' : 'enquire',
      number: paradise ? '+914023456789' : '+914000000000',
      goal: text,
      target_name: paradise ? 'Paradise Biryani' : '',
      status: 'queued',
      outcome: '',
      result: '',
      call_id: null,
      created_at: at,
      updated_at: at,
    };
    s.tasks = [task, ...s.tasks];
    return { reply: `Calling ${task.target_name || 'them'} now. I'll tell you how it goes.`, actions: [{ type: 'task_created', task }] };
  }
  if (/who|missed|called/.test(t)) {
    const today = s.calls.filter((c) => c.direction === 'inbound' && c.status !== 'rejected').slice(0, 3);
    return {
      reply: `Today: ${today.map((c) => c.contact_name || c.number).join(', ')}. Amma wants a call back about Sunday lunch, and Rajesh asked for a call before 11 tomorrow.`,
      actions: [],
    };
  }
  if (/meeting|busy|away/.test(t)) {
    s.profile = { ...s.profile, available: false };
    return { reply: "Done. I'll tell callers you're in a meeting until 3 PM and take messages.", actions: [{ type: 'availability', available: false }] };
  }
  if (/\b(tell|always|never|ask)\b/.test(t)) {
    const ins: Instruction = {
      id: newId('ins'),
      text,
      enabled: true,
      applies_to: /courier|deliver|parcel/.test(t) ? 'delivery' : 'everyone',
      numbers: [],
      category: 'general',
      expires_at: null,
      created_at: at,
      updated_at: at,
    };
    s.profile = { ...s.profile, instructions: [...s.profile.instructions, ins] };
    return { reply: "Got it. I'll do that on every call it applies to.", actions: [{ type: 'instruction_added', text }] };
  }
  if (/\b(turn off|switch off|stop answering)\b/.test(t)) {
    s.profile = { ...s.profile, enabled: false };
    return { reply: "I've stopped answering. Calls ring through as usual.", actions: [{ type: 'enabled', enabled: false }] };
  }
  const note: KnowledgeNote = { id: newId('note'), text, enabled: true, share_with: 'anyone', numbers: [], expires_at: null, created_at: at, updated_at: at };
  s.profile = { ...s.profile, knowledge: [...s.profile.knowledge, note] };
  return { reply: "Got it. I'll keep that in mind on your calls.", actions: [{ type: 'note_added', text }] };
}

// ---------------------------------------------------------------- transport

class Reply implements ResponseLike {
  constructor(
    readonly status: number,
    private readonly payload: unknown,
  ) {}
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  async json() {
    return this.payload;
  }
  async text() {
    return JSON.stringify(this.payload);
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseUrl(url: string): { path: string; query: URLSearchParams } {
  const m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)?(\?[^#]*)?/i.exec(url);
  return { path: m?.[1] || '/', query: new URLSearchParams(m?.[2]?.slice(1) ?? '') };
}

export function mockTransport(server: MockServer = new MockServer({ latencyMs: 350 })): Transport & { server: MockServer } {
  const tokenOf = (headers?: Record<string, string>) => headers?.Authorization?.replace(/^Bearer /, '') ?? null;
  return {
    server,
    fetch: async (url: string, init: RequestInitLike = {}) => {
      if (server.latencyMs) await wait(server.latencyMs);
      const { path, query } = parseUrl(url);
      const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
      let body: unknown = null;
      if (typeof init.body === 'string') body = JSON.parse(init.body);
      const req: MockRequest = { method: (init.method ?? 'GET').toUpperCase(), path, query, body, form: isForm ? (init.body as FormData) : null };
      const reply = server.handle(req, tokenOf(init.headers));
      return new Reply(reply.status, reply.body);
    },
    openSocket: (url: string): SocketLike => {
      const { path, query } = parseUrl(url);
      if (server.checkToken && query.get('token') !== MOCK_TOKEN) return MockEventsSocket.refused();
      if (path === '/ws/simulate') return new MockSimulateSocket(server, query);
      return new MockEventsSocket(server);
    },
    upload: async (req: UploadRequest): Promise<UploadResultLike> => {
      for (const f of [0.25, 0.5, 0.75, 1]) {
        if (server.latencyMs) await wait(server.latencyMs / 2);
        req.onProgress?.(f);
      }
      if (server.checkToken && tokenOf(req.headers) !== MOCK_TOKEN) return { status: 401, body: '{"detail":"bad token"}' };
      const reply = server.addVoice(req.parameters.label ?? '');
      server.log.push({ method: 'POST', path: '/voices', query: new URLSearchParams(), body: req.parameters, form: null });
      return { status: reply.status, body: JSON.stringify(reply.body) };
    },
  };
}
