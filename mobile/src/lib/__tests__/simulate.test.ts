import { BAD_TOKEN, saveConfig } from '../api';
import type { ServerEvent } from '../events';
import { MOCK_TOKEN } from '../mock/server';
import { PracticeCall, practiceUrl, type PracticeHandlers } from '../simulate';
import { setTransport, type SocketLike, type Transport } from '../transport';
import { resetApi, useMockServer } from '../../test/mockApi';

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

afterEach(resetApi);

const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

function recorder() {
  const events: ServerEvent[] = [];
  const closes: { code: number; message: string | null }[] = [];
  const handlers: PracticeHandlers = {
    onEvent: (e) => events.push(e),
    onAudio: () => undefined,
    onClose: (c) => closes.push(c),
  };
  return { events, closes, handlers };
}

test('practiceUrl asks for WAV sentences and passes the language hint', async () => {
  await saveConfig({ url: 'http://192.168.1.7:8000', token: 'tok' });
  expect(practiceUrl({ lang: 'te' })).toBe('ws://192.168.1.7:8000/ws/simulate?number=%2B919800000000&wav=1&lang=te&token=tok');
  expect(practiceUrl()).toBe('ws://192.168.1.7:8000/ws/simulate?number=%2B919800000000&wav=1&token=tok');
});

test('a full practice call: greeting, typed Telugu line, translation, reply, owner interjection, hang-up', async () => {
  await useMockServer();
  const r = recorder();
  const call = await PracticeCall.start({ lang: '' }, r.handlers);
  expect(call.callId).toMatch(/^practice-/);
  await until(() => r.events.some((e) => e.event === 'transcript'), 'the greeting');

  await expect(call.sendText('నమస్తే, మీ ఆర్డర్ తీసుకొచ్చాను')).resolves.toBeUndefined();
  await until(() => r.events.filter((e) => e.event === 'transcript').length >= 3, 'the reply');
  const lines = r.events.flatMap((e) => (e.event === 'transcript' ? [e.line] : []));
  expect(lines[1]).toMatchObject({ speaker: 'caller', lang: 'te' });
  expect(r.events).toContainEqual(expect.objectContaining({ event: 'call_language', language: 'te' }));
  expect(r.events).toContainEqual(expect.objectContaining({ event: 'transcript_update', line_id: lines[1].id, translation_lang: 'en' }));
  expect(lines[2]).toMatchObject({ speaker: 'assistant', lang: 'te', text: expect.stringContaining('గేట్ 2') });

  await expect(call.say('Please leave it with security')).resolves.toBeUndefined();
  await until(() => r.events.some((e) => e.event === 'transcript' && e.line.speaker === 'user'), 'the owner line');
  const mine = r.events.find((e) => e.event === 'transcript' && e.line.speaker === 'user');
  expect(mine?.event === 'transcript' && mine.line).toMatchObject({ lang: 'te', translation: 'Please leave it with security' });

  call.hangup();
  await until(() => r.closes.length > 0, 'the close');
  expect(r.events.at(-1)).toMatchObject({ event: 'call_ended' });
  expect(r.closes).toEqual([{ code: 1000, message: null }]);
  await expect(call.sendText('hello?')).rejects.toThrow('The practice call has ended. Start a new one.');
});

test('input the server refuses is reported, never dropped', async () => {
  await useMockServer();
  const r = recorder();
  const call = await PracticeCall.start({}, r.handlers);
  await expect(call.sendText('   ')).rejects.toThrow('The message was empty.');
  await expect(call.sendAudio('')).rejects.toThrow('That recording was empty');
  await expect(call.sendAudio('QUFBQQ==', 'te')).resolves.toBeUndefined();
  expect(call.waiting).toBe(0);
  call.hangup();
});

test('a wrong token fails the start with the token message', async () => {
  await useMockServer({ checkToken: true });
  await saveConfig({ url: 'http://192.168.1.7:8000', token: 'wrong' });
  await expect(PracticeCall.start({}, recorder().handlers)).rejects.toThrow(BAD_TOKEN);
  expect(MOCK_TOKEN).not.toBe('wrong');
});

// A socket the test drives by hand.
class HandSocket implements SocketLike {
  readyState = 1;
  binaryType = '';
  sent: string[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;
  send(d: string) {
    this.sent.push(d);
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  push(e: unknown) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
}

function handTransport(socket: HandSocket): Transport {
  return {
    fetch: async () => {
      throw new Error('unused');
    },
    openSocket: () => socket,
    upload: async () => {
      throw new Error('unused');
    },
  };
}

test('screening that rejects the number is explained', async () => {
  await saveConfig({ url: 'http://192.168.1.7:8000', token: 't' });
  const socket = new HandSocket();
  setTransport(handTransport(socket));
  const p = PracticeCall.start({ number: '+14155550100' }, recorder().handlers);
  await tick();
  socket.push({ event: 'rejected', reason: 'International calls are blocked' });
  await expect(p).rejects.toThrow("The assistant wouldn't take this call: International calls are blocked");
});

test('a missing ack times out, and the late ack is not credited to the next message', async () => {
  await saveConfig({ url: 'http://192.168.1.7:8000', token: 't' });
  const socket = new HandSocket();
  setTransport(handTransport(socket));
  const p = PracticeCall.start({}, recorder().handlers);
  await tick();
  socket.push({ event: 'started', call_id: 'c1' });
  const call = await p;

  jest.useFakeTimers();
  try {
    const first = call.sendText('one');
    jest.advanceTimersByTime(20_001);
    await expect(first).rejects.toThrow("The server didn't confirm that message");
    const second = call.sendText('two');
    let settled = false;
    void second.then(
      () => (settled = true),
      () => (settled = true),
    );
    socket.push({ event: 'ack', kind: 'text' }); // the late ack for "one"
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.push({ event: 'error', detail: 'The call has ended.' }); // the answer for "two"
    await expect(second).rejects.toThrow('The call has ended.');
  } finally {
    jest.useRealTimers();
  }
});

test('a dropped connection rejects what was waiting and says why', async () => {
  await saveConfig({ url: 'http://192.168.1.7:8000', token: 't' });
  const socket = new HandSocket();
  setTransport(handTransport(socket));
  const r = recorder();
  const p = PracticeCall.start({}, r.handlers);
  await tick();
  socket.push({ event: 'started', call_id: 'c1' });
  const call = await p;
  const pending = call.sendText('hello');
  socket.close(1006, '');
  await expect(pending).rejects.toThrow('The practice call ended before the server answered.');
  expect(r.closes).toEqual([{ code: 1006, message: 'The practice call was cut off. Check the connection to your server.' }]);
});
