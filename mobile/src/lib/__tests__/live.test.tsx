// The live provider across a reconnect: calls stay on screen until the server's
// snapshots arrive, and the ones it no longer reports are dropped shortly after.
// A replaced socket's late events never reach the app.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { LiveProvider, SNAPSHOT_GRACE_MS, useLive } from '../live';
import { LIVE_CALL_ID } from '../mock/fixtures';
import type { MockServer } from '../mock/server';
import { setTransport, type SocketLike } from '../transport';
import { resetApi, useMockServer } from '../../test/mockApi';

function Calls() {
  const live = useLive();
  const views = Object.values(live.calls);
  return (
    <Text testID="calls">
      {live.connected ? 'connected' : 'offline'}:{views.map((v) => `${v.record.id}${v.stale ? '(stale)' : ''}`).join(',')}
    </Text>
  );
}

let server: MockServer;
beforeEach(async () => {
  jest.useFakeTimers();
  server = await useMockServer();
});
afterEach(async () => {
  jest.useRealTimers();
  await resetApi();
});

/** Moves the clock in small steps, so a timer that sets state, the effect it
 *  runs, its promises and the socket's own open timer each get their turn. */
async function tick(ms: number) {
  for (let left = ms; left > 0; left -= 10) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.min(10, left));
    });
  }
}

function dropConnection() {
  for (const s of server.liveSockets) (s as unknown as { close: (code: number) => void }).close(1006);
}

test('a call that ended while offline goes once the new snapshots are in', async () => {
  await render(
    <LiveProvider>
      <Calls />
    </LiveProvider>,
  );
  await tick(10);
  expect(screen.getByTestId('calls')).toHaveTextContent(`connected:${LIVE_CALL_ID}`);

  dropConnection();
  server.state.calls.find((c) => c.id === LIVE_CALL_ID)!.ended_at = Date.now() / 1000;
  await tick(10);
  expect(screen.getByTestId('calls')).toHaveTextContent(`offline:${LIVE_CALL_ID}`);

  await tick(2000); // the retry reconnects; the server sends no snapshot for it
  expect(screen.getByTestId('calls')).toHaveTextContent(`connected:${LIVE_CALL_ID}(stale)`);
  await tick(SNAPSHOT_GRACE_MS);
  expect(screen.getByTestId('calls')).toHaveTextContent(/^connected:$/);
});

test('a call still live after reconnecting is never dropped from the screen', async () => {
  await render(
    <LiveProvider>
      <Calls />
    </LiveProvider>,
  );
  await tick(10);
  dropConnection();
  await tick(2010);
  expect(screen.getByTestId('calls')).toHaveTextContent(`connected:${LIVE_CALL_ID}`);
  await tick(SNAPSHOT_GRACE_MS);
  expect(screen.getByTestId('calls')).toHaveTextContent(`connected:${LIVE_CALL_ID}`);
});

// A socket whose close event comes later, as on a real network. On Android a
// socket closed while still connecting may open anyway.
class SlowSocket implements SocketLike {
  readyState = 0;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  closeCalls = 0;
  send() {}
  close() {
    this.closeCalls++;
    if (this.readyState === 1) this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(ev: object) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  closed(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

describe('replacing the socket', () => {
  let sockets: SlowSocket[];
  beforeEach(() => {
    sockets = [];
    setTransport({
      fetch: async () => {
        throw new Error('no fetch in this test');
      },
      upload: async () => {
        throw new Error('no upload in this test');
      },
      openSocket: () => {
        const s = new SlowSocket();
        sockets.push(s);
        return s;
      },
    });
  });

  function Probe() {
    const live = useLive();
    return (
      <>
        <Text testID="state">
          {live.connected ? 'connected' : 'offline'}:{Object.keys(live.calls).join(',')}
        </Text>
        <Pressable testID="reconnect" onPress={live.reconnect} />
      </>
    );
  }

  const started = (id: string) => ({
    event: 'call_started',
    call_id: id,
    who: 'Ravi',
    call: { id, number: '+919812345678', started_at: Date.now() / 1000 },
  });

  test("the old socket's late close does not mark the new one offline", async () => {
    await render(
      <LiveProvider>
        <Probe />
      </LiveProvider>,
    );
    await tick(10);
    expect(sockets).toHaveLength(1);
    await act(async () => sockets[0].open());
    expect(screen.getByTestId('state')).toHaveTextContent(/^connected:/);

    await fireEvent.press(screen.getByTestId('reconnect'));
    await tick(10);
    expect(sockets).toHaveLength(2);
    await act(async () => sockets[1].open());
    // The old socket's close handshake finishes after the new one opened.
    await act(async () => sockets[0].closed());
    expect(screen.getByTestId('state')).toHaveTextContent(/^connected:/);
    // And it schedules no extra reconnect.
    await tick(5000);
    expect(sockets).toHaveLength(2);
  });

  test('a socket replaced while connecting is closed when it opens and its events are ignored', async () => {
    await render(
      <LiveProvider>
        <Probe />
      </LiveProvider>,
    );
    await tick(10);
    await fireEvent.press(screen.getByTestId('reconnect'));
    await tick(10);
    expect(sockets).toHaveLength(2);
    await act(async () => sockets[1].open());
    await act(async () => sockets[1].message(started('c-new')));

    // The first socket ignored close() while connecting and opens now.
    await act(async () => sockets[0].open());
    expect(sockets[0].closeCalls).toBeGreaterThanOrEqual(2);
    await act(async () => sockets[0].message(started('c-ghost')));
    expect(screen.getByTestId('state')).toHaveTextContent('connected:c-new');
  });

  test('a refused token backs off instead of retrying every two seconds', async () => {
    await render(
      <LiveProvider>
        <Probe />
      </LiveProvider>,
    );
    await tick(10);
    // How Android reports a socket the server closed before accepting it.
    await act(async () => sockets[0].closed(1006, "Expected HTTP 101 response but was '403 Forbidden'"));
    await tick(5000);
    expect(sockets).toHaveLength(1);
    await tick(16000);
    expect(sockets).toHaveLength(2);
  });
});
