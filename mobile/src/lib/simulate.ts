// The practice call: the app plays the caller over /ws/simulate. Every message
// the app sends is answered by the server with `ack` (accepted) or `error`
// (why not), in order, so each send here returns a promise for that answer and
// nothing the owner types or says is dropped silently.

import { File } from 'expo-file-system';

import { BAD_TOKEN, loadConfig, NOT_SET_UP, wsUrl } from './api';
import { parseEvent, type ServerEvent, type SimulateEvent } from './events';
import { PRACTICE_NUMBER } from './practiceCalls';
import { getTransport, refusedToken, SOCKET_OPEN, type SocketLike } from './transport';

export interface PracticeOptions {
  /** The pretend caller's number (screening applies to it). */
  number?: string;
  /** The caller's language if known; empty lets the server detect it. */
  lang?: string;
}

export interface PracticeHandlers {
  /** Every event of this call: transcript, assistant_status, call_language, ... */
  onEvent: (ev: ServerEvent) => void;
  /** One WAV file per sentence the assistant speaks. */
  onAudio: (wav: ArrayBuffer) => void;
  /** The socket closed; `message` is set when it wasn't a normal hang-up. */
  onClose: (info: { code: number; message: string | null }) => void;
}

const START_TIMEOUT_MS = 15000;
const ACK_TIMEOUT_MS = 20000;

export function practiceUrl({ number = PRACTICE_NUMBER, lang = '' }: PracticeOptions = {}): string | null {
  const q = `number=${encodeURIComponent(number)}&wav=1${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`;
  return wsUrl(`/ws/simulate?${q}`);
}

/** The server accepted a message; for a recording, how long it was. */
export interface Ack {
  kind: string;
  seconds?: number;
}

interface Pending {
  kind: string;
  resolve: (ack: Ack) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  timedOut: boolean;
}

const CUT_OFF = 'The practice call was cut off. Check the connection to your server.';
/** PracticeCall.start was aborted. */
export const CANCELLED = 'The practice call was cancelled.';
const ENDED = 'The call has ended.';

/** Closes a socket now, or as soon as it opens: on Android, close() does nothing while it is still connecting. */
function closeSoon(socket: SocketLike) {
  if (socket.readyState === SOCKET_OPEN) socket.close();
  else socket.onopen = () => socket.close();
}

function closeMessage(code: number, reason: string): string | null {
  if (code === 1000 || code === 1005) return null;
  if (refusedToken(code, reason)) return BAD_TOKEN;
  // 1006 carries the platform's own wording (an OkHttp exception on Android),
  // which means nothing to the owner. A reason the server gave is kept.
  if (code === 1006 || !reason) return CUT_OFF;
  return `The practice call was cut off: ${reason}`;
}

export { PRACTICE_NUMBER };

export class PracticeCall {
  readonly callId: string;
  private socket: SocketLike;
  private handlers: PracticeHandlers;
  private pending: Pending[] = [];
  private closed = false;
  private hungUp = false;

  private constructor(socket: SocketLike, callId: string, handlers: PracticeHandlers) {
    this.socket = socket;
    this.callId = callId;
    this.handlers = handlers;
    socket.onmessage = (m) => this.receive(m.data);
    socket.onclose = (e) => this.finish(e.code, e.reason);
    socket.onerror = () => undefined; // onclose follows with the code
  }

  /**
   * Opens the call; resolves once the server says it started. Aborting (the
   * owner left or hung up while it connects) rejects with CANCELLED and closes
   * the socket, once it is open if it is still connecting.
   */
  static async start(options: PracticeOptions, handlers: PracticeHandlers, signal?: AbortSignal): Promise<PracticeCall> {
    await loadConfig();
    if (signal?.aborted) throw new Error(CANCELLED);
    const url = practiceUrl(options);
    if (!url) throw new Error(NOT_SET_UP);
    const socket = getTransport().openSocket(url);
    socket.binaryType = 'arraybuffer';
    return new Promise<PracticeCall>((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new Error(message));
      };
      const abort = () => {
        fail(CANCELLED);
        closeSoon(socket);
      };
      signal?.addEventListener('abort', abort);
      const timer = setTimeout(() => {
        fail("The server didn't start the practice call. Check it's running and try again.");
        closeSoon(socket);
      }, START_TIMEOUT_MS);
      socket.onmessage = (m) => {
        const parsed = parseEvent(m.data);
        if (!parsed.ok) return;
        const ev = parsed.event;
        if (ev.event === 'rejected') {
          fail(`The assistant wouldn't take this call${ev.reason ? `: ${ev.reason}` : '.'}`);
        } else if (ev.event === 'started' && !settled) {
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          resolve(new PracticeCall(socket, ev.call_id, handlers));
        }
      };
      socket.onerror = () => undefined; // onclose follows with the code
      socket.onclose = (e) => fail(closeMessage(e.code, e.reason) ?? 'The practice call ended before it started.');
    });
  }

  get isOpen(): boolean {
    return !this.closed && !this.hungUp && this.socket.readyState === SOCKET_OPEN;
  }

  /** Messages sent and not yet acknowledged. */
  get waiting(): number {
    return this.pending.filter((p) => !p.timedOut).length;
  }

  /** The caller says something (typed). */
  sendText(text: string, lang?: string): Promise<Ack> {
    return this.send('text', { text, ...(lang ? { lang } : {}) });
  }

  /** The caller says something (a finished recording, base64). */
  sendAudio(audioB64: string, lang?: string): Promise<Ack> {
    return this.send('audio', { audio_b64: audioB64, ...(lang ? { lang } : {}) });
  }

  /** The owner cuts in with typed words, said to the caller in their language. */
  say(text: string, lang?: string): Promise<Ack> {
    return this.send('say', { action: 'say', call_id: this.callId, text, ...(lang ? { lang } : {}) });
  }

  /** The owner cuts in with a recording. */
  sayAudio(audioB64: string, lang?: string): Promise<Ack> {
    return this.send('say_audio', { action: 'say_audio', call_id: this.callId, audio_b64: audioB64, ...(lang ? { lang } : {}) });
  }

  /** The owner answers a hold question. */
  answer(text: string, holdId?: string): Promise<Ack> {
    return this.send('answer', { action: 'answer', call_id: this.callId, text, hold_id: holdId });
  }

  /**
   * Hangs up. The server closes the socket only once the call is wrapped up
   * (its summary can take a while), so what is still waiting fails now and
   * nothing more can be sent; the call's last events still arrive.
   */
  hangup(): void {
    if (this.hungUp || this.closed) return;
    const open = this.isOpen;
    this.hungUp = true;
    this.rejectPending(ENDED);
    if (open) this.socket.send(JSON.stringify({ hangup: true }));
    else this.finish(1000, '');
  }

  /** Stops waiting for the server to wrap up: closes the socket and ends the call here. */
  close(): void {
    this.hungUp = true;
    if (this.socket.readyState === SOCKET_OPEN) this.socket.close(1000, '');
    this.finish(1000, '');
  }

  private rejectPending(message: string) {
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      if (!p.timedOut) p.reject(new Error(message));
    }
  }

  private send(kind: string, payload: Record<string, unknown>): Promise<Ack> {
    if (!this.isOpen) return Promise.reject(new Error('The practice call has ended. Start a new one.'));
    return new Promise<Ack>((resolve, reject) => {
      const entry: Pending = {
        kind,
        resolve,
        reject,
        timedOut: false,
        timer: setTimeout(() => {
          // Stay in the queue: a late ack still belongs to this message.
          entry.timedOut = true;
          reject(new Error("The server didn't confirm that message. It may be busy; try again."));
        }, ACK_TIMEOUT_MS),
      };
      this.pending.push(entry);
      this.socket.send(JSON.stringify(payload));
    });
  }

  private settle(result: { error: string } | { ack: Ack }): boolean {
    const entry = this.pending.shift();
    if (!entry) return false;
    clearTimeout(entry.timer);
    if (!entry.timedOut) {
      if ('error' in result) entry.reject(new Error(result.error));
      else entry.resolve(result.ack);
    }
    return true;
  }

  private receive(data: unknown) {
    if (data instanceof ArrayBuffer) {
      this.handlers.onAudio(data);
      return;
    }
    const parsed = parseEvent(data);
    if (!parsed.ok) {
      console.warn('Practice call: ignored a message from the server', parsed.reason);
      return;
    }
    const ev = parsed.event as ServerEvent | SimulateEvent;
    if (ev.event === 'ack') {
      this.settle({ ack: { kind: ev.kind, ...(typeof ev.seconds === 'number' ? { seconds: ev.seconds } : {}) } });
      return;
    }
    if (ev.event === 'error' && !ev.call_id && this.settle({ error: ev.detail })) return;
    if (ev.event === 'started' || ev.event === 'rejected') return;
    this.handlers.onEvent(ev);
  }

  private finish(code: number, reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending('The practice call ended before the server answered.');
    this.handlers.onClose({ code, message: closeMessage(code, reason) });
  }
}

/** A recording as base64, for the practice socket. */
export function recordingBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}
