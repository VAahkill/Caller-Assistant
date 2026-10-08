// Away presets and the English message the server stores ("In a meeting until 3 PM").

import type { IconName } from './design';

export interface AwayPreset {
  id: string;
  label: string;
  icon: IconName;
  /** Start of the message; the end time is added after it. */
  phrase: string;
  /** Default length in minutes, or 'morning' for 7 AM. */
  defaultFor: Duration;
}

export type Duration = 30 | 60 | 120 | 'morning' | 'none';

export const AWAY_PRESETS: AwayPreset[] = [
  { id: 'meeting', label: 'In a meeting', icon: 'people-outline', phrase: 'In a meeting', defaultFor: 60 },
  { id: 'driving', label: 'Driving', icon: 'car-outline', phrase: 'Driving', defaultFor: 30 },
  { id: 'sleeping', label: 'Sleeping', icon: 'moon-outline', phrase: 'Sleeping', defaultFor: 'morning' },
  { id: 'gym', label: 'At the gym', icon: 'barbell-outline', phrase: 'At the gym', defaultFor: 60 },
  { id: 'travelling', label: 'Travelling', icon: 'airplane-outline', phrase: 'Travelling', defaultFor: 'none' },
  { id: 'busy', label: 'Busy', icon: 'time-outline', phrase: 'Busy', defaultFor: 120 },
];

export const DURATIONS: { value: Duration; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 'morning', label: 'Until 7 AM' },
  { value: 'none', label: 'Until I turn it off' },
];

/** Epoch seconds the away status ends, or null for no end. */
export function untilFor(d: Duration, now: number = Date.now()): number | null {
  if (d === 'none') return null;
  if (d === 'morning') {
    const at = new Date(now);
    if (at.getHours() >= 7) at.setDate(at.getDate() + 1);
    at.setHours(7, 0, 0, 0);
    return Math.floor(at.getTime() / 1000);
  }
  // Round up to the next 5 minutes so the spoken time is natural.
  const end = new Date(now + d * 60_000);
  const rounded = Math.ceil(end.getMinutes() / 5) * 5;
  end.setMinutes(rounded, 0, 0);
  return Math.floor(end.getTime() / 1000);
}

/** "3 PM", "3:30 PM", "7 AM tomorrow". */
export function spokenTime(until: number, now: number = Date.now()): string {
  const at = new Date(until * 1000);
  const h = at.getHours();
  const m = at.getMinutes();
  const clock = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(today.getDate() + 1);
  if (at.toDateString() === today.toDateString()) return clock;
  if (at.toDateString() === tomorrow.toDateString()) return `${clock} tomorrow`;
  return `${clock} on ${at.getDate()} ${at.toLocaleString('en', { month: 'short' })}`;
}

export function awayMessage(phrase: string, until: number | null, now: number = Date.now()): string {
  const p = phrase.trim();
  return until == null ? p : `${p} until ${spokenTime(until, now)}`;
}
