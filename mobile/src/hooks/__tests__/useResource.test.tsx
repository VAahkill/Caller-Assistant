import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useResource } from '../useResource';

/** A fetcher whose answers the test releases one at a time. */
function gated<T>() {
  const waiting: ((v: T) => void)[] = [];
  const fetcher = jest.fn(() => new Promise<T>((resolve) => waiting.push(resolve)));
  const release = (v: T) => act(async () => waiting.shift()?.(v));
  return { fetcher, release };
}

describe('useResource', () => {
  test('loads, then reloads quietly when the key changes', async () => {
    const { fetcher, release } = gated<number>();
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useResource(fetcher, k), { initialProps: { k: 0 } });
    expect(result.current.loading).toBe(true);
    await release(1);
    expect(result.current.data).toBe(1);
    expect(result.current.loading).toBe(false);

    await rerender({ k: 1 });
    // The old data stays on screen while the new answer is on its way.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(1);
    expect(result.current.loading).toBe(false);
    await release(2);
    expect(result.current.data).toBe(2);
  });

  test('a disabled resource does not fetch or show a skeleton, and loads once enabled', async () => {
    const { fetcher, release } = gated<string>();
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => useResource(fetcher, 0, on), { initialProps: { on: false } });
    expect(result.current.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();

    await rerender({ on: true });
    expect(result.current.loading).toBe(true);
    await release('ok');
    expect(result.current.data).toBe('ok');
    expect(result.current.loading).toBe(false);
  });

  test('a failure is kept as a message and cleared by the next success', async () => {
    const fetcher = jest.fn<Promise<string>, []>().mockRejectedValueOnce(new Error('Server said: 500')).mockResolvedValueOnce('back');
    const { result } = await renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.error).toBe('Server said: 500'));
    expect(result.current.loading).toBe(false);
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe('back');
  });

  test('uses the newest fetcher on reload', async () => {
    const { result, rerender } = await renderHook(({ v }: { v: string }) => useResource(async () => v), { initialProps: { v: 'first' } });
    await waitFor(() => expect(result.current.data).toBe('first'));
    await rerender({ v: 'second' });
    await act(() => result.current.reload());
    expect(result.current.data).toBe('second');
  });
});
