import { checkHealth, diagnosticsText, LOGS_COMMAND, speedWord, type HealthCheck } from '../diagnostics';
import { resetApi, TEST_URL, useMockServer } from '../../test/mockApi';

afterEach(resetApi);

const check: HealthCheck = {
  ms: 182,
  at: 1_760_000_000_000,
  health: {
    ok: true,
    version: '2.0.0',
    dialer: 'twilio',
    active_calls: 1,
    ready: { stt: true, lid: true, mt: true, llm: true, tts: false },
    llm_model: 'qwen2.5-3b-instruct-q4_k_m',
  },
};

describe('diagnostics', () => {
  test('the report has what helping needs, one fact per line, and never the token', () => {
    const text = diagnosticsText({
      appVersion: '1.0.0',
      platform: 'Android (API 36)',
      config: { url: TEST_URL, token: 'secret-token-123' },
      connected: true,
      check,
      error: null,
      at: new Date('2026-10-09T10:42:00Z'),
    });
    expect(text.split('\n')).toEqual([
      'OpenCall app 1.0.0 on Android (API 36)',
      'Report made 2026-10-09T10:42:00.000Z',
      `Server: ${TEST_URL}`,
      'Live updates: connected',
      'Server version: 2.0.0',
      'Response time: 182 ms',
      'Parts: stt ready, lid ready, mt ready, llm ready, tts loading',
      'Language model: qwen2.5-3b-instruct-q4_k_m',
      'Outbound calling: Twilio',
      'Calls right now: 1',
    ]);
    expect(text).not.toContain('secret-token-123');
  });

  test('without a server or an answer it says so, with the last error', () => {
    const none = diagnosticsText({ appVersion: '', platform: 'web', config: null, connected: false, check: null, error: null });
    expect(none).toContain('OpenCall app unknown on web');
    expect(none).toContain('Server: not set up');
    expect(none).toContain('Live updates: off');
    expect(none).not.toContain('Server version');
    const down = diagnosticsText({
      appVersion: '1.0.0',
      platform: 'web',
      config: { url: TEST_URL, token: 't' },
      connected: false,
      check: null,
      error: "Couldn't reach your server.",
    });
    expect(down).toContain('Live updates: reconnecting');
    expect(down.split('\n').at(-1)).toBe("Last error: Couldn't reach your server.");
  });

  test('an older server without readiness is reported as such', () => {
    const text = diagnosticsText({
      appVersion: '1.0.0',
      platform: 'web',
      config: { url: TEST_URL, token: 't' },
      connected: true,
      check: { ...check, health: { ...check.health, ready: null, llm_model: '', version: '' } },
      error: null,
    });
    expect(text).toContain('Parts: not reported');
    expect(text).toContain('Language model: not reported');
    expect(text).toContain('Server version: unknown');
  });

  test('response time words', () => {
    expect(speedWord(0)).toBe('Fast');
    expect(speedWord(299)).toBe('Fast');
    expect(speedWord(300)).toBe('OK');
    expect(speedWord(1499)).toBe('OK');
    expect(speedWord(1500)).toBe('Slow');
  });

  test('a health check times the round trip', async () => {
    await useMockServer();
    const times = [1000, 1240];
    const result = await checkHealth(() => times.shift() ?? 0);
    expect(result.ms).toBe(240);
    expect(result.at).toBe(1240);
    expect(result.health.version).toBeTruthy();
  });

  test('the logs command names the compose service in docker-compose.yml', () => {
    expect(LOGS_COMMAND).toBe('docker compose logs -f opencall');
  });
});
