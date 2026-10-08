// Regression test for owner item 6: recording a voice failed with
// "Unsupported FormDataPart implementation". SDK 57's fetch (expo/fetch)
// encodes FormData with convertFormDataAsync, which only accepts strings,
// Blobs and objects with bytes(). These run that encoder over the exact forms
// api.ts sends, on React Native's FormData patched the way the app's runtime
// patches it (see jest.setup.ts).

import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';

import { api, audioForm, saveConfig } from '../api';
import { setTransport, type RequestInitLike, type Transport } from '../transport';

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

const CLIP = 'file:///data/user/0/org.opencall.receptionist/cache/Audio/recording-1.m4a';

const decode = (body: Uint8Array) => new TextDecoder().decode(body);

function capture(): { sent: RequestInitLike[]; transport: Transport } {
  const sent: RequestInitLike[] = [];
  const reply = '{"ok":true,"heard":"x","reply":"y","actions":[]}';
  return {
    sent,
    transport: {
      fetch: async (_url, init = {}) => {
        sent.push(init);
        return { ok: true, status: 200, json: async () => JSON.parse(reply), text: async () => reply };
      },
      openSocket: () => {
        throw new Error('unused');
      },
      upload: async () => ({ status: 200, body: reply }),
    },
  };
}

afterEach(() => setTransport(null));

test('the recording form encodes: fields first, then the clip with its name and type', async () => {
  const { body } = await convertFormDataAsync(audioForm(CLIP, { lang: 'te' }), 'BOUNDARY');
  expect(decode(body)).toBe(
    '--BOUNDARY\r\n' +
      'content-disposition: form-data; name="lang"\r\n\r\n' +
      'te\r\n' +
      '--BOUNDARY\r\n' +
      'content-disposition: form-data; name="audio"; filename="recording-1.m4a"\r\n' +
      'content-type: audio/mp4\r\n\r\n' +
      'AUDIO(recording-1.m4a)\r\n' +
      '--BOUNDARY--\r\n',
  );
});

test("negative control: the old { uri, name, type } part is exactly what threw on the owner's phone", async () => {
  const form = new FormData();
  form.append('label', 'My voice');
  form.append('audio', { uri: CLIP, name: 'sample.m4a', type: 'audio/m4a' } as unknown as Blob);
  await expect(convertFormDataAsync(form, 'B')).rejects.toThrow('Unsupported FormDataPart implementation');
});

test.each([
  ['sayAudio', () => api.sayAudio('call-1', CLIP, 'en'), '/calls/call-1/say-audio', ['lang', 'audio']],
  ['voiceChat', () => api.voiceChat(CLIP), '/assistant/voice', ['audio']],
  ['voiceChat with shared text', () => api.voiceChat(CLIP, 'Order #1192'), '/assistant/voice', ['shared', 'audio']],
] as const)('%s sends a form expo/fetch can encode', async (_name, call, _path, fields) => {
  const { sent, transport } = capture();
  setTransport(transport);
  await saveConfig({ url: 'http://192.168.1.7:8000', token: 't' });
  await call();
  const form = sent[0].body as FormData;
  expect(form).toBeInstanceOf(FormData);
  // No JSON content type: fetch must set multipart with its boundary itself.
  expect(sent[0].headers).toEqual({ Authorization: 'Bearer t' });
  const text = decode((await convertFormDataAsync(form, 'X')).body);
  for (const f of fields) expect(text).toContain(`name="${f}"`);
  expect(text).toContain('filename="recording-1.m4a"\r\ncontent-type: audio/mp4\r\n\r\nAUDIO(recording-1.m4a)');
});
