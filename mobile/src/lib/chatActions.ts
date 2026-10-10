// The owner chat's actions (API contract v2) as chips under the assistant's
// reply, each opening the screen where the change can be seen or undone.

import type { Href } from 'expo-router';

import type { IconName } from './design';
import type { ChatAction } from './types';

export interface ActionChip {
  icon: IconName;
  label: string;
  /** Where tapping goes; none when there is nothing to open. */
  href?: Href;
}

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A chip for one action, or null for a type this app doesn't know. */
export function chatActionChip(a: ChatAction): ActionChip | null {
  switch (a.type) {
    case 'task_created': {
      const task = (a.task ?? {}) as Record<string, unknown>;
      const who = str(task.target_name) || str(task.number);
      return { icon: 'call-outline', label: who ? `Calling ${who}` : 'Call started', href: '/tasks' };
    }
    case 'instruction_added':
      return { icon: 'list-outline', label: str(a.text) ? `Instruction: ${short(str(a.text))}` : 'Instruction added', href: '/instructions' };
    case 'note_added':
      return { icon: 'bookmark-outline', label: str(a.text) ? `Noted: ${short(str(a.text))}` : 'Note saved', href: '/notes' };
    case 'availability':
      // The "I can answer questions now" switch on Away (and Today) shows and changes it.
      return { icon: a.available ? 'hand-left-outline' : 'moon-outline', label: a.available ? 'You can be asked on hold' : 'You are marked busy', href: '/away' };
    case 'enabled':
      return { icon: a.enabled ? 'headset-outline' : 'moon-outline', label: a.enabled ? 'Assistant turned on' : 'Assistant turned off' };
    default:
      return null;
  }
}
