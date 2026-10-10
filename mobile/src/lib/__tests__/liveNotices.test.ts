import { parseEvent, type ServerEvent } from '../events';
import { liveNotice } from '../liveNotices';
import { createFixtures } from '../mock/fixtures';

const fx = createFixtures(1_760_000_000);

function ev(e: Record<string, unknown>): ServerEvent {
  const parsed = parseEvent(JSON.stringify(e));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.event as ServerEvent;
}

describe('urgent calls', () => {
  test('a VIP calling alerts on the urgent channel, replacing the ordinary call notice, without a reply box', () => {
    const started = liveNotice(ev({ event: 'call_started', call: { ...fx.calls[0], id: 'c1' }, call_id: 'c1', who: 'Amma' }));
    const vip = liveNotice(ev({ event: 'urgent_call', call_id: 'c1', who: 'Amma', reason: 'vip', title: 'VIP Amma is calling' }));
    expect(vip).toMatchObject({ title: 'VIP Amma is calling', kind: 'urgent', data: { call_id: 'c1' }, vibrate: expect.any(Array) });
    expect(vip?.id).toBe(started?.id);
    expect(started?.kind).toBe('normal');
  });

  test("an urgent summary shows who in the title and the summary, clipped, in the body", () => {
    const summary = `Says the water tank is overflowing into the neighbour's flat and needs you to call back. ${'More detail. '.repeat(40)}`;
    const n = liveNotice(ev({ event: 'urgent_call', call_id: 'c2', who: 'Ravi', reason: 'summary', title: `Urgent: Ravi: ${summary}` }));
    expect(n?.title).toBe('Urgent call from Ravi');
    expect(n?.body.startsWith('Says the water tank')).toBe(true);
    expect(n?.body.length).toBeLessThanOrEqual(240);
    expect(n?.body.endsWith('…')).toBe(true);
    expect(n?.kind).toBe('urgent');
  });

  test('an older server without a title still alerts', () => {
    expect(liveNotice(ev({ event: 'urgent_call', call_id: 'c3', who: 'Ravi', reason: 'vip' }))?.title).toBe('VIP Ravi is calling');
    expect(liveNotice(ev({ event: 'urgent_call', call_id: 'c3', who: 'Ravi' }))).toMatchObject({ title: 'Urgent call from Ravi', kind: 'urgent' });
  });
});

test('a hold question carries the reply box; ordinary events do not', () => {
  expect(liveNotice(ev({ event: 'hold_question', call_id: 'c1', who: 'Swiggy', hold_id: 'h1', question: 'Gate 2?' }))).toMatchObject({
    kind: 'hold',
    data: { call_id: 'c1', hold_id: 'h1' },
  });
  expect(liveNotice(ev({ event: 'message_taken', message: fx.messages[0], call_id: 'x', who: 'Amma' }))?.kind).toBe('normal');
  expect(liveNotice(ev({ event: 'assistant_status', call_id: 'c1', who: 'x', state: 'thinking' }))).toBeNull();
});
