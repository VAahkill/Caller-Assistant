// "Call for me": the templates, what each kind of task does, and the steps a
// task goes through, for the timeline on each task card.

import type { IconName } from './design';
import type { Task, TaskKind, TaskStatus } from './types';

export interface TaskTemplate {
  id: string;
  icon: IconName;
  label: string;
  /** One line under the label. */
  hint: string;
  kind: TaskKind;
  goal: string;
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  { id: 'table', icon: 'restaurant-outline', label: 'Book a table', hint: 'Restaurants, cafés', kind: 'book', goal: 'Book a table for 2 tonight at 8 PM under my name.' },
  { id: 'order', icon: 'cube-outline', label: 'Check order status', hint: 'Shops, couriers', kind: 'enquire', goal: 'Ask when my order will be delivered. Order number: ' },
  { id: 'reschedule', icon: 'calendar-outline', label: 'Reschedule', hint: 'Doctor, salon, service', kind: 'custom', goal: 'Move my appointment to another day next week, any evening.' },
  { id: 'question', icon: 'help-circle-outline', label: 'Ask a question', hint: 'Prices, timings, stock', kind: 'enquire', goal: 'Ask whether ' },
];

export const TASK_KINDS: { value: TaskKind; label: string; explain: string }[] = [
  { value: 'enquire', label: 'Just ask', explain: "Asks and tells you the answer. It won't agree to anything for you." },
  { value: 'book', label: 'Ask and book', explain: 'If it is available, it books it for you. Anything different, it asks you first.' },
  { value: 'custom', label: 'Something else', explain: 'Follows what you wrote, and asks you before agreeing to anything new.' },
];

export const isTaskActive = (t: Pick<Task, 'status'>) => t.status !== 'done' && t.status !== 'failed';

/** A status the app saw a task reach, with when (from task_update events). */
export interface TaskStep {
  status: TaskStatus;
  at: number;
}

export type TimelineState = 'done' | 'current' | 'upcoming' | 'failed';

export interface TimelineItem {
  key: string;
  label: string;
  state: TimelineState;
  /** When it happened, if known. */
  at?: number;
}

const OUTCOME: Record<string, string> = {
  booked: 'Booked',
  available: 'Available',
  unavailable: 'Not available',
  conveyed: 'Message passed on',
};

/** The step labels for each status, in the order a call goes through them. */
const ORDER: TaskStatus[] = ['queued', 'dialing', 'in_call', 'waiting_user'];

/**
 * Where a task is: queued, dialling, on the call, (waiting for you), result.
 * `seen` adds the times the app watched it change; without them only the
 * start and the latest change have times.
 */
export function taskTimeline(task: Task, seen: TaskStep[] = []): TimelineItem[] {
  const when = (s: TaskStatus) => (s === 'queued' ? task.created_at : seen.find((x) => x.status === s)?.at);
  const reached = new Set(seen.map((x) => x.status));
  const failed = task.status === 'failed';
  const finished = failed || task.status === 'done';
  const decision = task.status === 'waiting_user' || reached.has('waiting_user');
  // A failed task stopped either before it got through or during the call.
  const talked = !failed || reached.has('in_call') || reached.has('waiting_user');
  const steps = ORDER.filter((s) => (s === 'waiting_user' ? decision : s === 'in_call' ? talked : true));
  const rank = (s: TaskStatus) => (s === 'done' || s === 'failed' ? steps.length : steps.indexOf(s));
  const now = rank(task.status);
  const label: Record<TaskStatus, string> = {
    queued: 'Queued',
    dialing: task.status === 'dialing' ? `Calling ${task.target_name || 'them'}` : 'Dialled',
    in_call: task.status === 'in_call' ? 'Talking to them now' : 'Talked to them',
    waiting_user: task.status === 'waiting_user' ? 'Waiting for your decision' : 'You decided',
    done: '',
    failed: '',
  };
  const items: TimelineItem[] = steps.map((s, i) => ({
    key: s,
    label: label[s],
    state: i < now ? 'done' : i === now ? 'current' : 'upcoming',
    at: i === now ? (when(s) ?? task.updated_at) : i < now ? when(s) : undefined,
  }));
  items.push({
    key: 'result',
    label: failed ? "Didn't work" : finished ? (OUTCOME[task.outcome] ?? 'Done') : 'Result',
    state: failed ? 'failed' : finished ? 'done' : 'upcoming',
    at: finished ? task.updated_at : undefined,
  });
  return items;
}

/** Adds a status to what the app has seen of a task, once per change. */
export function addTaskStep(steps: TaskStep[] | undefined, task: Task, now: number): TaskStep[] {
  const list = steps ?? [];
  if (list[list.length - 1]?.status === task.status) return list;
  return [...list, { status: task.status, at: task.updated_at || now }];
}
