import { File, UploadType } from 'expo-file-system';

// How the app reaches the server: the platform's fetch, WebSocket and native
// file upload. Mock mode (EXPO_PUBLIC_OPENCALL_MOCK=1, used for screenshots and
// for working on screens without a server) swaps in an in-memory server that
// speaks API contract v2; see lib/mock.

export const MOCK_MODE = process.env.EXPO_PUBLIC_OPENCALL_MOCK === '1';

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
}

export type FetchLike = (url: string, init?: RequestInitLike) => Promise<ResponseLike>;

/** The parts of a WebSocket the app uses, so a mock can stand in. */
export interface SocketLike {
  readonly readyState: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface UploadRequest {
  url: string;
  fileUri: string;
  fieldName: string;
  mimeType: string;
  parameters: Record<string, string>;
  headers: Record<string, string>;
  onProgress?: (fraction: number) => void;
}

export interface UploadResultLike {
  status: number;
  body: string;
}

export interface Transport {
  fetch: FetchLike;
  openSocket: (url: string) => SocketLike;
  /** Multipart upload of a local file with progress (expo-file-system). */
  upload: (req: UploadRequest) => Promise<UploadResultLike>;
}

export const SOCKET_OPEN = 1;

/**
 * The server turned down the socket's token. It means to close with 4401, but
 * a close before the handshake reaches the phone as an HTTP 403, which the
 * WebSocket reports as code 1006 with the status in the reason.
 */
export function refusedToken(code?: number, reason?: string): boolean {
  return code === 4401 || (code === 1006 && /\b40[13]\b/.test(reason ?? ''));
}

const platformTransport: Transport = {
  fetch: (url, init) => fetch(url, init as RequestInit),
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  upload: async ({ url, fileUri, fieldName, mimeType, parameters, headers, onProgress }) => {
    const result = await new File(fileUri).upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName,
      mimeType,
      parameters,
      headers,
      onProgress: onProgress
        ? ({ bytesSent, totalBytes }) => onProgress(totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : 0)
        : undefined,
    });
    return { status: result.status, body: result.body };
  },
};

let current: Transport | null = null;

export function getTransport(): Transport {
  if (!current) {
    // Written inline so a normal build folds the condition away and leaves the mock out.
    current =
      process.env.EXPO_PUBLIC_OPENCALL_MOCK === '1'
        ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only in mock builds
          (require('./mock/server') as typeof import('./mock/server')).mockTransport()
        : platformTransport;
  }
  return current;
}

/** Tests and the mock gallery install their own transport. */
export function setTransport(next: Transport | null): void {
  current = next;
}
