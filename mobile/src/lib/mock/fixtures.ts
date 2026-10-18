// Demo data in every API contract v2 shape, for mock mode, screenshots and
// tests. Times are relative to `now` so "today" always looks like today.

import { awayMessage, untilFor } from '../away';
import type {
  CallRecord,
  CallerMessage,
  Health,
  InstructionTemplate,
  PhoneLine,
  Profile,
  Task,
  TranscriptLine,
  VoiceInfo,
} from '../types';

export interface MockState {
  health: Health;
  profile: Profile;
  calls: CallRecord[];
  messages: CallerMessage[];
  tasks: Task[];
  voices: VoiceInfo[];
  templates: InstructionTemplate[];
}

/** The demo's phone line: a phone paired by Bluetooth, carrying calls both ways. */
export const LINE_READY: PhoneLine = {
  kind: 'bluetooth',
  ok: true,
  inbound: true,
  outbound: true,
  detail: 'A phone is connected by Bluetooth and ready for calls.',
};

/** What a server with no line says (its NO_LINE), e.g. in Docker Desktop on Windows. */
export const NO_LINE: PhoneLine = {
  kind: 'none',
  ok: false,
  inbound: false,
  outbound: false,
  detail: "No phone line is set up on your server yet, so it can't answer your real calls or make calls for you. Practice calls in the app work without one.",
};

export const LIVE_CALL_ID = 'call-live-swiggy';
export const LIVE_HOLD_ID = 'hold-gate';
export const AMMA = '+919848012345';

let lineSeq = 0;
function line(
  at: number,
  speaker: TranscriptLine['speaker'],
  text: string,
  lang: string,
  translation = '',
  kind: TranscriptLine['kind'] = 'speech',
): TranscriptLine {
  lineSeq += 1;
  return {
    id: `line-${lineSeq}`,
    speaker,
    text,
    lang,
    translation,
    translation_lang: translation ? 'en' : '',
    english: lang === 'en' ? text : translation,
    at,
    kind,
  };
}

function call(partial: Partial<CallRecord> & Pick<CallRecord, 'id' | 'number' | 'started_at'>): CallRecord {
  return {
    direction: 'inbound',
    contact_name: '',
    category: 'unknown',
    status: 'ended',
    language: 'en',
    ended_at: partial.started_at + 95,
    transcript: [],
    holds: [],
    summary: '',
    message: '',
    recording: '',
    task_id: null,
    reject_reason: '',
    urgent: false,
    action_items: [],
    ...partial,
  };
}

export function createFixtures(now: number = Date.now() / 1000): MockState {
  lineSeq = 0;
  const min = 60;
  const hour = 3600;
  const t0 = now - 4 * min;
  const awayUntil = untilFor(120, now * 1000) ?? now + 2 * hour;

  const liveCall = call({
    id: LIVE_CALL_ID,
    number: '+919700112233',
    contact_name: '',
    category: 'delivery',
    status: 'on_hold',
    language: 'te',
    started_at: t0,
    ended_at: null,
    transcript: [
      line(t0 + 2, 'assistant', 'నమస్కారం, నేను అర్జున్ గారి అసిస్టెంట్ అవా. ఎలా సహాయం చేయగలను?', 'te', "Hello, I'm Ava, Arjun's assistant. How can I help?"),
      line(t0 + 9, 'caller', 'నమస్తే అండి, స్విగ్గీ నుంచి. మీ ఆర్డర్ తీసుకొచ్చాను, గేట్ దగ్గర ఉన్నాను.', 'te', "Hello, this is Swiggy. I've brought your order and I'm at the gate."),
      line(t0 + 15, 'assistant', 'ధన్యవాదాలు. బ్లాక్ బి, నాలుగో అంతస్తు, ఫ్లాట్ 402. లిఫ్ట్ గేట్ 2 పక్కనే ఉంది.', 'te', 'Thank you. Block B, fourth floor, flat 402. The lift is next to Gate 2.'),
      line(t0 + 31, 'caller', 'సెక్యూరిటీ దగ్గర ఇవ్వమంటారా, లేక పైకి తీసుకురావాలా?', 'te', 'Should I leave it with security, or bring it up?', 'hold_question'),
    ],
    holds: [
      {
        id: LIVE_HOLD_ID,
        question: 'Should I leave the order with security, or bring it up to the flat?',
        asked_at: t0 + 31,
        answer: null,
        answered_at: null,
        sensitive: false,
      },
    ],
    summary: 'Swiggy delivery partner at the gate.',
  });

  const amma = call({
    id: 'call-amma',
    number: AMMA,
    contact_name: 'Amma',
    category: 'contact',
    language: 'te',
    started_at: now - 52 * min,
    transcript: [
      line(now - 52 * min, 'assistant', 'నమస్కారం అమ్మా, అర్జున్ ఇప్పుడు మీటింగ్‌లో ఉన్నారు. ఏమైనా చెప్పమంటారా?', 'te', "Hello Amma, Arjun is in a meeting right now. Shall I pass on a message?"),
      line(now - 52 * min + 8, 'caller', 'సరే, ఆదివారం భోజనానికి వస్తాడా అని అడుగు. ఫ్రీ అయ్యాక ఫోన్ చేయమను.', 'te', "Okay, ask him if he's coming for lunch on Sunday. Tell him to call when he's free."),
      line(now - 52 * min + 16, 'assistant', 'తప్పకుండా, ఆయనకి చెప్తాను. ఆయన గంటలో ఫోన్ చేస్తారు.', 'te', "Of course, I'll tell him. He'll call you within the hour."),
    ],
    summary: 'Amma asked whether you are coming for lunch on Sunday and wants a call back when you are free.',
    message: "Are you coming for lunch on Sunday? Call me when you're free.",
    recording: 'call-amma.wav',
    action_items: ['Call Amma back about Sunday lunch'],
  });

  const rajesh = call({
    id: 'call-rajesh',
    number: '+919912345678',
    contact_name: '',
    category: 'business',
    language: 'en',
    started_at: now - 2 * hour - 10 * min,
    transcript: [
      line(now - 2 * hour - 10 * min, 'assistant', "Hello, you've reached Arjun's assistant, Ava. How can I help?", 'en'),
      line(now - 2 * hour - 10 * min + 6, 'caller', "Hi, this is Rajesh from Nest Interiors. I'm following up on the kitchen quote he asked for.", 'en'),
      line(now - 2 * hour - 10 * min + 14, 'assistant', "Thanks, Rajesh. Arjun can't take calls right now. Can I take a message?", 'en'),
      line(now - 2 * hour - 10 * min + 20, 'caller', 'Please ask him to call me before 11 tomorrow. I can share the revised design then.', 'en'),
    ],
    summary: 'Rajesh from Nest Interiors has the revised kitchen quote and asks for a call before 11 AM tomorrow.',
    message: 'Please call before 11 tomorrow about the revised kitchen design.',
    recording: 'call-rajesh.wav',
    urgent: true,
    action_items: ['Call Rajesh before 11 AM tomorrow', 'Have the floor plan ready'],
  });

  const scam = call({
    id: 'call-kyc',
    number: '+918800112233',
    category: 'spam',
    language: 'hi',
    started_at: now - 3 * hour,
    transcript: [
      line(now - 3 * hour, 'assistant', 'नमस्ते, मैं अर्जुन की असिस्टेंट अवा हूँ। बताइए, क्या काम है?', 'hi', "Hello, I'm Ava, Arjun's assistant. How can I help?"),
      line(now - 3 * hour + 7, 'caller', 'मैं बैंक से बोल रहा हूँ। आपका KYC अपडेट करना है, फ़ोन पर जो OTP आया है वो बताइए।', 'hi', "I'm calling from the bank. Your KYC needs updating; tell me the OTP you just received."),
      line(now - 3 * hour + 12, 'system', 'Asked for an OTP. The assistant refused and ended the call.', 'en', '', 'alert'),
      line(now - 3 * hour + 13, 'assistant', 'माफ़ कीजिए, मैं कोई OTP या बैंक की जानकारी नहीं देती। नमस्ते।', 'hi', "Sorry, I never share OTPs or bank details. Goodbye."),
    ],
    summary: 'Caller claiming to be from the bank asked for an OTP. Refused; likely a scam.',
    recording: 'call-kyc.wav',
    urgent: true,
  });

  const loan = call({
    id: 'call-loan',
    number: '+911401234567',
    category: 'spam',
    status: 'rejected',
    started_at: now - 4 * hour,
    ended_at: now - 4 * hour,
    reject_reason: 'Telemarketing number (+91140 series)',
    summary: 'Blocked a telemarketing call.',
  });

  const bluedart = call({
    id: 'call-bluedart',
    number: '+919550011223',
    category: 'delivery',
    language: 'hi',
    started_at: now - 27 * hour,
    transcript: [
      line(now - 27 * hour, 'caller', 'ब्लू डार्ट से बोल रहा हूँ, पार्सल कहाँ छोड़ूँ?', 'hi', "This is Blue Dart, where should I leave the parcel?"),
      line(now - 27 * hour + 5, 'assistant', 'गेट 2 पर सिक्योरिटी को दे दीजिए, फ्लैट 402।', 'hi', 'Please give it to security at Gate 2, flat 402.'),
    ],
    summary: 'Blue Dart parcel left with security at Gate 2.',
  });

  const paradise = call({
    id: 'call-paradise',
    direction: 'outbound',
    number: '+914023456789',
    contact_name: 'Paradise Biryani',
    category: 'business',
    started_at: now - 5 * hour,
    task_id: 'task-paradise',
    summary: 'Booked a table for four at 8 PM tonight under Arjun.',
    transcript: [
      line(now - 5 * hour, 'assistant', "Hi, I'd like to book a table for four tonight at 8, under the name Arjun.", 'en'),
      line(now - 5 * hour + 6, 'caller', "Sure, that's confirmed. Four people at 8 PM.", 'en'),
    ],
  });

  const priya = call({
    id: 'call-priya',
    number: '+919866554433',
    contact_name: 'Priya',
    category: 'contact',
    language: 'en',
    started_at: now - 26 * hour - 2 * min,
    transcript: [
      line(now - 26 * hour - 2 * min, 'assistant', "Hi Priya, Arjun can't take the call right now. Can I pass on a message?", 'en'),
      line(now - 26 * hour - 2 * min + 6, 'caller', "Yes please, tell him I'm running 15 minutes late for the 6 PM meeting.", 'en'),
      line(now - 26 * hour - 2 * min + 12, 'assistant', "Got it, I'll let him know right away.", 'en'),
    ],
    summary: 'Priya is running 15 minutes late for the 6 PM meeting.',
    message: 'Running 15 minutes late for the 6 PM meeting.',
  });

  const messages: CallerMessage[] = [
    {
      id: 'msg-amma',
      call_id: amma.id,
      number: AMMA,
      caller_name: 'Amma',
      text: amma.message,
      created_at: amma.ended_at ?? amma.started_at,
      status: 'new',
      reply: '',
      callback_task_id: null,
    },
    {
      id: 'msg-rajesh',
      call_id: rajesh.id,
      number: rajesh.number,
      caller_name: 'Rajesh, Nest Interiors',
      text: rajesh.message,
      created_at: rajesh.ended_at ?? rajesh.started_at,
      status: 'new',
      reply: '',
      callback_task_id: null,
    },
    {
      id: 'msg-priya',
      call_id: priya.id,
      number: '+919866554433',
      caller_name: 'Priya',
      text: 'Running 15 minutes late for the 6 PM meeting.',
      created_at: now - 26 * hour,
      status: 'replied',
      reply: 'No problem, see you at 6:15.',
      callback_task_id: null,
    },
  ];

  const tasks: Task[] = [
    {
      id: 'task-amazon',
      kind: 'enquire',
      number: '+918045678901',
      goal: 'Ask when order 408-1192 will be delivered and whether it can come after 6 PM.',
      target_name: 'Amazon support',
      status: 'in_call',
      outcome: '',
      result: '',
      call_id: null,
      created_at: now - 3 * min,
      updated_at: now - 1 * min,
      practice: false,
    },
    {
      id: 'task-paradise',
      kind: 'book',
      number: '+914023456789',
      goal: 'Book a table for 4 tonight at 8 PM under Arjun.',
      target_name: 'Paradise Biryani',
      status: 'done',
      outcome: 'booked',
      result: 'Table for four at 8 PM tonight, under Arjun.',
      call_id: paradise.id,
      created_at: now - 5 * hour - 2 * min,
      updated_at: now - 5 * hour + 60,
      practice: false,
    },
    {
      id: 'task-dentist',
      kind: 'callback',
      number: '+919000012345',
      goal: "Move Thursday's dental appointment to next week, any evening.",
      target_name: 'Smile Dental',
      status: 'failed',
      outcome: 'no_answer',
      result: "No one answered after 3 tries. I'll stop here.",
      call_id: null,
      created_at: now - 28 * hour,
      updated_at: now - 27 * hour,
      practice: false,
    },
  ];

  const sample = (id: string, lang: string) => `/voices/${encodeURIComponent(id)}/sample.wav?lang=${lang}&v=3f2a1c`;
  const builtin = (id: string, name: string, engine: VoiceInfo['engine'], lang: string, gender: string): VoiceInfo => ({
    id,
    name,
    kind: 'builtin',
    engine,
    languages: [lang],
    gender,
    sample_url: sample(id, lang),
    recording_url: '',
    seconds: null,
    created_at: null,
    status: 'ready',
  });
  const xttsLangs = ['en', 'hi', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hu', 'ko'];
  const voices: VoiceInfo[] = [
    {
      id: 'clone:my-voice-3f2a1c',
      name: 'My voice',
      kind: 'clone',
      engine: 'xtts',
      languages: xttsLangs,
      gender: '',
      sample_url: sample('clone:my-voice-3f2a1c', 'en'),
      recording_url: '/voices/clone%3Amy-voice-3f2a1c/recording',
      seconds: 14.2,
      created_at: now - 6 * 24 * hour,
      status: 'ready',
    },
    {
      id: 'clone:dad-91b2e0',
      name: 'Dad',
      kind: 'clone',
      engine: 'xtts',
      languages: xttsLangs,
      gender: '',
      sample_url: sample('clone:dad-91b2e0', 'en'),
      recording_url: '/voices/clone%3Adad-91b2e0/recording',
      seconds: 9.8,
      created_at: now - 20 * min,
      status: 'preparing',
    },
    builtin('kokoro:af_heart', 'Heart', 'kokoro', 'en', 'female'),
    builtin('kokoro:af_bella', 'Bella', 'kokoro', 'en', 'female'),
    builtin('kokoro:am_michael', 'Michael', 'kokoro', 'en', 'male'),
    builtin('kokoro:hf_alpha', 'Alpha', 'kokoro', 'hi', 'female'),
    builtin('kokoro:hm_omega', 'Omega', 'kokoro', 'hi', 'male'),
    builtin('piper:te_IN-padmavathi-medium', 'Padmavathi', 'piper', 'te', 'female'),
    builtin('piper:te_IN-venkatesh-medium', 'Venkatesh', 'piper', 'te', 'male'),
    builtin('mms:ta', 'Tamil', 'mms', 'ta', ''),
  ];

  const profile: Profile = {
    user_name: 'Arjun',
    assistant_name: 'Ava',
    enabled: true,
    available: false,
    home_country_code: '+91',
    block_international: true,
    answer_unknown_numbers: true,
    voice: 'kokoro:af_heart',
    blocked_prefixes: ['+91140'],
    caller_languages: ['te', 'en', 'hi', 'ta'],
    owner_language: 'en',
    translate_live: true,
    voices_by_language: { te: 'piper:te_IN-padmavathi-medium', hi: 'kokoro:hf_alpha' },
    blocked_numbers: ['+918800112233'],
    vip_numbers: [AMMA],
    away: { preset: 'meeting', message: awayMessage('In a meeting', awayUntil, now * 1000), until: awayUntil, set_at: now - hour },
    location: {
      lat: 17.4612,
      lng: 78.3672,
      address: 'Road No. 2, Kondapur',
      building: 'Lakeview Residency, Block B',
      floor_unit: 'Flat 402, 4th floor',
      landmarks: 'Opposite Ratnadeep supermarket',
      gate_instructions: 'Use Gate 2 and tell security the flat number',
      geocoded_hint: 'Kondapur, Hyderabad, Telangana 500084',
    },
    instructions: [
      {
        id: 'ins-delivery',
        text: 'If Swiggy, Zomato or Amazon call, ask them to leave the parcel with security at Gate 2.',
        enabled: true,
        applies_to: 'delivery',
        numbers: [],
        category: 'delivery',
        expires_at: null,
        created_at: now - 9 * 24 * hour,
        updated_at: now - 9 * 24 * hour,
      },
      {
        id: 'ins-privacy',
        text: "Never say when I'm travelling or that nobody is home.",
        enabled: true,
        applies_to: 'everyone',
        numbers: [],
        category: 'privacy',
        expires_at: null,
        created_at: now - 9 * 24 * hour,
        updated_at: now - 9 * 24 * hour,
      },
      {
        id: 'ins-amma',
        text: "If Amma calls, tell her I'll call back within the hour.",
        enabled: true,
        applies_to: 'numbers',
        numbers: [AMMA],
        category: 'family',
        expires_at: null,
        created_at: now - 3 * 24 * hour,
        updated_at: now - 3 * 24 * hour,
      },
      {
        id: 'ins-sales',
        text: "Say I'm not interested in loans, credit cards or insurance, and end the call politely.",
        enabled: true,
        applies_to: 'unknown',
        numbers: [],
        category: 'sales',
        expires_at: null,
        created_at: now - 8 * 24 * hour,
        updated_at: now - 8 * 24 * hour,
      },
      {
        id: 'ins-trip',
        text: "Tell work callers I'm back in the office on Monday.",
        enabled: false,
        applies_to: 'everyone',
        numbers: [],
        category: 'availability',
        expires_at: now + 3 * 24 * hour,
        created_at: now - 24 * hour,
        updated_at: now - 2 * hour,
      },
    ],
    knowledge: [
      {
        id: 'note-office',
        text: 'My office is at Cyber Towers, Hitech City, 3rd floor.',
        enabled: true,
        share_with: 'contacts',
        numbers: [],
        expires_at: null,
        created_at: now - 12 * 24 * hour,
        updated_at: now - 12 * 24 * hour,
      },
      {
        id: 'note-gates',
        text: 'Gate 2 is open all night; Gate 1 closes at 10 PM.',
        enabled: true,
        share_with: 'delivery',
        numbers: [],
        expires_at: null,
        created_at: now - 9 * 24 * hour,
        updated_at: now - 9 * 24 * hour,
      },
      {
        id: 'note-evenings',
        text: 'The best time to reach me is after 6 PM on weekdays.',
        enabled: true,
        share_with: 'anyone',
        numbers: [],
        expires_at: null,
        created_at: now - 5 * 24 * hour,
        updated_at: now - 5 * 24 * hour,
      },
    ],
    contacts: [
      { number: AMMA, name: 'Amma', blocked: false },
      { number: '+919866554433', name: 'Priya', blocked: false },
      { number: '+919177001122', name: 'Kiran (office)', blocked: false },
    ],
    push_tokens: [],
  };

  const templates: InstructionTemplate[] = [
    { category: 'delivery', text: 'Ask delivery partners to leave parcels with security.', applies_to: 'delivery' },
    { category: 'delivery', text: 'For food deliveries, ask them to bring it up to the door.', applies_to: 'delivery' },
    { category: 'delivery', text: 'Ask couriers to call again after 6 PM if a signature is needed.', applies_to: 'delivery' },
    { category: 'family', text: "If family calls, tell them I'll call back within the hour.", applies_to: 'contacts' },
    { category: 'family', text: 'Always put my parents through as urgent.', applies_to: 'contacts' },
    { category: 'work', text: "Tell work callers I'm in meetings until 5 PM and take a message.", applies_to: 'everyone' },
    { category: 'work', text: 'Ask what the call is about and whether it can wait until tomorrow.', applies_to: 'unknown' },
    { category: 'sales', text: "Say I'm not interested in loans, credit cards or insurance.", applies_to: 'unknown' },
    { category: 'sales', text: 'End surveys and promotional calls politely without taking a message.', applies_to: 'unknown' },
    { category: 'privacy', text: "Never say when I'm travelling or that nobody is home.", applies_to: 'everyone' },
    { category: 'privacy', text: "Don't confirm my full name or address to unknown callers.", applies_to: 'unknown' },
    { category: 'availability', text: "Tell callers I'm on leave this week and back on Monday.", applies_to: 'everyone' },
  ];

  return {
    health: {
      ok: true,
      version: '2.1.0',
      dialer: 'bluetooth',
      active_calls: 1,
      ready: { stt: true, tts: true, llm: true, mt: true, lid: true },
      llm_model: 'qwen2.5-3b-instruct-q4_k_m',
      phone_line: { ...LINE_READY },
    },
    profile,
    calls: [liveCall, amma, rajesh, scam, loan, paradise, bluedart, priya],
    messages,
    tasks,
    voices,
    templates,
  };
}
