import { liveReducer, initialLive, parseEvent, type ServerEvent } from '../events';
import { addTaskStep, DIAL_FAILED, isTaskActive, taskResultText, taskTimeline, TASK_KINDS, TASK_TEMPLATES } from '../tasks';
import type { Task } from '../types';

const T0 = 1_760_000_000;

const task = (patch: Partial<Task> = {}): Task => ({
  id: 'task-1',
  kind: 'book',
  number: '+914023456789',
  goal: 'Book a table for 4 at 8 PM.',
  target_name: 'Paradise Biryani',
  status: 'queued',
  outcome: '',
  result: '',
  call_id: null,
  created_at: T0,
  updated_at: T0,
  practice: false,
  ...patch,
});

const states = (items: ReturnType<typeof taskTimeline>) => items.map((i) => `${i.key}:${i.state}`);

describe('task timeline', () => {
  test('a new task is queued, with the rest still to come', () => {
    const items = taskTimeline(task());
    expect(states(items)).toEqual(['queued:current', 'dialing:upcoming', 'in_call:upcoming', 'result:upcoming']);
    expect(items[0].at).toBe(T0);
  });

  test('dialling names the place; times come from the updates the app saw', () => {
    const seen = [
      { status: 'dialing' as const, at: T0 + 2 },
      { status: 'in_call' as const, at: T0 + 9 },
    ];
    const dialing = taskTimeline(task({ status: 'dialing', updated_at: T0 + 2 }), seen.slice(0, 1));
    expect(dialing[1]).toMatchObject({ label: 'Calling Paradise Biryani', state: 'current', at: T0 + 2 });
    const talking = taskTimeline(task({ status: 'in_call', updated_at: T0 + 9 }), seen);
    expect(states(talking)).toEqual(['queued:done', 'dialing:done', 'in_call:current', 'result:upcoming']);
    expect(talking[1]).toMatchObject({ label: 'Dialled', at: T0 + 2 });
    expect(talking[2]).toMatchObject({ label: 'Talking to them now', at: T0 + 9 });
  });

  test('waiting for the owner adds that step, and it stays once decided', () => {
    const waiting = taskTimeline(task({ status: 'waiting_user' }));
    expect(states(waiting)).toEqual(['queued:done', 'dialing:done', 'in_call:done', 'waiting_user:current', 'result:upcoming']);
    expect(waiting[3].label).toBe('Waiting for your decision');
    const done = taskTimeline(task({ status: 'done', outcome: 'booked', updated_at: T0 + 60 }), [{ status: 'waiting_user', at: T0 + 30 }]);
    expect(states(done)).toEqual(['queued:done', 'dialing:done', 'in_call:done', 'waiting_user:done', 'result:done']);
    expect(done[3]).toMatchObject({ label: 'You decided', at: T0 + 30 });
    expect(done[4]).toMatchObject({ label: 'Booked', at: T0 + 60 });
  });

  test("a task that never got through skips the call and ends in Didn't work", () => {
    const failed = taskTimeline(task({ status: 'failed', outcome: 'no_answer', updated_at: T0 + 90 }));
    expect(states(failed)).toEqual(['queued:done', 'dialing:done', 'result:failed']);
    expect(failed[2]).toMatchObject({ label: "Didn't work", at: T0 + 90 });
    // Failing during the call keeps the call step.
    expect(states(taskTimeline(task({ status: 'failed' }), [{ status: 'in_call', at: T0 + 5 }]))).toEqual([
      'queued:done',
      'dialing:done',
      'in_call:done',
      'result:failed',
    ]);
  });

  test('a finished task without a known outcome says Done', () => {
    expect(taskTimeline(task({ status: 'done', outcome: 'unknown' })).at(-1)?.label).toBe('Done');
    expect(taskTimeline(task({ status: 'done', outcome: 'unavailable' })).at(-1)?.label).toBe('Not available');
  });

  test('steps are added once per change', () => {
    let steps = addTaskStep(undefined, task({ status: 'dialing', updated_at: T0 + 2 }), T0);
    steps = addTaskStep(steps, task({ status: 'dialing', updated_at: T0 + 3 }), T0);
    steps = addTaskStep(steps, task({ status: 'in_call', updated_at: 0 }), T0 + 9);
    expect(steps).toEqual([
      { status: 'dialing', at: T0 + 2 },
      { status: 'in_call', at: T0 + 9 },
    ]);
  });

  test('active means not done or failed', () => {
    expect(isTaskActive(task({ status: 'waiting_user' }))).toBe(true);
    expect(isTaskActive(task({ status: 'done' }))).toBe(false);
    expect(isTaskActive(task({ status: 'failed' }))).toBe(false);
  });
});

describe('templates and kinds', () => {
  test('the four templates from the spec, each with a kind the server knows', () => {
    expect(TASK_TEMPLATES.map((t) => t.label)).toEqual(['Book a table', 'Check order status', 'Reschedule', 'Ask a question']);
    const kinds = TASK_KINDS.map((k) => k.value);
    for (const t of TASK_TEMPLATES) expect(kinds).toContain(t.kind);
  });
});

describe('task_update events', () => {
  test('are filled in and remembered with each status the app saw', () => {
    const parsed = parseEvent(JSON.stringify({ event: 'task_update', task: { id: 'task-1', status: 'dialing', number: '+914023456789', updated_at: T0 + 2 } }));
    expect(parsed.ok).toBe(true);
    const ev = (parsed as { event: ServerEvent }).event as Extract<ServerEvent, { event: 'task_update' }>;
    expect(ev.task).toMatchObject({ id: 'task-1', status: 'dialing', goal: '', result: '', call_id: null, created_at: 0 });
    expect(ev.title).toBe('');
    let state = liveReducer(initialLive, { type: 'event', event: ev, now: T0 + 2 });
    state = liveReducer(state, { type: 'event', event: { ...ev, task: { ...ev.task, status: 'in_call', updated_at: T0 + 8 } }, now: T0 + 8 });
    expect(state.tasks['task-1'].status).toBe('in_call');
    expect(state.taskSteps['task-1']).toEqual([
      { status: 'dialing', at: T0 + 2 },
      { status: 'in_call', at: T0 + 8 },
    ]);
  });

  test('say whether the task was only practised', () => {
    const practised = parseEvent({ event: 'task_update', task: { id: 'p', status: 'in_call', practice: true } });
    expect(practised.ok && (practised.event as Extract<ServerEvent, { event: 'task_update' }>).task.practice).toBe(true);
    // Older servers don't say: a real call.
    const real = parseEvent({ event: 'task_update', task: { id: 'r', status: 'in_call', practice: 'yes' } });
    expect(real.ok && (real.event as Extract<ServerEvent, { event: 'task_update' }>).task.practice).toBe(false);
  });

  test('an unknown status reads as queued rather than breaking the screen', () => {
    const parsed = parseEvent({ event: 'task_update', task: { id: 'x', status: 'teleporting' } });
    expect(parsed.ok && (parsed.event as Extract<ServerEvent, { event: 'task_update' }>).task.status).toBe('queued');
  });
});

describe('what a task found out', () => {
  test.each([
    'All connection attempts failed',
    'httpx.ConnectError: [Errno 111] Connection refused',
    'ConnectTimeout',
    'Timed out',
    '[Errno -2] Name or service not known',
    'Network is unreachable',
  ])('a raw network error from the server reads as a sentence: %s', (result) => {
    expect(taskResultText(task({ status: 'failed', result }))).toBe(DIAL_FAILED);
  });

  test("the server's own sentences, and finished tasks, are kept as they are", () => {
    expect(taskResultText(task({ status: 'failed', result: "No one answered after 3 tries. I'll stop here." }))).toBe("No one answered after 3 tries. I'll stop here.");
    expect(taskResultText(task({ status: 'failed', result: 'They said the line timed out on their side, try later.' }))).toBe(
      'They said the line timed out on their side, try later.',
    );
    expect(taskResultText(task({ status: 'done', result: ' Booked for 4 at 8 PM. ' }))).toBe('Booked for 4 at 8 PM.');
    expect(taskResultText(task({ status: 'failed', result: '' }))).toBe('');
  });
});
