import {
  api,
  BAD_ADDRESS,
  BAD_TOKEN,
  clearConfig,
  connect,
  currentConfig,
  isHttpError,
  loadConfig,
  normalizeServerUrl,
  NOT_SET_UP,
  onConfigChange,
  saveConfig,
  unreachableMessage,
  wsUrl,
} from '../api';
import { createFixtures } from '../mock/fixtures';
import { MOCK_TOKEN } from '../mock/server';
import { setTransport, type Transport } from '../transport';
import { resetApi, TEST_URL, useMockServer } from '../../test/mockApi';

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

afterEach(resetApi);

describe('normalizeServerUrl', () => {
  test.each([
    ['192.168.1.7:8000', 'http://192.168.1.7:8000'],
    ['  192.168.1.7:8000/  ', 'http://192.168.1.7:8000'],
    ['http://192.168.1.7:8000/health', 'http://192.168.1.7:8000'],
    ['HTTP://Desktop:8000', 'http://Desktop:8000'],
    ['desktop:8000', 'http://desktop:8000'],
    ['opencall-box.local:8000', 'http://opencall-box.local:8000'],
    ['pc.tail1234.ts.net:8000', 'http://pc.tail1234.ts.net:8000'],
    ['calls.example.org', 'https://calls.example.org'],
    ['https://abc-def.trycloudflare.com/', 'https://abc-def.trycloudflare.com'],
  ])('%s -> %s', (typed, expected) => {
    expect(normalizeServerUrl(typed)).toBe(expected);
  });

  test.each(['', '   ', 'http://', 'my server address', 'http://a b:80'])('rejects %p', (typed) => {
    expect(normalizeServerUrl(typed)).toBeNull();
  });
});

describe('config', () => {
  test('a malformed saved address counts as not set up', async () => {
    const SecureStore = require('expo-secure-store');
    await SecureStore.setItemAsync('server', JSON.stringify({ url: '', token: 'x' }));
    await clearConfig();
    await SecureStore.setItemAsync('server', JSON.stringify({ url: 'not a url', token: 'x' }));
    expect(await loadConfig()).toBeNull();
  });

  test('saved config round-trips and builds websocket URLs with the token', async () => {
    await saveConfig({ url: 'http://192.168.1.7:8000', token: '  s3cret/+ ' });
    expect(currentConfig()).toEqual({ url: 'http://192.168.1.7:8000', token: 's3cret/+' });
    expect(wsUrl('/ws/events')).toBe('ws://192.168.1.7:8000/ws/events?token=s3cret%2F%2B');
    expect(wsUrl('/ws/simulate?wav=1')).toBe('ws://192.168.1.7:8000/ws/simulate?wav=1&token=s3cret%2F%2B');
  });

  test('saving or clearing the server tells every listener', async () => {
    const seen: (string | null)[] = [];
    const off = onConfigChange((c) => seen.push(c ? c.url : null));
    await saveConfig({ url: TEST_URL, token: ' t ' });
    await clearConfig();
    off();
    await saveConfig({ url: TEST_URL, token: 't' });
    expect(seen).toEqual([TEST_URL, null]);
  });

  test('requests before setup explain what to do', async () => {
    await expect(api.profile()).rejects.toThrow(NOT_SET_UP);
  });
});

function fixedTransport(status: number, body: string): Transport {
  return {
    fetch: async () => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body }),
    openSocket: () => {
      throw new Error('no sockets here');
    },
    upload: async () => ({ status, body }),
  };
}

describe('errors', () => {
  beforeEach(() => saveConfig({ url: TEST_URL, token: 't' }));

  test('401 says to paste the token from .env', async () => {
    setTransport(fixedTransport(401, '{"detail":"bad token"}'));
    const failed = api.profile();
    await expect(failed).rejects.toMatchObject({ status: 401, message: BAD_TOKEN });
    await expect(failed.then(() => false, isHttpError)).resolves.toBe(true);
  });

  test('422 field errors are listed', async () => {
    setTransport(fixedTransport(422, '{"detail":[{"loc":["body","home_country_code"],"msg":"String should match pattern"}]}'));
    await expect(api.patchProfile({ home_country_code: '91' })).rejects.toThrow('Server said: String should match pattern');
  });

  test('an HTML error page falls back to the status', async () => {
    setTransport(fixedTransport(502, '<html>Bad gateway</html>'));
    await expect(api.messages()).rejects.toThrow('Server said: 502');
  });

  test('a 200 that is not JSON says the address may be wrong', async () => {
    setTransport(fixedTransport(200, '<html>Router login</html>'));
    await expect(api.messages()).rejects.toThrow("The server's reply wasn't readable");
  });

  test('upload errors use the same messages', async () => {
    setTransport(fixedTransport(401, '{"detail":"bad token"}'));
    await expect(api.addVoice('Me', 'file:///clip.m4a')).rejects.toThrow(BAD_TOKEN);
    setTransport(fixedTransport(422, '{"detail":"The recording is too short. Speak for at least 6 seconds."}'));
    await expect(api.addVoice('Me', 'file:///clip.m4a')).rejects.toThrow('Server said: The recording is too short');
  });
});

describe('connect', () => {
  test('refuses a malformed address without saving it', async () => {
    const r = await connect('my laptop', 'tok');
    expect(r).toEqual({ ok: false, url: null, message: BAD_ADDRESS });
    expect(await loadConfig()).toBeNull();
  });

  test('an unreachable https LAN address hints at http', async () => {
    setTransport({ ...fixedTransport(200, '{}'), fetch: async () => Promise.reject(new TypeError('Network request failed')) });
    const r = await connect('https://192.168.1.7:8000', 'tok');
    expect(r.ok).toBe(false);
    expect(r.message).toBe(unreachableMessage('https://192.168.1.7:8000'));
    expect(r.message).toContain('starts with http://, not https://');
  });

  test('an unreachable home address mentions Wi-Fi', async () => {
    setTransport({ ...fixedTransport(200, '{}'), fetch: async () => Promise.reject(new TypeError('Network request failed')) });
    const r = await connect('192.168.1.7:8000', 'tok');
    expect(r.message).toContain("Couldn't reach http://192.168.1.7:8000. At home, check the phone is on the same Wi-Fi");
  });

  test('a wrong token is reported after health answers', async () => {
    await useMockServer({ checkToken: true });
    const r = await connect(TEST_URL, 'wrong');
    expect(r).toEqual({ ok: false, url: TEST_URL, message: BAD_TOKEN });
  });

  test('success saves the address, normalised, and reports the dialer', async () => {
    const server = await useMockServer({ checkToken: true });
    const r = await connect('192.168.1.7:8000/', MOCK_TOKEN);
    expect(r.ok).toBe(true);
    expect(r.message).toBe('Connected. Outbound calling: Bluetooth phone.');
    expect(currentConfig()?.url).toBe(TEST_URL);
    server.state.health.dialer = 'none';
    expect((await connect(TEST_URL, MOCK_TOKEN)).message).toBe('Connected. Outbound calling: not set up.');
  });
});

describe('endpoints (against the v2 mock server)', () => {
  test('profile patch, away and country code validation', async () => {
    const server = await useMockServer();
    const p = await api.patchProfile({ caller_languages: ['te', 'en'], owner_language: 'en', translate_live: false });
    expect(p.caller_languages).toEqual(['te', 'en']);
    expect(p.translate_live).toBe(false);
    await expect(api.patchProfile({ home_country_code: '9198480' })).rejects.toThrow('Server said: String should match pattern');
    const away = await api.putAway({ preset: 'meeting', message: 'In a meeting until 3 PM', until: 1_900_000_000 });
    expect(away.away).toMatchObject({ preset: 'meeting', message: 'In a meeting until 3 PM', until: 1_900_000_000 });
    expect((await api.clearAway()).away).toBeNull();
    expect(server.log.map((r) => `${r.method} ${r.path}`)).toEqual(['PATCH /profile', 'PATCH /profile', 'PUT /away', 'DELETE /away']);
  });

  test('instructions: create with options, edit, templates, delete', async () => {
    const server = await useMockServer();
    const ins = await api.addInstruction({ text: 'Ask couriers to call after 6', applies_to: 'delivery', category: 'delivery', expires_at: null });
    expect(ins).toMatchObject({ text: 'Ask couriers to call after 6', applies_to: 'delivery', enabled: true, numbers: [] });
    const edited = await api.updateInstruction(ins.id, { enabled: false, numbers: ['+919848012345'], applies_to: 'numbers' });
    expect(edited).toMatchObject({ enabled: false, applies_to: 'numbers', numbers: ['+919848012345'] });
    const templates = await api.instructionTemplates();
    expect(templates.length).toBeGreaterThan(5);
    expect(templates[0]).toEqual({ category: expect.any(String), text: expect.any(String), applies_to: expect.any(String) });
    await api.deleteInstruction(ins.id);
    expect(server.state.profile.instructions.find((i) => i.id === ins.id)).toBeUndefined();
    expect(server.log.map((r) => r.method)).toEqual(['POST', 'PATCH', 'GET', 'DELETE']);
  });

  test('knowledge notes CRUD with share_with', async () => {
    await useMockServer();
    const n = await api.addNote({ text: 'Office: Cyber Towers', share_with: 'numbers', numbers: ['+919177001122'] });
    expect(n).toMatchObject({ share_with: 'numbers', numbers: ['+919177001122'], enabled: true });
    expect((await api.updateNote(n.id, { share_with: 'anyone' })).share_with).toBe('anyone');
    await expect(api.deleteNote(n.id)).resolves.toEqual({ ok: true });
  });

  test('block and unblock encode the number in the path', async () => {
    const server = await useMockServer();
    expect((await api.blockNumber('+911409999999')).blocked_numbers).toContain('+911409999999');
    expect((await api.unblockNumber('+911409999999')).blocked_numbers).not.toContain('+911409999999');
    expect(server.log[1].path).toBe('/contacts/block/%2B911409999999');
  });

  test('say sends lang only when given; answer passes the hold id', async () => {
    const server = await useMockServer();
    const live = server.state.calls[0].id;
    await api.say(live, 'Leave it with security');
    await api.say(live, 'సెక్యూరిటీకి ఇవ్వండి', 'te');
    expect(server.log.map((r) => r.body)).toEqual([{ text: 'Leave it with security' }, { text: 'సెక్యూరిటీకి ఇవ్వండి', lang: 'te' }]);
    await expect(api.say(live, '   ')).rejects.toThrow('Server said: Nothing was said');
    expect(await api.answer(live, 'Bring it up', 'hold-gate')).toEqual({ ok: true, mode: 'hold_answer' });
    await expect(api.say('call-amma', 'hi')).rejects.toThrow('Server said: call is not live');
  });

  test('sayAudio posts a multipart form with the clip and lang', async () => {
    const server = await useMockServer();
    const r = await api.sayAudio(server.state.calls[0].id, 'file:///data/clip.m4a', 'en');
    expect(r).toEqual({ ok: true, heard: expect.any(String) });
    const form = server.log[0].form!;
    expect(server.log[0].path).toBe(`/calls/${server.state.calls[0].id}/say-audio`);
    expect(form.get('lang')).toBe('en');
    expect((form.get('audio') as unknown as { uri: string }).uri).toBe('file:///data/clip.m4a');
  });

  test('calls list leaves out transcripts; a call has v2 fields', async () => {
    await useMockServer();
    const calls = await api.calls();
    expect(calls.length).toBe(createFixtures().calls.length);
    expect(calls.every((c) => c.transcript === undefined)).toBe(true);
    const c = await api.call('call-rajesh');
    expect(c.urgent).toBe(true);
    expect(c.action_items).toEqual(['Call Rajesh before 11 AM tomorrow', 'Have the floor plan ready']);
    expect(c.transcript[0]).toEqual(expect.objectContaining({ id: expect.any(String), lang: 'en', kind: 'speech' }));
  });

  test('voices: clones first, upload with progress, rename and delete by encoded id', async () => {
    const server = await useMockServer();
    const voices = await api.voices();
    expect(voices.findIndex((v) => v.kind === 'builtin')).toBe(voices.filter((v) => v.kind === 'clone').length);
    const progress: number[] = [];
    const v = await api.addVoice('Grandma', 'file:///data/rec.m4a', (f) => progress.push(f));
    expect(progress).toEqual([0.25, 0.5, 0.75, 1]);
    expect(v).toMatchObject({ name: 'Grandma', kind: 'clone', status: 'preparing' });
    expect(v.id).toMatch(/^clone:grandma-[0-9a-f]{6}$/);
    expect((await api.renameVoice(v.id, 'Nani')).name).toBe('Nani');
    await api.deleteVoice(v.id);
    expect(server.log.slice(-2).map((r) => r.path)).toEqual([`/voices/${encodeURIComponent(v.id)}`, `/voices/${encodeURIComponent(v.id)}`]);
    expect(server.log.slice(-2)[0].path).toContain('clone%3Agrandma-');
  });

  test('media sources carry the token in a header, not the URL', async () => {
    await useMockServer();
    const [mine] = await api.voices();
    expect(api.voiceSample(mine)).toEqual({ uri: `${TEST_URL}${mine.sample_url}`, headers: { Authorization: `Bearer ${MOCK_TOKEN}` } });
    expect(api.voiceRecording(mine)?.uri).toBe(`${TEST_URL}/voices/clone%3Amy-voice-3f2a1c/recording`);
    expect(api.recordingSource('call-amma')).toEqual({ uri: `${TEST_URL}/calls/call-amma/recording`, headers: { Authorization: `Bearer ${MOCK_TOKEN}` } });
  });

  test('pairing needs no token and explains a wrong code', async () => {
    const server = await useMockServer({ checkToken: true });
    await clearConfig();
    expect(await api.pairStart(TEST_URL)).toEqual({ ok: true, expires_in: 300 });
    await expect(api.pairFinish(TEST_URL, '000000')).rejects.toThrow("Server said: That code didn't match");
    expect(await api.pairFinish(TEST_URL, '482 913')).toEqual({ token: MOCK_TOKEN });
    expect(server.log[2].body).toEqual({ code: '482913' });
  });

  test('messages, tasks, chat and contacts', async () => {
    await useMockServer();
    expect((await api.markRead('msg-amma')).status).toBe('read');
    expect((await api.replyMessage('msg-rajesh', 'Will call at 10', false)).status).toBe('replied');
    const t = await api.createTask('+914023456789', 'Book a table for 2', 'book', 'Paradise');
    expect(t).toMatchObject({ status: 'queued', kind: 'book' });
    expect((await api.tasks())[0].id).toBe(t.id);
    expect((await api.chat('who called?')).reply).toContain('Amma');
    expect(await api.putContacts([{ number: '+919848012345', name: 'Amma' }])).toEqual({ count: 1 });
  });
});

describe('older servers', () => {
  function legacy(bodyFor: (path: string) => unknown): Transport {
    return {
      ...fixedTransport(200, '{}'),
      fetch: async (url) => {
        const body = JSON.stringify(bodyFor(url.replace(TEST_URL, '')));
        return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
      },
    };
  }

  test('a v1 profile gets v2 defaults, keeping its old languages as caller languages', async () => {
    await saveConfig({ url: TEST_URL, token: 't' });
    setTransport(legacy(() => ({ user_name: 'Arjun', assistant_name: 'Ava', languages: ['en', 'te'], instructions: [{ id: 'a', text: 'x' }] })));
    const p = await api.profile();
    expect(p).toMatchObject({
      caller_languages: ['en', 'te'],
      owner_language: 'en',
      translate_live: true,
      voices_by_language: {},
      blocked_numbers: [],
      vip_numbers: [],
      away: null,
    });
    expect(p.instructions[0]).toMatchObject({ enabled: true, applies_to: 'everyone', category: 'general', expires_at: null });
  });

  test('v1 voices get a demo through /assistant/speak; v1 health has no readiness', async () => {
    await saveConfig({ url: TEST_URL, token: 't' });
    setTransport(
      legacy((path) =>
        path === '/voices'
          ? [{ id: 'kokoro:af_heart', name: 'Heart', kind: 'builtin', languages: ['en'], gender: 'female' }]
          : { ok: true, dialer: 'none', active_calls: 0 },
      ),
    );
    const [v] = await api.voices();
    expect(v).toMatchObject({ engine: 'kokoro', status: 'ready', recording_url: '', seconds: null });
    expect(v.sample_url).toMatch(/^\/assistant\/speak\?voice=kokoro%3Aaf_heart&lang=en&text=/);
    expect(await api.health()).toEqual({ ok: true, version: '', dialer: 'none', active_calls: 0, ready: null, llm_model: '' });
  });
});
