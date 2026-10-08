// Mock websockets for /ws/events and /ws/simulate, sending the v2 events in the
// same order as the real server: ack or error for every message, then the
// call's transcript, translation, status and language events.

import { scriptLanguage } from '../script';
import type { SocketLike } from '../transport';
import type { CallRecord, TranscriptLine } from '../types';
import type { MockServer } from './server';

type Json = Record<string, unknown>;

let lineSeq = 0;
const lineId = () => `mock-line-${Date.now().toString(36)}-${lineSeq++}`;
const nowS = () => Date.now() / 1000;

abstract class MockSocketBase implements SocketLike {
  readyState = 0;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  protected timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(protected readonly stepMs: number) {
    this.later(0, () => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.({});
      this.opened();
    });
  }

  protected abstract opened(): void;
  abstract send(data: string): void;

  protected later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  protected emit(ev: Json, after = 0) {
    this.later(after, () => {
      if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(ev) });
    });
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    // Like a real socket, the close event comes asynchronously.
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }
}

// ---------------------------------------------------------------- phrasebook

type Topic = 'greeting' | 'delivery' | 'secret' | 'other' | 'heard' | 'owner';
const PHRASES: Record<string, Record<Topic, [string, string]>> = {
  en: {
    greeting: ["Hello, you've reached Arjun's assistant, Ava. How can I help?", ''],
    delivery: ['Thanks! Please leave it with security at Gate 2. It is Block B, flat 402.', ''],
    secret: ["Sorry, I never share OTPs, PINs or bank details. I'll let Arjun know you called.", ''],
    other: ["Thanks, I'll pass that on to Arjun. May I have your name?", ''],
    heard: ["Hi, I'm from Swiggy, I'm at the gate with your order.", ''],
    owner: ['One moment, Arjun says: please leave it with security at Gate 2.', ''],
  },
  te: {
    greeting: ['నమస్కారం, నేను అర్జున్ గారి అసిస్టెంట్ అవా. ఎలా సహాయం చేయగలను?', "Hello, I'm Ava, Arjun's assistant. How can I help?"],
    delivery: ['ధన్యవాదాలు! దయచేసి గేట్ 2 దగ్గర సెక్యూరిటీకి ఇవ్వండి. బ్లాక్ బి, ఫ్లాట్ 402.', 'Thanks! Please give it to security at Gate 2. Block B, flat 402.'],
    secret: ['క్షమించండి, నేను OTP, PIN లేదా బ్యాంక్ వివరాలు ఎప్పుడూ చెప్పను.', 'Sorry, I never share OTPs, PINs or bank details.'],
    other: ['ధన్యవాదాలు, అర్జున్ గారికి చెప్తాను. మీ పేరు చెప్తారా?', "Thanks, I'll tell Arjun. May I have your name?"],
    heard: ['నమస్తే, స్విగ్గీ నుంచి. గేట్ దగ్గర ఉన్నాను.', "Hello, this is Swiggy. I'm at the gate."],
    owner: ['దయచేసి గేట్ 2 దగ్గర సెక్యూరిటీకి ఇవ్వండి.', 'Please give it to security at Gate 2.'],
  },
  hi: {
    greeting: ['नमस्ते, मैं अर्जुन की असिस्टेंट अवा हूँ। बताइए, क्या मदद करूँ?', "Hello, I'm Ava, Arjun's assistant. How can I help?"],
    delivery: ['धन्यवाद! कृपया गेट 2 पर सिक्योरिटी को दे दीजिए। ब्लॉक B, फ्लैट 402।', 'Thanks! Please give it to security at Gate 2. Block B, flat 402.'],
    secret: ['माफ़ कीजिए, मैं OTP, PIN या बैंक की जानकारी कभी नहीं देती।', 'Sorry, I never share OTPs, PINs or bank details.'],
    other: ['धन्यवाद, मैं अर्जुन को बता दूँगी। आपका नाम क्या है?', "Thanks, I'll tell Arjun. What is your name?"],
    heard: ['नमस्ते, स्विगी से बोल रहा हूँ, गेट पर हूँ।', "Hello, I'm from Swiggy, I'm at the gate."],
    owner: ['कृपया गेट 2 पर सिक्योरिटी को दे दीजिए।', 'Please give it to security at Gate 2.'],
  },
  ta: {
    greeting: ['வணக்கம், நான் அர்ஜுனின் உதவியாளர் அவா. எப்படி உதவலாம்?', "Hello, I'm Ava, Arjun's assistant. How can I help?"],
    delivery: ['நன்றி! கேட் 2-இல் செக்யூரிட்டியிடம் கொடுங்கள். பிளாக் B, பிளாட் 402.', 'Thanks! Please give it to security at Gate 2. Block B, flat 402.'],
    secret: ['மன்னிக்கவும், நான் OTP, PIN அல்லது வங்கி விவரங்களை ஒருபோதும் சொல்ல மாட்டேன்.', 'Sorry, I never share OTPs, PINs or bank details.'],
    other: ['நன்றி, அர்ஜுனிடம் சொல்கிறேன். உங்கள் பெயர் என்ன?', "Thanks, I'll tell Arjun. What is your name?"],
    heard: ['வணக்கம், ஸ்விக்கியிலிருந்து. கேட்டில் இருக்கிறேன்.', "Hello, this is Swiggy. I'm at the gate."],
    owner: ['கேட் 2-இல் செக்யூரிட்டியிடம் கொடுங்கள்.', 'Please give it to security at Gate 2.'],
  },
};

function topicOf(text: string): Topic {
  if (/otp|pin\b|password|cvv|bank|kyc|ఓటీపీ|ओटीपी/i.test(text)) return 'secret';
  if (/deliver|order|parcel|swiggy|zomato|amazon|courier|ఆర్డర్|డెలివరీ|ऑर्डर|डिलीवरी|पार्सल|ஆர்டர்/i.test(text)) return 'delivery';
  return 'other';
}

function phrase(lang: string, topic: Topic): { text: string; lang: string; translation: string } {
  const book = PHRASES[lang] ?? PHRASES.en;
  const [text, translation] = book[topic];
  return { text, lang: PHRASES[lang] ? lang : 'en', translation };
}

function makeLine(speaker: TranscriptLine['speaker'], text: string, lang: string, translation = '', kind: TranscriptLine['kind'] = 'speech'): TranscriptLine {
  return {
    id: lineId(),
    speaker,
    text,
    lang,
    translation: '',
    translation_lang: '',
    english: lang === 'en' ? text : translation,
    at: nowS(),
    kind,
  };
}

// ---------------------------------------------------------------- /ws/events

export class MockEventsSocket extends MockSocketBase {
  constructor(private readonly server?: MockServer) {
    super(server?.latencyMs ? 400 : 0);
  }

  /** A socket the server refuses with 4401, like a wrong token. */
  static refused(): MockEventsSocket {
    const s = new MockEventsSocket();
    s.close(4401, 'bad token');
    return s;
  }

  protected opened() {
    if (!this.server) return;
    for (const call of this.server.state.calls.filter((c) => !c.ended_at && c.status !== 'rejected')) {
      this.emit({ event: 'call_snapshot', call });
    }
  }

  send(data: string) {
    const msg = JSON.parse(data) as Json;
    const call = this.server?.state.calls.find((c) => c.id === msg.call_id && !c.ended_at);
    if (!call) {
      this.emit({ event: 'error', call_id: msg.call_id, detail: 'That call is no longer live.' });
      return;
    }
    const text = String(msg.text ?? '').trim();
    if ((msg.action === 'say' || msg.action === 'answer') && !text) {
      this.emit({ event: 'error', call_id: call.id, detail: 'The message was empty.' });
      return;
    }
    ownerTurn(this, call, msg, this.stepMs);
  }

  /** Lets ownerTurn emit through the protected method. */
  push(ev: Json, after: number) {
    this.emit(ev, after);
  }
}

function ownerTurn(sock: { push: (ev: Json, after: number) => void }, call: CallRecord, msg: Json, step: number) {
  const who = call.contact_name || call.number;
  const base = { call_id: call.id, who };
  const lang = call.language || 'en';
  const said = phrase(lang, 'owner');
  const written = msg.action === 'say_audio' ? 'Please leave it with security at Gate 2.' : String(msg.text ?? '');
  const ln: TranscriptLine = { ...makeLine('user', lang === 'en' ? written : said.text, lang), translation: written, translation_lang: 'en' };
  call.transcript = [...call.transcript, ln];
  sock.push({ event: 'assistant_status', ...base, state: msg.action === 'say_audio' ? 'transcribing' : 'translating' }, 0);
  sock.push({ event: 'transcript', ...base, line: ln }, step);
  sock.push({ event: 'assistant_status', ...base, state: 'speaking' }, step + 1);
  if (msg.action === 'answer' && msg.hold_id) {
    const hold = call.holds.find((h) => h.id === msg.hold_id);
    if (hold) {
      hold.answer = written;
      hold.answered_at = nowS();
    }
    call.status = 'active';
    sock.push({ event: 'hold_resolved', ...base, hold_id: msg.hold_id, answered: true }, step + 2);
  }
  sock.push({ event: 'assistant_status', ...base, state: 'listening' }, step * 3);
}

// ---------------------------------------------------------------- /ws/simulate

export class MockSimulateSocket extends MockSocketBase {
  private readonly callId = `practice-${Date.now().toString(36)}`;
  private lang: string;
  private ended = false;

  constructor(server: MockServer, query: URLSearchParams) {
    super(server.latencyMs ? 500 : 0);
    this.lang = query.get('lang') ?? '';
  }

  private base() {
    return { call_id: this.callId, who: 'Practice caller' };
  }

  protected opened() {
    this.emit({ event: 'started', call_id: this.callId });
    const g = phrase(this.lang || 'en', 'greeting');
    this.assistantSays(g, 0);
  }

  private assistantSays(p: { text: string; lang: string; translation: string }, after: number) {
    const b = this.base();
    const ln = makeLine('assistant', p.text, p.lang, p.translation);
    this.emit({ event: 'assistant_status', ...b, state: 'speaking' }, after);
    this.emit({ event: 'transcript', ...b, line: ln }, after);
    if (p.translation) {
      this.emit({ event: 'transcript_update', ...b, line_id: ln.id, translation: p.translation, translation_lang: 'en' }, after + this.stepMs);
    }
    this.emit({ event: 'assistant_status', ...b, state: 'listening' }, after + this.stepMs * 2);
  }

  send(data: string) {
    let msg: Json;
    try {
      msg = JSON.parse(data) as Json;
    } catch {
      this.emit({ event: 'error', detail: 'Messages must be JSON objects, e.g. {"text": "Hello"}.' });
      return;
    }
    if (msg.hangup) {
      this.hangup();
      return;
    }
    if (this.ended) {
      this.emit({ event: 'error', detail: 'The call has ended.' });
      return;
    }
    const b = this.base();
    const step = this.stepMs;
    if (msg.action) {
      const text = String(msg.text ?? '').trim();
      if (msg.action !== 'say_audio' && !text) {
        this.emit({ event: 'error', detail: 'The message was empty.' });
        return;
      }
      this.emit({ event: 'ack', kind: String(msg.action) });
      const lang = this.lang || 'en';
      const said = phrase(lang, 'owner');
      const written = msg.action === 'say_audio' ? 'Please leave it with security at Gate 2.' : text;
      const ln: TranscriptLine = { ...makeLine('user', lang === 'en' ? written : said.text, lang), translation: written, translation_lang: 'en' };
      this.emit({ event: 'assistant_status', ...b, state: 'translating' }, step);
      this.emit({ event: 'transcript', ...b, line: ln }, step * 2);
      this.emit({ event: 'assistant_status', ...b, state: 'listening' }, step * 3);
      return;
    }
    let heard: { text: string; lang: string; translation: string };
    if ('audio_b64' in msg) {
      if (!msg.audio_b64) {
        this.emit({ event: 'error', detail: "That recording was empty. Hold the mic while you speak." });
        return;
      }
      this.emit({ event: 'ack', kind: 'audio', seconds: 2.4 });
      heard = phrase(this.lang || 'te', 'heard');
      this.emit({ event: 'assistant_status', ...b, state: 'transcribing' }, step / 2);
    } else if ('text' in msg) {
      const text = String(msg.text ?? '').trim();
      if (!text) {
        this.emit({ event: 'error', detail: 'The message was empty.' });
        return;
      }
      this.emit({ event: 'ack', kind: 'text' });
      const lang = String(msg.lang ?? '') || this.lang || scriptLanguage(text) || 'en';
      heard = { text, lang, translation: '' };
    } else {
      this.emit({ event: 'error', detail: 'Send {"text": ...}, {"audio_b64": ...} or {"hangup": true}.' });
      return;
    }
    if (!this.lang) this.lang = heard.lang;
    const caller = makeLine('caller', heard.text, heard.lang, heard.translation);
    this.emit({ event: 'transcript', ...b, line: caller }, step);
    this.emit({ event: 'call_language', ...b, language: heard.lang, confidence: 0.96 }, step);
    if (heard.lang !== 'en') {
      this.emit({ event: 'assistant_status', ...b, state: 'translating' }, step);
      const english = PHRASES[heard.lang] ? phrase(heard.lang, 'heard').translation : '';
      this.emit(
        { event: 'transcript_update', ...b, line_id: caller.id, translation: 'audio_b64' in msg ? english : englishFor(heard.text), translation_lang: 'en' },
        step * 2,
      );
    }
    this.emit({ event: 'assistant_status', ...b, state: 'thinking' }, step * 2);
    this.assistantSays(phrase(this.lang, topicOf(heard.text + ('audio_b64' in msg ? ' order' : ''))), step * 3);
  }

  private hangup() {
    if (this.ended) return;
    this.ended = true;
    const b = this.base();
    const record = { id: this.callId, number: '+919800000000', status: 'ended', started_at: nowS() - 60, ended_at: nowS(), transcript: [], holds: [] };
    this.emit({ event: 'assistant_status', ...b, state: 'idle' });
    this.emit({ event: 'call_ended', ...b, call: record });
    this.later(this.stepMs + 1, () => this.close(1000, ''));
  }
}

/** A plausible English rendering of what a mock caller typed. */
function englishFor(text: string): string {
  const t = topicOf(text);
  if (t === 'delivery') return "I'm here with your delivery. Where should I leave it?";
  if (t === 'secret') return 'Please tell me the OTP you received.';
  return 'Is Arjun available? I wanted to talk to him.';
}
