import * as SecureStore from 'expo-secure-store';

import type { CallRecord, CallerMessage, Instruction, KnowledgeNote, Location, Profile, Task, TaskKind, Voice } from './types';

// Where the self-hosted backend lives (e.g. a Cloudflare Tunnel URL) and the
// shared token from OPENCALL_API_TOKEN. Both are kept in the device keystore.
export interface ServerConfig {
  url: string;
  token: string;
}

let config: ServerConfig | null = null;

export async function loadConfig(): Promise<ServerConfig | null> {
  if (config) return config;
  const raw = await SecureStore.getItemAsync('server');
  config = raw ? (JSON.parse(raw) as ServerConfig) : null;
  return config;
}

export async function saveConfig(next: ServerConfig): Promise<void> {
  config = { url: next.url.replace(/\/+$/, ''), token: next.token.trim() };
  await SecureStore.setItemAsync('server', JSON.stringify(config));
}

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
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new Error(`Server said: ${detail}`);
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
