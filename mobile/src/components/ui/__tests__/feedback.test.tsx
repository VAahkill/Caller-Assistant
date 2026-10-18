import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { useAsyncAction } from '../../../hooks/useAsyncAction';
import { renderUI } from '../../../test/render';
import { AsyncContent } from '../AsyncContent';
import { Button } from '../Button';
import { useConfirm } from '../ConfirmSheet';
import { useToast } from '../Toast';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncAction', () => {
  function SyncButton({ fn }: { fn: () => Promise<number> }) {
    const sync = useAsyncAction(fn, { success: (n) => `Synced ${n} contacts` });
    return (
      <>
        <Button title="Sync my contacts" onPress={() => void sync.run()} loading={sync.busy} success={sync.succeeded} successTitle="Synced" />
        {sync.error ? <RNText>inline: {sync.error}</RNText> : null}
      </>
    );
  }

  test('shows progress in the button, then a toast with the result', async () => {
    const d = deferred<number>();
    const fn = jest.fn(() => d.promise);
    await renderUI(<SyncButton fn={fn} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sync my contacts' }));
    expect(screen.getByRole('button', { name: 'Sync my contacts' })).toBeBusy();
    // A second tap while busy does not start another run.
    await fireEvent.press(screen.getByRole('button', { name: 'Sync my contacts' }));
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(248));
    expect(screen.getByText('Synced 248 contacts')).toBeTruthy();
    expect(screen.getByText('Synced')).toBeTruthy();
  });

  test('a failure is shown, never swallowed', async () => {
    const fn = jest.fn(() => Promise.reject(new Error('Contacts permission is off')));
    await renderUI(<SyncButton fn={fn} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sync my contacts' }));
    expect(screen.getByText('inline: Contacts permission is off')).toBeTruthy();
    expect(screen.getByTestId('toast')).toHaveTextContent(/Contacts permission is off/);
  });
});

test('undo toast runs the undo action', async () => {
  const onUndo = jest.fn();
  function Deleter() {
    const toast = useToast();
    return <Button title="Delete" onPress={() => toast.undo('Instruction deleted', onUndo)} />;
  }
  await renderUI(<Deleter />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.getByText('Instruction deleted')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
  expect(onUndo).toHaveBeenCalledTimes(1);
});

test('useConfirm resolves with the choice', async () => {
  const results: boolean[] = [];
  function Asker() {
    const confirm = useConfirm();
    return (
      <Button
        title="Delete voice"
        onPress={async () => results.push(await confirm({ title: 'Delete this voice?', destructive: true, confirmLabel: 'Delete' }))}
      />
    );
  }
  await renderUI(<Asker />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete voice' }));
  expect(screen.getByText('Delete this voice?')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('confirm-sheet-confirm'));
  await fireEvent.press(screen.getByRole('button', { name: 'Delete voice' }));
  await fireEvent.press(screen.getByTestId('confirm-sheet-cancel'));
  expect(results).toEqual([true, false]);
});

describe('AsyncContent', () => {
  const empty = { icon: 'chatbubbles-outline' as const, title: 'No messages yet' };
  const list = (items: string[]) => items.map((i) => <RNText key={i}>{i}</RNText>);

  test('skeleton while loading', async () => {
    await renderUI(<AsyncContent data={undefined} loading error={null} onRetry={jest.fn()} empty={empty}>{list}</AsyncContent>);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  test('error offers Retry', async () => {
    const retry = jest.fn();
    await renderUI(
      <AsyncContent data={undefined} loading={false} error="Server said: 500" onRetry={retry} empty={empty}>
        {list}
      </AsyncContent>,
    );
    expect(screen.getByText('Server said: 500')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });

  test('empty state, then content', async () => {
    const { rerender } = await renderUI(
      <AsyncContent data={[]} loading={false} error={null} onRetry={jest.fn()} isEmpty={(d) => d.length === 0} empty={empty}>
        {list}
      </AsyncContent>,
    );
    expect(screen.getByText('No messages yet')).toBeTruthy();
    await rerender(
      <AsyncContent data={['Ravi called']} loading={false} error={null} onRetry={jest.fn()} isEmpty={(d) => d.length === 0} empty={empty}>
        {list}
      </AsyncContent>,
    );
    expect(screen.getByText('Ravi called')).toBeTruthy();
  });
});
