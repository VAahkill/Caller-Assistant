// The real (non-mock) upload path: expo-file-system's File.upload as a
// multipart POST with progress.

const mockUploads: { uri: string; url: string; options: Record<string, unknown> }[] = [];

jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  File: class {
    uri: string;
    constructor(path: string) {
      this.uri = path;
    }
    async upload(url: string, options: Record<string, unknown> & { onProgress?: (p: { bytesSent: number; totalBytes: number }) => void }) {
      mockUploads.push({ uri: this.uri, url, options });
      options.onProgress?.({ bytesSent: 512, totalBytes: 2048 });
      options.onProgress?.({ bytesSent: 2048, totalBytes: 2048 });
      return { status: 200, body: '{"id":"clone:me-abc123","name":"Me","kind":"clone"}', headers: {} };
    }
  },
}));

import { api, saveConfig } from '../api';
import { getTransport, MOCK_MODE, setTransport } from '../transport';

afterEach(() => setTransport(null));

test('tests and normal builds use the platform transport, not the mock', () => {
  expect(MOCK_MODE).toBe(false);
  setTransport(null);
  expect('server' in getTransport()).toBe(false);
});

test('addVoice uploads the recording as multipart field "audio" with the label and token', async () => {
  setTransport(null);
  await saveConfig({ url: 'http://192.168.1.7:8000', token: 'tok' });
  const progress: number[] = [];
  const voice = await api.addVoice('Me', 'file:///cache/Audio/recording-1.m4a', (f) => progress.push(f));
  expect(mockUploads).toHaveLength(1);
  const { uri, url, options } = mockUploads[0];
  expect(uri).toBe('file:///cache/Audio/recording-1.m4a');
  expect(url).toBe('http://192.168.1.7:8000/voices');
  expect(options).toMatchObject({
    httpMethod: 'POST',
    uploadType: 1,
    fieldName: 'audio',
    mimeType: 'audio/mp4',
    parameters: { label: 'Me' },
    headers: { Authorization: 'Bearer tok' },
  });
  expect(progress).toEqual([0.25, 1]);
  expect(voice).toMatchObject({ id: 'clone:me-abc123', name: 'Me', kind: 'clone', engine: 'xtts', status: 'ready' });
});
