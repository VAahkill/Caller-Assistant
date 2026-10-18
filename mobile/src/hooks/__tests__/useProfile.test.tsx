jest.mock('expo-file-system', () => require('../../test/expoFileSystemMock').expoFileSystemMock);

import { act, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { LiveProvider } from '../../lib/live';
import { resetApi, useMockServer } from '../../test/mockApi';
import { Providers } from '../../test/render';
import { useProfile } from '../useProfile';

const wrapper = ({ children }: { children: ReactNode }) => (
  <Providers>
    <LiveProvider>{children}</LiveProvider>
  </Providers>
);

afterEach(resetApi);

test('patch shows the change at once and keeps what the server saved', async () => {
  const server = await useMockServer();
  const { result } = await renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(result.current.data?.assistant_name).toBe('Ava'));
  let ok = false;
  await act(async () => {
    ok = await result.current.patch({ assistant_name: 'Maya' }, 'Saved.');
  });
  expect(ok).toBe(true);
  expect(result.current.data?.assistant_name).toBe('Maya');
  expect(server.state.profile.assistant_name).toBe('Maya');
  expect(await screen.findByText('Saved.')).toBeTruthy();
});

test('a refused patch puts the old value back and says why', async () => {
  await useMockServer();
  const { result } = await renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(result.current.data?.home_country_code).toBe('+91'));
  let ok = true;
  await act(async () => {
    ok = await result.current.patch({ home_country_code: '91' });
  });
  expect(ok).toBe(false);
  expect(result.current.data?.home_country_code).toBe('+91');
  expect(await screen.findByText(/^Not saved\. Server said:/)).toBeTruthy();
});
