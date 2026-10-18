import { clearConfig, saveConfig } from '../lib/api';
import { MOCK_TOKEN, MockServer, mockTransport, type MockOptions } from '../lib/mock/server';
import { setTransport } from '../lib/transport';

export const TEST_URL = 'http://192.168.1.7:8000';

/** Points the API at a fresh in-memory server (no latency) and returns it. */
export async function useMockServer(options: MockOptions = {}): Promise<MockServer> {
  const server = new MockServer({ latencyMs: 0, ...options });
  setTransport(mockTransport(server));
  await clearConfig();
  await saveConfig({ url: TEST_URL, token: MOCK_TOKEN });
  return server;
}

export async function resetApi(): Promise<void> {
  setTransport(null);
  await clearConfig();
}
