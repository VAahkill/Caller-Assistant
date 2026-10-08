import { createFixtures } from '../mock/fixtures';
import { MockServer } from '../mock/server';
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
