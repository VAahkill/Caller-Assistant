// A stand-in for expo-file-system's File with the same surface the app and
// expo/fetch use: uri, name, type, bytes(), base64().

const MIME: Record<string, string> = { m4a: 'audio/mp4', wav: 'audio/wav', mp3: 'audio/mpeg' };

export class MockFile {
  readonly uri: string;
  constructor(...parts: string[]) {
    this.uri = parts.join('/');
  }
  get name(): string {
    return this.uri.split('/').pop() ?? '';
  }
  get type(): string {
    return MIME[this.name.split('.').pop() ?? ''] ?? '';
  }
  get exists(): boolean {
    return true;
  }
  /** Stable fake audio content derived from the path. */
  async bytes(): Promise<Uint8Array> {
    return new TextEncoder().encode(`AUDIO(${this.name})`);
  }
  async base64(): Promise<string> {
    return btoa(String.fromCharCode(...(await this.bytes())));
  }
  /** Files written and deleted, for tests of the cache. */
  static written: string[] = [];
  static deleted: string[] = [];
  create(): void {}
  write(_data: Uint8Array | string): void {
    MockFile.written.push(this.uri);
  }
  delete(): void {
    MockFile.deleted.push(this.uri);
  }
  upload(): Promise<never> {
    return Promise.reject(new Error('File.upload is native; tests go through the mock transport'));
  }
}

export const expoFileSystemMock = {
  File: MockFile,
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///document' } },
};
