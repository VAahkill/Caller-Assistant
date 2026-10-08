import * as SecureStore from 'expo-secure-store';

import type { CallRecord, CallerMessage, Instruction, KnowledgeNote, Location, Profile, Task, TaskKind, Voice } from './types';

// Where the self-hosted backend lives (e.g. a Cloudflare Tunnel URL) and the
// shared token from OPENCALL_API_TOKEN. Both are kept in the device keystore.
export interface ServerConfig {
  url: string;
  token: string;
}

let config: ServerConfig | null = null;

const isServerUrl = (url: string) => /^https?:\/\/(\[[0-9a-f:.]+\]|[^\s/?#:\[\]]+)(:\d{1,5})?(\/\S*)?$/i.test(url);

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
  const raw = await SecureStore.getItemAsync('server');
  const saved = raw ? (JSON.parse(raw) as ServerConfig) : null;
  // Older versions could save an empty or malformed address; treat that as not set up.
  config = saved && isServerUrl(saved.url) ? saved : null;
  return config;
}

// `next.url` must come from normalizeServerUrl.
export async function saveConfig(next: ServerConfig): Promise<void> {
  config = { url: next.url, token: next.token.trim() };
  await SecureStore.setItemAsync('server', JSON.stringify(config));
}

// An error from a server that answered, as opposed to one that couldn't be reached.
export interface HttpError extends Error {
  status: number;
}

const httpError = (status: number, message: string): HttpError => Object.assign(new Error(message), { status });

export const isHttpError = (e: unknown): e is HttpError => e instanceof Error && typeof (e as HttpError).status === 'number';

export function wsUrl(path: string): string | null {
  if (!config) return null;
  const base = config.url.replace(/^http/, 'ws');
  return `${base}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(config.token)}`;
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error('Set your server address in Settings first.');
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401) {
    throw httpError(401, "The server didn't accept the token. In Settings, paste the OPENCALL_API_TOKEN value from the .env file on the computer.");
  }
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw httpError(res.status, `Server said: ${detail}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; dialer: string; active_calls: number }>('GET', '/health'),
  profile: () => request<Profile>('GET', '/profile'),
  patchProfile: (p: Partial<Profile>) => request<Profile>('PATCH', '/profile', p),
  putLocation: (l: Location) => request<Location>('PUT', '/location', l),
  locationFromLink: (url: string) => request<{ lat: number; lng: number }>('POST', '/location/from-link', { text: url }),
  addInstruction: (text: string) => request<Instruction>('POST', '/instructions', { text }),
  deleteInstruction: (id: string) => request('DELETE', `/instructions/${id}`),
  addNote: (text: string, share_with: KnowledgeNote['share_with']) =>
    request<KnowledgeNote>('POST', '/knowledge', { text, share_with }),
  deleteNote: (id: string) => request('DELETE', `/knowledge/${id}`),
  putContacts: (contacts: { number: string; name: string }[]) => request('PUT', '/contacts', contacts),
  registerPush: (token: string) => request('POST', '/push/register', { token }),

  calls: () => request<CallRecord[]>('GET', '/calls'),
  call: (id: string) => request<CallRecord>('GET', `/calls/${id}`),
  answer: (callId: string, text: string, holdId?: string) =>
    request<{ mode: string }>('POST', `/calls/${callId}/answer`, { text, hold_id: holdId }),
  endCall: (callId: string) => request('POST', `/calls/${callId}/end`),
  recordingUrl: (callId: string) =>
    config ? `${config.url}/calls/${callId}/recording?token=${encodeURIComponent(config.token)}` : '',

  messages: () => request<CallerMessage[]>('GET', '/messages'),
  replyMessage: (id: string, text: string, call_back: boolean) =>
    request<CallerMessage>('POST', `/messages/${id}/reply`, { text, call_back }),
  markRead: (id: string) => request('POST', `/messages/${id}/read`),

  tasks: () => request<Task[]>('GET', '/tasks'),
  createTask: (number: string, goal: string, kind: TaskKind, target_name = '') =>
    request<Task>('POST', '/tasks', { number, goal, kind, target_name }),

  chat: (text: string, shared = '', history: { role: string; content: string }[] = []) =>
    request<{ reply: string; actions: { type: string }[] }>('POST', '/assistant/chat', { text, shared, history }),
  voiceChat: (uri: string) => {
    const form = new FormData();
    form.append('audio', { uri, name: 'clip.m4a', type: 'audio/m4a' } as unknown as Blob);
    return request<{ heard: string; reply: string }>('POST', '/assistant/voice', undefined, form);
  },

  voices: () => request<Voice[]>('GET', '/voices'),
  addVoice: (label: string, uri: string) => {
    const form = new FormData();
    form.append('label', label);
    form.append('audio', { uri, name: 'sample.m4a', type: 'audio/m4a' } as unknown as Blob);
    return request<Voice>('POST', '/voices', undefined, form);
  },
  deleteVoice: (name: string) => request('DELETE', `/voices/${name}`),
  previewUrl: (voice: string, text: string, lang = 'en') =>
    config
      ? `${config.url}/assistant/speak?voice=${encodeURIComponent(voice)}&lang=${lang}&token=${encodeURIComponent(config.token)}&text=${encodeURIComponent(text)}`
      : '',
};

export function phoneFromText(text: string): string {
  const m = text.match(/\+?\d[\d\s().-]{7,}\d/);
  return m ? m[0].replace(/[^\d+]/g, '') : '';
}
