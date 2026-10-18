import { act, renderHook } from '@testing-library/react-native';

import { useOutbox } from '../../hooks/useOutbox';
import { outboxLabel, outboxReducer, settleOutbox, type OutboxItem } from '../outbox';
import type { TranscriptLine } from '../types';

const line = (id: string, speaker: TranscriptLine['speaker'], text = 'x'): TranscriptLine => ({
  id,
  speaker,
  text,
  lang: 'te',
  translation: '',
  translation_lang: '',
  english: '',
  at: 1,
  kind: 'speech',
});

const item = (id: string, extra: Partial<OutboxItem> = {}): OutboxItem => ({
  id,
  speaker: 'user',
  kind: 'text',
  text: 'Please leave it with security',
  lang: 'en',
  state: 'sent',
  after: 2,
  ...extra,
});

describe('settleOutbox', () => {
  const lines = [line('a', 'assistant'), line('b', 'caller')];

  test('an item stays until a line from its speaker arrives after it was sent', () => {
    const items = [item('o1')];
    expect(settleOutbox(items, lines)).toBe(items);
    // A caller line is not the owner's line.
    expect(settleOutbox(items, [...lines, line('c', 'caller')])).toHaveLength(1);
    expect(settleOutbox(items, [...lines, line('c', 'caller'), line('d', 'user', 'దయచేసి సెక్యూరిటీకి ఇవ్వండి')])).toEqual([]);
  });

  test('lines before the send never settle it', () => {
    expect(settleOutbox([item('o1', { after: 3 })], [...lines, line('old', 'user')])).toHaveLength(1);
  });

  test('two sends are matched to two lines in order, one line each', () => {
    const items = [item('o1'), item('o2')];
    const one = [...lines, line('u1', 'user')];
    expect(settleOutbox(items, one).map((i) => i.id)).toEqual(['o2']);
    expect(settleOutbox(items, [...one, line('u2', 'user')])).toEqual([]);
  });

  test('a failed send stays with its reason until retried', () => {
    const failed = item('o1', { state: 'failed', error: 'Not said.' });
    expect(settleOutbox([failed], [...lines, line('u1', 'user')])).toEqual([failed]);
  });

  test('a send still in flight is settled too (a fast server)', () => {
    expect(settleOutbox([item('o1', { state: 'sending' })], [...lines, line('u1', 'user')])).toEqual([]);
  });
});

describe('outboxReducer', () => {
  test('sent fills in what the server heard; failed keeps the reason; retry resends', () => {
    let s = outboxReducer([], { type: 'add', item: item('v', { kind: 'voice', text: '', state: 'sending' }) });
    s = outboxReducer(s, { type: 'sent', id: 'v', text: 'Leave it at the gate', seconds: 2.4 });
    expect(s[0]).toMatchObject({ state: 'sent', text: 'Leave it at the gate', seconds: 2.4 });
    s = outboxReducer(s, { type: 'failed', id: 'v', error: 'Server said: 422' });
    expect(s[0]).toMatchObject({ state: 'failed', error: 'Server said: 422' });
    s = outboxReducer(s, { type: 'retry', id: 'v', after: 7 });
    expect(s[0]).toMatchObject({ state: 'sending', error: undefined, after: 7 });
    expect(outboxReducer(s, { type: 'remove', id: 'v' })).toEqual([]);
    expect(outboxReducer(s, { type: 'clear' })).toEqual([]);
  });

  test('labels say what is happening', () => {
    expect(outboxLabel(item('a', { state: 'sending' }), 'Ava')).toBe('Sending…');
    expect(outboxLabel(item('a', { state: 'sending', kind: 'voice' }), 'Ava')).toBe('Sending your recording…');
    expect(outboxLabel(item('a'), 'Ava')).toBe('Sent · Ava is saying it');
    expect(outboxLabel(item('a', { speaker: 'caller', kind: 'voice' }), 'Ava')).toBe('Sent · transcribing');
    expect(outboxLabel(item('a', { state: 'failed' }), 'Ava')).toBe('Not sent');
  });
});

describe('useOutbox', () => {
  test('shows a send at once, marks it sent, and drops it when its line arrives', async () => {
    let lines = [line('a', 'assistant')];
    let finish: (v: { text: string }) => void = () => undefined;
    const { result, rerender } = await renderHook(({ l }: { l: TranscriptLine[] }) => useOutbox(l), { initialProps: { l: lines } });

    let done: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      done = result.current.send({ speaker: 'user', kind: 'voice', text: '', lang: 'en' }, () => new Promise((r) => (finish = r)));
    });
    expect(result.current.items).toEqual([expect.objectContaining({ state: 'sending', after: 1 })]);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      finish({ text: 'Leave it with security' });
      await done;
    });
    expect(result.current.items).toEqual([expect.objectContaining({ state: 'sent', text: 'Leave it with security' })]);
    expect(result.current.busy).toBe(false);

    lines = [...lines, line('u', 'user')];
    await rerender({ l: lines });
    expect(result.current.items).toEqual([]);
  });

  test('a failure is kept with its message and Retry sends again', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('The practice call has ended.')).mockResolvedValueOnce(undefined);
    const { result } = await renderHook(() => useOutbox([]));
    await act(async () => {
      expect(await result.current.send({ speaker: 'caller', kind: 'text', text: 'hello', lang: '' }, fn)).toBe(false);
    });
    expect(result.current.items[0]).toMatchObject({ state: 'failed', error: 'The practice call has ended.' });
    await act(async () => {
      expect(await result.current.retry(result.current.items[0].id)).toBe(true);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.items[0]).toMatchObject({ state: 'sent', error: undefined });
  });

  test('a recording the server heard nothing in fails on the turn error, and never takes the next line', async () => {
    const lines = [line('g', 'assistant', 'Hello')];
    type P = { l: TranscriptLine[]; e: { count: number; detail: string } };
    const { result, rerender } = await renderHook(({ l, e }: P) => useOutbox(l, e), { initialProps: { l: lines, e: { count: 0, detail: '' } } });
    // The caller sends a recording: the server acks it, then hears no words.
    await act(async () => {
      await result.current.send({ speaker: 'caller', kind: 'voice', text: '', lang: 'te', seconds: 2 }, async () => ({ seconds: 2 }));
    });
    expect(result.current.items[0]).toMatchObject({ state: 'sent', kind: 'voice' });
    const unheard = "Couldn't make out any words in that recording. Please try again.";
    await rerender({ l: lines, e: { count: 1, detail: unheard } });
    expect(result.current.items).toEqual([expect.objectContaining({ state: 'failed', error: unheard, unheard: true })]);

    // The next typed line gets its own transcript line; the failed recording stays with Retry.
    await act(async () => {
      await result.current.send({ speaker: 'caller', kind: 'text', text: 'Where should I come?', lang: 'en' }, async () => undefined);
    });
    await rerender({ l: [...lines, line('c1', 'caller', 'Where should I come?')], e: { count: 1, detail: unheard } });
    expect(result.current.items.map((i) => [i.kind, i.state])).toEqual([['voice', 'failed']]);
  });
});

describe('unheard recordings', () => {
  test('only the oldest recording still waiting is marked; text and settled items are left alone', () => {
    const items = [item('t', { kind: 'text' }), item('v1', { kind: 'voice', speaker: 'caller' }), item('v2', { kind: 'voice', speaker: 'caller' })];
    const next = outboxReducer(items, { type: 'unheard', error: 'No words' });
    expect(next.map((i) => [i.id, i.state])).toEqual([
      ['t', 'sent'],
      ['v1', 'failed'],
      ['v2', 'sent'],
    ]);
    expect(outboxReducer([item('t')], { type: 'unheard', error: 'x' })).toEqual([item('t')]);
  });

  test('if its line turns up after all, the one marked unheard goes too', () => {
    const marked = [item('v1', { kind: 'voice', speaker: 'caller', state: 'failed', unheard: true, after: 1 })];
    expect(settleOutbox(marked, [line('a', 'assistant'), line('c', 'caller')])).toEqual([]);
    // An ordinary failure stays until retried or removed.
    const failed = [item('v1', { kind: 'voice', speaker: 'caller', state: 'failed', after: 1 })];
    expect(settleOutbox(failed, [line('a', 'assistant'), line('c', 'caller')])).toBe(failed);
  });
});
