// The live provider across a reconnect: calls stay on screen until the server's
// snapshots arrive, and the ones it no longer reports are dropped shortly after.

jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { LiveProvider, SNAPSHOT_GRACE_MS, useLive } from '../live';
import { LIVE_CALL_ID } from '../mock/fixtures';
import type { MockServer } from '../mock/server';
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
