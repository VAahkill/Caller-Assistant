import { File } from 'expo-file-system';

import {
  normalizeCall,
  normalizeCallSummary,
  normalizeHealth,
  normalizeProfile,
  normalizeVoice,
} from './normalize';
import { dialerName } from './format';
import { storage } from './storage';
import { getTransport, MOCK_MODE, type ResponseLike } from './transport';
import type {
  Away,
  AwayInput,
  CallRecord,
  CallSummary,
  CallerMessage,
  ChatReply,
  ChatTurn,
  Health,
  Instruction,
  InstructionInput,
  InstructionTemplate,
  KnowledgeInput,
  KnowledgeNote,
  Location,
  Profile,
  ProfilePatch,
  SayAudioReply,
  Task,
  TaskKind,
  VoiceChatReply,
  VoiceInfo,
} from './types';

export { phoneFromText } from './format';

// Where the self-hosted backend lives (e.g. a Cloudflare Tunnel URL) and the
// shared token from OPENCALL_API_TOKEN. Both are kept in the device keystore.
export interface ServerConfig {
  url: string;
  token: string;
}

const CONFIG_KEY = 'server';

/** Mock mode starts already connected to the in-memory demo server. */
export const MOCK_CONFIG: ServerConfig = { url: 'https://demo.opencall.invalid', token: 'demo-token' };

let config: ServerConfig | null = null;

export const isServerUrl = (url: string) => /^https?:\/\/(\[[0-9a-f:.]+\]|[^\s/?#:\[\]]+)(:\d{1,5})?(\/\S*)?$/i.test(url);

// Home addresses (an IP, a one-word name, .local, Tailscale) default to http://,
// anything else, such as a tunnel, to https://.
const isHomeHost = (host: string) => /^(\d{1,3}(\.\d{1,3}){3}|[^.]+|.+\.(local|lan|home\.arpa|ts\.net))$/i.test(host);

// Turns what was typed into a base address like http://192.168.1.7:8000, or null
// if it can't be one. A pasted health-check link works too.
export function normalizeServerUrl(typed: string): string | null {
  let url = typed.trim().replace(/\/+$/, '').replace(/\/health$/i, '');
  if (!url) return null;
  const scheme = /^https?(?=:\/\/)/i.exec(url);
  url = scheme
    ? scheme[0].toLowerCase() + url.slice(scheme[0].length)
    : `${isHomeHost(url.split(/[/:]/)[0]) ? 'http' : 'https'}://${url}`;
  return isServerUrl(url) ? url : null;
}

export async function loadConfig(): Promise<ServerConfig | null> {
  if (config) return config;
  const raw = await storage.get(CONFIG_KEY);
  let saved: ServerConfig | null = null;
  if (raw) {
    try {
      saved = JSON.parse(raw) as ServerConfig;
    } catch (e) {
      console.warn('The saved server settings were unreadable; set them up again in Settings.', e);
    }
  }
  // Older versions could save an empty or malformed address; treat that as not set up.
  config = saved && typeof saved.url === 'string' && isServerUrl(saved.url) ? saved : MOCK_MODE ? MOCK_CONFIG : null;
  return config;
}

/** The config already loaded, without waiting (null before loadConfig resolves). */
export const currentConfig = (): ServerConfig | null => config;

type ConfigListener = (next: ServerConfig | null) => void;
const configListeners = new Set<ConfigListener>();

/** Called after the server settings are saved or cleared. Returns an unsubscribe. */
export function onConfigChange(listener: ConfigListener): () => void {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

const announce = () => {
  for (const l of configListeners) l(config);
};

// `next.url` must come from normalizeServerUrl.
export async function saveConfig(next: ServerConfig): Promise<void> {
  config = { url: next.url, token: next.token.trim() };
  await storage.set(CONFIG_KEY, JSON.stringify(config));
  announce();
}

export async function clearConfig(): Promise<void> {
  config = null;
  await storage.remove(CONFIG_KEY);
  announce();
}

// An error from a server that answered, as opposed to one that couldn't be reached.
export interface HttpError extends Error {
  status: number;
}

const httpError = (status: number, message: string): HttpError => Object.assign(new Error(message), { status });

export const isHttpError = (e: unknown): e is HttpError => e instanceof Error && typeof (e as HttpError).status === 'number';

export const NOT_SET_UP = 'Set your server address in Settings first.';
export const BAD_TOKEN =
  "The server didn't accept the token. In Settings, paste the OPENCALL_API_TOKEN value from the .env file on the computer.";

// Why Connect couldn't reach the server, in the terms a home setup needs.
export function unreachableMessage(url: string): string {
  const lan = /^https:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
  return lan
    ? `Couldn't reach ${url}. On home Wi-Fi the address starts with http://, not https://.`
    : `Couldn't reach ${url}. At home, check the phone is on the same Wi-Fi as the computer and the address is your computer's, like http://192.168.1.7:8000.`;
}

export const BAD_ADDRESS =
  "That address doesn't look right. It should look like http://192.168.1.7:8000, with your computer's address.";

export function wsUrl(path: string): string | null {
  if (!config) return null;
  const base = config.url.replace(/^http/, 'ws');
  return `${base}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(config.token)}`;
}

/** FastAPI puts the reason in `detail`: a string, or a list of field errors on 422. */
function detailOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    const msgs = d
      .map((x) => (x && typeof x === 'object' && typeof (x as { msg?: unknown }).msg === 'string' ? (x as { msg: string }).msg : ''))
      .filter(Boolean);
    return msgs.length ? msgs.join('; ') : null;
  }
  return null;
}

async function readBody(res: ResponseLike): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: an error page from a router, proxy or tunnel. The caller says so.
    return undefined;
  }
}

/** Turns a response into its JSON body, or throws an HttpError the user can act on. */
export async function readResponse<T>(res: ResponseLike): Promise<T> {
  if (res.status === 401) throw httpError(401, BAD_TOKEN);
  const body = await readBody(res);
  if (!res.ok) throw httpError(res.status, `Server said: ${detailOf(body) ?? res.status}`);
  if (body === undefined) {
    throw httpError(res.status, "The server's reply wasn't readable. Check the address is your OpenCall server.");
  }
  return body as T;
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error(NOT_SET_UP);
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await getTransport().fetch(`${cfg.url}${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  return readResponse<T>(res);
}

async function unauthenticated<T>(baseUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await getTransport().fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return readResponse<T>(res);
}

/** Recordings from expo-audio are AAC in an MP4 container (.m4a). */
export const RECORDING_MIME = 'audio/mp4';

/**
 * The multipart form for a recorded clip. The part must be an expo-file-system
 * File: SDK 57's fetch (expo/fetch) only accepts strings, Blobs and objects with
 * bytes(), and throws "Unsupported FormDataPart implementation" for React
 * Native's old { uri, name, type } objects.
 */
export function audioForm(uri: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('audio', new File(uri) as unknown as Blob);
  return form;
}

const enc = encodeURIComponent;

/** An audio source with the token in a header, for expo-audio. */
export interface MediaSource {
  uri: string;
  headers: Record<string, string>;
}

function media(path: string): MediaSource | null {
  if (!config) return null;
  return { uri: `${config.url}${path}`, headers: { Authorization: `Bearer ${config.token}` } };
}

export const api = {
  health: async (): Promise<Health> => normalizeHealth(await request<unknown>('GET', '/health')),

  profile: async (): Promise<Profile> => normalizeProfile(await request<unknown>('GET', '/profile')),
  patchProfile: async (p: ProfilePatch): Promise<Profile> => normalizeProfile(await request<unknown>('PATCH', '/profile', p)),

  putAway: async (a: AwayInput): Promise<Profile> => normalizeProfile(await request<unknown>('PUT', '/away', a)),
  clearAway: async (): Promise<Profile> => normalizeProfile(await request<unknown>('DELETE', '/away')),

  putLocation: (l: Location) => request<Location>('PUT', '/location', l),
  locationFromLink: (url: string) => request<{ lat: number; lng: number }>('POST', '/location/from-link', { text: url }),

  addInstruction: (input: InstructionInput) => request<Instruction>('POST', '/instructions', input),
  updateInstruction: (id: string, patch: Partial<InstructionInput>) =>
    request<Instruction>('PATCH', `/instructions/${enc(id)}`, patch),
  deleteInstruction: (id: string) => request<{ ok: boolean }>('DELETE', `/instructions/${enc(id)}`),
  instructionTemplates: () => request<InstructionTemplate[]>('GET', '/instructions/templates'),

  addNote: (input: KnowledgeInput) => request<KnowledgeNote>('POST', '/knowledge', input),
  updateNote: (id: string, patch: Partial<KnowledgeInput>) => request<KnowledgeNote>('PATCH', `/knowledge/${enc(id)}`, patch),
  deleteNote: (id: string) => request<{ ok: boolean }>('DELETE', `/knowledge/${enc(id)}`),

  putContacts: (contacts: { number: string; name: string }[]) => request<{ count: number }>('PUT', '/contacts', contacts),
  blockNumber: async (number: string): Promise<Profile> =>
    normalizeProfile(await request<unknown>('POST', '/contacts/block', { number })),
  unblockNumber: async (number: string): Promise<Profile> =>
    normalizeProfile(await request<unknown>('DELETE', `/contacts/block/${enc(number)}`)),

  registerPush: (token: string) => request<{ ok: boolean }>('POST', '/push/register', { token }),

  calls: async (limit = 50): Promise<CallSummary[]> =>
    (await request<unknown[]>('GET', `/calls?limit=${limit}`)).map(normalizeCallSummary),
  call: async (id: string): Promise<CallRecord> => normalizeCall(await request<unknown>('GET', `/calls/${enc(id)}`)),
  answer: (callId: string, text: string, holdId?: string) =>
    request<{ ok: boolean; mode: 'hold_answer' | 'said' }>('POST', `/calls/${enc(callId)}/answer`, { text, hold_id: holdId }),
  /** The owner's typed words, translated and spoken to the caller. `lang` defaults to owner_language. */
  say: (callId: string, text: string, lang?: string) =>
    request<{ ok: boolean }>('POST', `/calls/${enc(callId)}/say`, lang ? { text, lang } : { text }),
  /** The owner's recorded words: transcribed, translated and spoken to the caller. */
  sayAudio: (callId: string, uri: string, lang?: string) =>
    request<SayAudioReply>('POST', `/calls/${enc(callId)}/say-audio`, undefined, audioForm(uri, lang ? { lang } : {})),
  endCall: (callId: string) => request<{ ok: boolean }>('POST', `/calls/${enc(callId)}/end`),
  recordingSource: (callId: string) => media(`/calls/${enc(callId)}/recording`),

  messages: () => request<CallerMessage[]>('GET', '/messages'),
  replyMessage: (id: string, text: string, call_back: boolean) =>
    request<CallerMessage>('POST', `/messages/${enc(id)}/reply`, { text, call_back }),
  markRead: (id: string) => request<CallerMessage>('POST', `/messages/${enc(id)}/read`),

  tasks: () => request<Task[]>('GET', '/tasks'),
  createTask: (number: string, goal: string, kind: TaskKind, target_name = '') =>
    request<Task>('POST', '/tasks', { number, goal, kind, target_name }),

  chat: (text: string, shared = '', history: ChatTurn[] = []) =>
    request<ChatReply>('POST', '/assistant/chat', { text, shared, history }),
  voiceChat: (uri: string, shared = '') =>
    request<VoiceChatReply>('POST', '/assistant/voice', undefined, audioForm(uri, shared ? { shared } : {})),

  /** Clones first, then built-ins. */
  voices: async (): Promise<VoiceInfo[]> => (await request<unknown[]>('GET', '/voices')).map(normalizeVoice),
  /** Uploads a recorded voice sample (multipart, with progress from 0 to 1). */
  addVoice: async (label: string, uri: string, onProgress?: (fraction: number) => void): Promise<VoiceInfo> => {
    const cfg = await loadConfig();
    if (!cfg) throw new Error(NOT_SET_UP);
    const result = await getTransport().upload({
      url: `${cfg.url}/voices`,
      fileUri: uri,
      fieldName: 'audio',
      mimeType: RECORDING_MIME,
      parameters: { label },
      headers: { Authorization: `Bearer ${cfg.token}` },
      onProgress,
    });
    const res: ResponseLike = {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => JSON.parse(result.body) as unknown,
      text: async () => result.body,
    };
    return normalizeVoice(await readResponse<unknown>(res));
  },
  renameVoice: async (id: string, label: string): Promise<VoiceInfo> =>
    normalizeVoice(await request<unknown>('PATCH', `/voices/${enc(id)}`, { label })),
  deleteVoice: (id: string) => request<{ ok: boolean }>('DELETE', `/voices/${enc(id)}`),
  /** The cached demo of a voice; `sample_url` is relative to the server. */
  voiceSample: (voice: Pick<VoiceInfo, 'sample_url'>) => media(voice.sample_url),
  /** The owner's own recording a cloned voice was made from. */
  voiceRecording: (voice: Pick<VoiceInfo, 'id' | 'recording_url'>) =>
    media(voice.recording_url || `/voices/${enc(voice.id)}/recording`),
  /** Any text in a voice (GET /assistant/speak). */
  speech: (voice: string, text: string, lang = 'en') =>
    media(`/assistant/speak?voice=${enc(voice)}&lang=${enc(lang)}&text=${enc(text)}`),
  previewUrl: (voice: string, text: string, lang = 'en') =>
    config
      ? `${config.url}/assistant/speak?voice=${enc(voice)}&lang=${lang}&token=${enc(config.token)}&text=${enc(text)}`
      : '',

  /** Asks the server to print a 6-digit pairing code in its log (no token needed). */
  pairStart: (baseUrl: string) => unauthenticated<{ ok: boolean; expires_in: number }>(baseUrl, 'POST', '/pair/start'),
  /** Trades the code for the API token (no token needed; 5 tries per code). */
  pairFinish: (baseUrl: string, code: string) =>
    unauthenticated<{ token: string }>(baseUrl, 'POST', '/pair/finish', { code: code.replace(/\D/g, '') }),
};

export type Api = typeof api;

export type ConnectResult =
  | { ok: true; url: string; health: Health; profile: Profile; message: string }
  | { ok: false; url: string | null; message: string };

/**
 * Settings and onboarding "Connect": saves the address and token, then checks
 * the server answers and accepts the token, with a message for each way it fails.
 */
export async function connect(typedUrl: string, token: string): Promise<ConnectResult> {
  const url = normalizeServerUrl(typedUrl);
  if (!url) return { ok: false, url: null, message: BAD_ADDRESS };
  await saveConfig({ url, token });
  let health: Health;
  try {
    health = await api.health();
  } catch (e) {
    return { ok: false, url, message: isHttpError(e) ? e.message : unreachableMessage(url) };
  }
  try {
    const profile = await api.profile();
    const dialer = health.dialer === 'none' ? 'not set up' : dialerName(health.dialer);
    return { ok: true, url, health, profile, message: `Connected. Outbound calling: ${dialer}.` };
  } catch (e) {
    return { ok: false, url, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Away status helpers shared by Today and the Away screen. */
export const awayActive = (away: Away | null, now = Date.now() / 1000): away is Away =>
  !!away && (away.until === null || away.until > now);
