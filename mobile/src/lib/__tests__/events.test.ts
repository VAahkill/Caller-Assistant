import { callView, initialLive, liveReducer, parseEvent, reduceCall, type LiveData, type ServerEvent } from '../events';
import { createFixtures, LIVE_CALL_ID, LIVE_HOLD_ID } from '../mock/fixtures';
import type { TranscriptLine } from '../types';

const fx = createFixtures(1_760_000_000);
const live = fx.calls.find((c) => c.id === LIVE_CALL_ID)!;
const who = 'Swiggy partner';

function ev(e: Record<string, unknown>): ServerEvent {
  const parsed = parseEvent(JSON.stringify(e));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.event as ServerEvent;
}

const apply = (state: LiveData, ...events: ServerEvent[]) =>
  events.reduce((s, e) => liveReducer(s, { type: 'event', event: e, now: 1_760_000_100 }), state);

const line = (id: string, extra: Partial<TranscriptLine> = {}): TranscriptLine => ({
  id,
  speaker: 'caller',
  text: 'గేట్ దగ్గర ఉన్నాను',
  lang: 'te',
  translation: '',
  translation_lang: '',
  english: '',
  at: 1_760_000_050,
  kind: 'speech',
  ...extra,
});

describe('parseEvent', () => {
  test('accepts every v2 event and fills optional fields', () => {
    const cases: Record<string, unknown>[] = [
      { event: 'call_snapshot', call: live },
      { event: 'call_started', call: live, call_id: live.id, who },
      { event: 'transcript', call_id: live.id, who, line: line('a') },
      { event: 'transcript_update', call_id: live.id, who, line_id: 'a', translation: "I'm at the gate", translation_lang: 'en' },
      { event: 'assistant_status', call_id: live.id, who, state: 'thinking' },
      { event: 'call_language', call_id: live.id, who, language: 'te', confidence: 0.93 },
      { event: 'turn_error', call_id: live.id, who, detail: "Couldn't make out any words in that recording." },
      { event: 'call_category', call_id: live.id, who, category: 'delivery' },
      { event: 'hold_question', call_id: live.id, who, hold_id: 'h', question: 'Security or door?', title: 't', task_id: null },
      { event: 'hold_resolved', call_id: live.id, who, hold_id: 'h', answered: true },
      { event: 'sensitive_request', call_id: live.id, who, kind: 'otp', text: 'Asked for an OTP', said: 'OTP chepandi' },
      { event: 'call_ended', call: live, call_id: live.id, who },
      { event: 'message_taken', message: fx.messages[0], call_id: 'x', who: 'Amma' },
      { event: 'task_update', task: fx.tasks[0], task_id: fx.tasks[0].id, title: 'Calling' },
      { event: 'profile_updated' },
      { event: 'error', detail: 'That call is no longer live.', call_id: 'x' },
      { event: 'started', call_id: 'p1' },
      { event: 'rejected', reason: 'international' },
      { event: 'ack', kind: 'text' },
    ];
    for (const c of cases) expect(parseEvent(JSON.stringify(c))).toMatchObject({ ok: true, event: { event: c.event } });
  });

  test('older call_started without call_id/who takes them from the call', () => {
    expect(ev({ event: 'call_started', call: { ...live, contact_name: 'Ravi' } })).toMatchObject({ call_id: live.id, who: 'Ravi' });
  });

  test('a transcript line from an older server gets an id and v2 defaults', () => {
    const e = ev({ event: 'transcript', call_id: 'c1', line: { speaker: 'caller', text: 'hello', at: 5 } });
    expect(e.event === 'transcript' && e.line).toMatchObject({ id: expect.stringMatching(/^c1-/), lang: '', translation: '', kind: 'speech' });
  });

  test('reports bad input instead of throwing', () => {
    expect(parseEvent('not json')).toEqual({ ok: false, reason: 'not JSON' });
    expect(parseEvent('{"no":"event"}')).toEqual({ ok: false, reason: 'no event name' });
    expect(parseEvent('{"event":"brand_new_thing"}')).toEqual({ ok: false, reason: 'unknown event brand_new_thing' });
    expect(parseEvent('{"event":"transcript","call_id":"c"}')).toEqual({ ok: false, reason: 'transcript without line' });
  });
});

describe('liveReducer', () => {
  const withLive = apply(initialLive, ev({ event: 'call_snapshot', call: live }));

  test('a snapshot of a call on hold restores its open question', () => {
    expect(Object.keys(withLive.calls)).toEqual([LIVE_CALL_ID]);
    expect(withLive.questions).toEqual([
      expect.objectContaining({ callId: LIVE_CALL_ID, holdId: LIVE_HOLD_ID, isTask: false, question: expect.stringContaining('security') }),
    ]);
    // A second snapshot (reconnect) doesn't duplicate it.
    expect(apply(withLive, ev({ event: 'call_snapshot', call: live })).questions).toHaveLength(1);
  });

  test('transcript lines are de-duplicated by id and translations merge in later', () => {
    const s = apply(
      withLive,
      ev({ event: 'transcript', call_id: LIVE_CALL_ID, who, line: line('n1') }),
      ev({ event: 'transcript', call_id: LIVE_CALL_ID, who, line: line('n1') }),
      ev({ event: 'transcript_update', call_id: LIVE_CALL_ID, who, line_id: 'n1', translation: "I'm at the gate", translation_lang: 'en' }),
    );
    const lines = s.calls[LIVE_CALL_ID].record.transcript;
    expect(lines.filter((l) => l.id === 'n1')).toHaveLength(1);
    expect(lines.at(-1)).toMatchObject({ id: 'n1', translation: "I'm at the gate", translation_lang: 'en' });
    // A repeat without the translation keeps the one already shown.
    const again = apply(s, ev({ event: 'transcript', call_id: LIVE_CALL_ID, who, line: line('n1') }));
    expect(again.calls[LIVE_CALL_ID].record.transcript.at(-1)?.translation).toBe("I'm at the gate");
  });

  test('status, language and turn errors are kept per call', () => {
    const s = apply(
      withLive,
      ev({ event: 'assistant_status', call_id: LIVE_CALL_ID, who, state: 'translating', detail: 'te→en' }),
      ev({ event: 'call_language', call_id: LIVE_CALL_ID, who, language: 'ta', confidence: 0.81 }),
      ev({ event: 'turn_error', call_id: LIVE_CALL_ID, who, detail: 'The reply took too long.' }),
    );
    const v = s.calls[LIVE_CALL_ID];
    expect(v).toMatchObject({ status: 'translating', statusDetail: 'te→en', language: 'ta', languageConfidence: 0.81 });
    expect(v.record.language).toBe('ta');
    expect(v.errors).toEqual([{ at: 1_760_000_100, detail: 'The reply took too long.' }]);
  });

  test('hold resolved clears the question and resumes the call', () => {
    const s = apply(withLive, ev({ event: 'hold_resolved', call_id: LIVE_CALL_ID, who, hold_id: LIVE_HOLD_ID, answered: true }));
    expect(s.questions).toEqual([]);
    expect(s.calls[LIVE_CALL_ID].record.status).toBe('active');
  });

  test('a new hold question is queued once, and task decisions are marked', () => {
    const q = { call_id: LIVE_CALL_ID, who, hold_id: 'h2', question: 'Cash or paid?', title: 'x', task_id: 'task-1' };
    const s = apply(withLive, ev({ event: 'task_needs_decision', ...q }), ev({ event: 'task_needs_decision', ...q }));
    expect(s.questions.filter((x) => x.holdId === 'h2')).toEqual([expect.objectContaining({ isTask: true, taskId: 'task-1' })]);
  });

  test('call_ended removes the call and its questions and asks lists to refresh', () => {
    const s = apply(withLive, ev({ event: 'call_ended', call: { ...live, status: 'ended', ended_at: 1 }, call_id: LIVE_CALL_ID, who }));
    expect(s.calls).toEqual({});
    expect(s.questions).toEqual([]);
    expect(s.refreshKey).toBe(withLive.refreshKey + 1);
  });

  test('security alerts collect newest first and can be dismissed', () => {
    const a = ev({ event: 'sensitive_request', call_id: LIVE_CALL_ID, who, kind: 'otp', text: 'Asked for an OTP', said: '' });
    const s = apply(withLive, a, a);
    expect(s.alerts).toHaveLength(2);
    expect(s.alerts[0]).toMatchObject({ kind: 'otp', who, text: 'Asked for an OTP' });
    const after = liveReducer(s, { type: 'dismissAlert', id: s.alerts[0].id });
    expect(after.alerts).toHaveLength(1);
  });

  test('only list-changing events bump refreshKey; profile changes bump profileKey', () => {
    const s = apply(withLive, ev({ event: 'assistant_status', call_id: LIVE_CALL_ID, who, state: 'speaking' }));
    expect(s.refreshKey).toBe(withLive.refreshKey);
    expect(apply(s, ev({ event: 'message_taken', message: fx.messages[0], call_id: 'x', who: 'Amma' })).refreshKey).toBe(s.refreshKey + 1);
    expect(apply(s, ev({ event: 'profile_updated' })).profileKey).toBe(s.profileKey + 1);
    const t = apply(s, ev({ event: 'task_update', task: fx.tasks[0], task_id: fx.tasks[0].id, title: 'x' }));
    expect(t.tasks[fx.tasks[0].id]).toEqual(fx.tasks[0]);
  });

  test('events for unknown calls change nothing', () => {
    const s = apply(withLive, ev({ event: 'assistant_status', call_id: 'other', who, state: 'speaking' }));
    expect(s).toBe(withLive);
  });

  test('reset (reconnect) then dropStale drops calls the server no longer reports, but keeps alerts', () => {
    const a = apply(withLive, ev({ event: 'sensitive_request', call_id: LIVE_CALL_ID, who, kind: 'pin', text: 'PIN', said: '' }));
    const r = liveReducer(a, { type: 'reset' });
    // Still on screen (stale) until the snapshots have had time to arrive.
    expect(r.calls[LIVE_CALL_ID].stale).toBe(true);
    expect(r.questions).toHaveLength(1);
    const dropped = liveReducer(r, { type: 'dropStale' });
    expect(dropped.calls).toEqual({});
    expect(dropped.questions).toEqual([]);
    expect(dropped.alerts).toHaveLength(1);
  });

  test('a call sent again in the snapshot after a reconnect stays, with its open question once', () => {
    const r = apply(liveReducer(withLive, { type: 'reset' }), ev({ event: 'call_snapshot', call: live }));
    expect(r.calls[LIVE_CALL_ID].stale).toBe(false);
    const after = liveReducer(r, { type: 'dropStale' });
    expect(after).toBe(r);
    expect(after.questions.filter((q) => q.holdId === LIVE_HOLD_ID)).toHaveLength(1);
  });

  test('a snapshot showing the hold was answered while away removes its question', () => {
    const answered = { ...live, status: 'active' as const, holds: live.holds.map((h) => ({ ...h, answer: 'Bring it up', answered_at: 1 })) };
    const r = apply(liveReducer(withLive, { type: 'reset' }), ev({ event: 'call_snapshot', call: answered }));
    expect(r.questions).toEqual([]);
  });
});

test('reduceCall works on its own for the practice screen', () => {
  const v = reduceCall(callView({ ...live, transcript: [] }), ev({ event: 'transcript', call_id: live.id, who, line: line('z') }));
  expect(v.record.transcript.map((l) => l.id)).toEqual(['z']);
});

test('a final record without lines keeps the transcript already on screen', () => {
  let v = reduceCall(callView({ ...live, transcript: [] }), ev({ event: 'transcript', call_id: live.id, who, line: line('a') }));
  v = reduceCall(v, ev({ event: 'call_ended', call_id: live.id, call: { ...live, status: 'completed', transcript: [] } }));
  expect(v.status).toBe('idle');
  expect(v.record.status).toBe('completed');
  expect(v.record.transcript.map((l) => l.id)).toEqual(['a']);

  // A record that does carry lines is the final word.
  v = reduceCall(v, ev({ event: 'call_ended', call_id: live.id, call: { ...live, transcript: [line('b')] } }));
  expect(v.record.transcript.map((l) => l.id)).toEqual(['b']);
});

describe('reduceCall, one call on its own (practice and the live screen)', () => {
  const base = callView({ ...live, transcript: [line('a')] });
  const at = 1_760_000_200;

  test('a translation for a line not on screen changes nothing', () => {
    const v = reduceCall(base, ev({ event: 'transcript_update', call_id: live.id, who, line_id: 'missing', translation: 'x', translation_lang: 'en' }));
    expect(v).toBe(base);
  });

  test('assistant_status replaces the detail, and clears it when none is sent', () => {
    let v = reduceCall(base, ev({ event: 'assistant_status', call_id: live.id, who, state: 'idle', detail: 'waiting for Arjun' }));
    expect(v).toMatchObject({ status: 'idle', statusDetail: 'waiting for Arjun' });
    v = reduceCall(v, ev({ event: 'assistant_status', call_id: live.id, who, state: 'thinking' }));
    expect(v).toMatchObject({ status: 'thinking', statusDetail: '' });
  });

  test('only the last five turn errors are kept', () => {
    let v = base;
    for (let i = 0; i < 7; i++) v = reduceCall(v, ev({ event: 'turn_error', call_id: live.id, who, detail: `e${i}` }), at + i);
    expect(v.errors.map((e) => e.detail)).toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
  });

  test('a hold puts the call on hold; resolving it marks the hold done and resumes', () => {
    const fresh = callView({ ...live, status: 'active', holds: [], transcript: [] });
    let v = reduceCall(fresh, ev({ event: 'hold_question', call_id: live.id, who, hold_id: 'h9', question: 'Bring it up?' }), at);
    expect(v.record.status).toBe('on_hold');
    expect(v.record.holds).toEqual([{ id: 'h9', question: 'Bring it up?', asked_at: at, answer: null, answered_at: null, sensitive: false }]);
    v = reduceCall(v, ev({ event: 'hold_resolved', call_id: live.id, who, hold_id: 'h9', answered: true }), at + 5);
    expect(v.record.status).toBe('active');
    expect(v.record.holds[0].answered_at).toBe(at + 5);
  });
});

describe('alerts and refreshes the app asks for', () => {
  const a = (id: string, at: number) => ({ id, callId: 'c', who: 'x', kind: 'otp', text: '', said: '', at });

  test('a dismissed alert can be put back, in time order, once', () => {
    const s = { ...initialLive, alerts: [a('new', 300), a('old', 100)] };
    const restored = liveReducer(s, { type: 'restoreAlert', alert: a('mid', 200) });
    expect(restored.alerts.map((x) => x.id)).toEqual(['new', 'mid', 'old']);
    expect(liveReducer(restored, { type: 'restoreAlert', alert: a('mid', 200) })).toBe(restored);
  });

  test('invalidate reloads lists and the profile', () => {
    const s = liveReducer(initialLive, { type: 'invalidate' });
    expect(s.refreshKey).toBe(initialLive.refreshKey + 1);
    expect(s.profileKey).toBe(initialLive.profileKey + 1);
  });
});
