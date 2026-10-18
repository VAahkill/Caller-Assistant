// A month of days for the date picker, and the end-time choices for a chosen day.
// Pure date maths in the phone's local time, so the picker needs no native module.

export interface CalendarDay {
  /** Local midnight, ms. */
  time: number;
  day: number;
  /** Belongs to the month on show (the grid pads with days of the months around it). */
  inMonth: boolean;
  isToday: boolean;
  /** Before today: can't be picked as an end date. */
  past: boolean;
}

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Weeks (Monday first) covering the month, 5 or 6 rows of 7 days. */
export function monthGrid(year: number, month: number, now: number = Date.now()): CalendarDay[][] {
  const today = startOfDay(now);
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - offset);
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      const time = d.getTime();
      week.push({ time, day: d.getDate(), inMonth: d.getMonth() === month, isToday: time === today, past: time < today });
    }
    // Stop once a whole row is in the next month.
    if (w >= 4 && week.every((d) => !d.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function monthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
}

/** The month before or after, as [year, month]. */
export function shiftMonth(year: number, month: number, by: number): [number, number] {
  const d = new Date(year, month + by, 1);
  return [d.getFullYear(), d.getMonth()];
}

export type EndTime = 'morning' | 'noon' | 'evening' | 'night';

export const END_TIMES: { value: EndTime; label: string; hour: number; minute: number }[] = [
  { value: 'morning', label: '9 AM', hour: 9, minute: 0 },
  { value: 'noon', label: '12 noon', hour: 12, minute: 0 },
  { value: 'evening', label: '6 PM', hour: 18, minute: 0 },
  { value: 'night', label: 'End of day', hour: 23, minute: 59 },
];

/** Epoch seconds for a picked day (local midnight, ms) at one of the end times. */
export function endsAt(dayTime: number, end: EndTime): number {
  const t = END_TIMES.find((x) => x.value === end) ?? END_TIMES[3];
  const d = new Date(dayTime);
  d.setHours(t.hour, t.minute, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Which end time and day a stored expiry matches; anything else reads as end of day. */
export function splitExpiry(expiresAt: number): { day: number; end: EndTime } {
  const d = new Date(expiresAt * 1000);
  const match = END_TIMES.find((x) => x.hour === d.getHours() && x.minute === d.getMinutes());
  return { day: startOfDay(d.getTime()), end: match?.value ?? 'night' };
}

/** True when the day at that end time is still ahead of now. */
export const isFutureEnd = (dayTime: number, end: EndTime, now: number = Date.now()): boolean => endsAt(dayTime, end) * 1000 > now;
