import { createFixtures } from '../mock/fixtures';
import { MockServer, mockTransport } from '../mock/server';
import { normalizeCall, normalizeHealth, normalizeProfile, normalizeVoice } from '../normalize';

const fx = createFixtures(1_760_000_000);

describe('fixtures are complete v2 shapes', () => {
  test('profile has every v2 field (normalising changes nothing)', () => {
    expect(normalizeProfile(fx.profile)).toEqual(fx.profile);
  });

  test('calls, health and voices round-trip through the normalisers unchanged', () => {
    for (const c of fx.calls) expect(normalizeCall(c)).toEqual(c);
    expect(normalizeHealth(fx.health)).toEqual(fx.health);
    for (const v of fx.voices) expect(normalizeVoice(v)).toEqual(v);
  });

  test('transcript line ids are unique and every kind appears', () => {
    const lines = fx.calls.flatMap((c) => c.transcript);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    expect(new Set(lines.map((l) => l.kind))).toEqual(new Set(['speech', 'hold_question', 'alert']));
    expect(new Set(lines.map((l) => l.lang))).toEqual(new Set(['en', 'te', 'hi']));
  });

  test('the demo covers the states screens must handle', () => {
    expect(fx.calls.some((c) => c.status === 'on_hold' && c.holds.some((h) => !h.answer))).toBe(true);
    expect(fx.calls.some((c) => c.status === 'rejected')).toBe(true);
    expect(fx.calls.some((c) => c.urgent && c.action_items.length)).toBe(true);
    expect(fx.calls.some((c) => c.direction === 'outbound')).toBe(true);
    expect(new Set(fx.tasks.map((t) => t.status))).toEqual(new Set(['in_call', 'done', 'failed']));
    expect(new Set(fx.voices.map((v) => v.status))).toEqual(new Set(['ready', 'preparing']));
    expect(new Set(fx.profile.instructions.map((i) => i.applies_to))).toEqual(new Set(['delivery', 'everyone', 'numbers', 'unknown']));
    expect(new Set(fx.profile.knowledge.map((k) => k.share_with))).toEqual(new Set(['contacts', 'delivery', 'anyone']));
  });

  test('nothing in the demo data reveals a secret the assistant must never say', () => {
    const said = fx.calls.flatMap((c) => c.transcript.filter((l) => l.speaker === 'assistant').map((l) => l.text + l.translation));
    for (const s of said) expect(s).not.toMatch(/\d{4,}/);
  });
});

describe('every API contract v2 endpoint is served by the mock', () => {
  const server = new MockServer({ state: createFixtures() });
  const req = (method: string, path: string, body: unknown = {}) => {
    const [p, q = ''] = path.split('?');
    return server.handle({ method, path: p, query: new URLSearchParams(q), body, form: null }, null);
  };

  // One object per row: jest would read a third parameter as a done callback.
  test.each(([
    ['GET', '/health'],
    ['GET', '/profile'],
    ['PATCH', '/profile', { owner_language: 'te' }],
    ['PUT', '/away', { preset: 'meeting', message: 'In a meeting', until: null }],
    ['DELETE', '/away'],
    ['PUT', '/location', { ...createFixtures().profile.location }],
    ['POST', '/location/from-link', { text: 'https://maps.google.com/?q=@17.46,78.36' }],
    ['GET', '/instructions/templates'],
    ['POST', '/instructions', { text: 'Be brief', applies_to: 'everyone' }],
    ['PATCH', '/instructions/ins-delivery', { enabled: false }],
    ['DELETE', '/instructions/ins-privacy'],
    ['POST', '/knowledge', { text: 'Office hours 9 to 6', share_with: 'anyone' }],
    ['PATCH', '/knowledge/note-office', { share_with: 'anyone' }],
    ['DELETE', '/knowledge/note-gates'],
    ['PUT', '/contacts', [{ number: '+911', name: 'x' }]],
    ['POST', '/contacts/block', { number: '+911402222222' }],
    ['DELETE', '/contacts/block/+911402222222'],
    ['POST', '/push/register', { token: 'ExponentPushToken[x]' }],
    ['GET', '/calls?limit=10'],
    ['GET', '/calls/call-amma'],
    ['POST', '/calls/call-live-swiggy/say', { text: 'hi', lang: 'en' }],
    ['POST', '/calls/call-live-swiggy/say-audio'],
    ['POST', '/calls/call-live-swiggy/answer', { text: 'Bring it up', hold_id: 'hold-gate' }],
    ['GET', '/messages'],
    ['POST', '/messages/msg-amma/read'],
    ['POST', '/messages/msg-amma/reply', { text: 'Coming Sunday', call_back: false }],
    ['GET', '/tasks'],
    ['POST', '/tasks', { number: '+914023456789', goal: 'Book', kind: 'book' }],
    ['POST', '/assistant/chat', { text: 'who called' }],
    ['POST', '/assistant/voice'],
    ['GET', '/voices'],
    ['PATCH', '/voices/clone:my-voice-3f2a1c', { label: 'Me' }],
    ['DELETE', '/voices/clone:dad-91b2e0'],
    ['POST', '/pair/start'],
    ['POST', '/pair/finish', { code: '482913' }],
    ['POST', '/calls/call-live-swiggy/end'],
  ] as [string, string, unknown?][]).map(([method, path, body]) => ({ method, path, body })))('$method $path', ({ method, path, body }) => {
    const r = req(method, path, body);
    expect(r.status).toBe(200);
  });
});

describe('owner actions over REST reach the live events socket', () => {
  test('POST /calls/{id}/say adds a translated owner line and status events', async () => {
    const t = mockTransport(new MockServer({ state: createFixtures() }));
    const events: Record<string, unknown>[] = [];
    const socket = t.openSocket('ws://x/ws/events?token=demo-token');
    socket.onmessage = (m) => events.push(JSON.parse(String(m.data)));
    await new Promise((r) => setTimeout(r, 5));
    const before = t.server.state.calls.find((c) => c.id === 'call-live-swiggy')!.transcript.length;
    const r = await t.fetch('http://x/calls/call-live-swiggy/say', { method: 'POST', body: JSON.stringify({ text: 'Bring it up', lang: 'en' }) });
    expect(r.ok).toBe(true);
    await new Promise((res) => setTimeout(res, 5));
    const line = events.find((e) => e.event === 'transcript' && (e.line as { speaker: string }).speaker === 'user')?.line as Record<string, string>;
    expect(line).toMatchObject({ speaker: 'user', lang: 'te', translation: 'Bring it up', translation_lang: 'en' });
    expect(events.filter((e) => e.event === 'assistant_status').map((e) => e.state)).toEqual(['translating', 'speaking', 'listening']);
    expect(t.server.state.calls.find((c) => c.id === 'call-live-swiggy')!.transcript.length).toBe(before + 1);
    socket.close();
    expect(t.server.liveSockets.size).toBe(0);
  });

  test('an empty say is refused and nothing is said', async () => {
    const server = new MockServer({ state: createFixtures() });
    const r = server.handle({ method: 'POST', path: '/calls/call-live-swiggy/say', query: new URLSearchParams(), body: { text: ' ' }, form: null }, null);
    expect(r.status).toBe(422);
    expect(server.state.calls.find((c) => c.id === 'call-live-swiggy')!.transcript.some((l) => l.speaker === 'user')).toBe(false);
  });
});

describe('recorded voices in the mock', () => {
  const call = (server: MockServer, method: string, path: string) =>
    server.handle({ method, path, query: new URLSearchParams(), body: {}, form: null }, null);
  const dad = (server: MockServer) => server.state.voices.find((v) => v.id === 'clone:dad-91b2e0');

  test('a preparing voice turns ready on the second list, and says so on the events socket', () => {
    const server = new MockServer({ state: createFixtures() });
    const pushed: Record<string, unknown>[] = [];
    server.liveSockets.add({ push: (ev) => pushed.push(ev) });
    call(server, 'GET', '/voices');
    expect(dad(server)?.status).toBe('preparing');
    call(server, 'GET', '/voices');
    expect(dad(server)?.status).toBe('ready');
    expect(pushed).toEqual([{ event: 'voice_status', voice_id: 'clone:dad-91b2e0', status: 'ready', detail: '' }]);
  });

  test('readyAfterPolls null keeps it preparing', () => {
    const server = new MockServer({ state: createFixtures() });
    server.readyAfterPolls = null;
    for (let i = 0; i < 5; i++) call(server, 'GET', '/voices');
    expect(dad(server)?.status).toBe('preparing');
  });

  test('deleting a voice clears it wherever it was picked', () => {
    const server = new MockServer({ state: createFixtures() });
    server.state.profile = { ...server.state.profile, voice: 'clone:my-voice-3f2a1c', voices_by_language: { en: 'clone:my-voice-3f2a1c', hi: 'clone:my-voice-3f2a1c', te: 'piper:te_IN-padmavathi-medium' } };
    expect(call(server, 'DELETE', '/voices/clone:my-voice-3f2a1c').status).toBe(200);
    expect(server.state.profile.voice).toBe('kokoro:af_heart');
    expect(server.state.profile.voices_by_language).toEqual({ te: 'piper:te_IN-padmavathi-medium' });
    expect(call(server, 'DELETE', '/voices/kokoro:af_heart').status).toBe(404);
  });
});
