import { END_TIMES, endsAt, isFutureEnd, monthGrid, monthTitle, shiftMonth, splitExpiry } from '../calendar';

// Thursday 8 Oct 2026, 14:10 local time.
const NOW = new Date(2026, 9, 8, 14, 10, 0).getTime();
const day = (m: number, d: number) => new Date(2026, m, d).getTime();

test('a month grid starts on Monday and pads with the months around it', () => {
  const weeks = monthGrid(2026, 9, NOW);
  // 1 Oct 2026 is a Thursday: Mon 28 to Wed 30 Sep come first.
  expect(weeks[0].map((d) => d.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
  expect(weeks[0].slice(0, 3).every((d) => !d.inMonth)).toBe(true);
  expect(weeks.every((w) => w.length === 7)).toBe(true);
  // 31 Oct is a Saturday; the last row ends with Sun 1 Nov.
  expect(weeks[weeks.length - 1].map((d) => d.day)).toEqual([26, 27, 28, 29, 30, 31, 1]);
  expect(weeks).toHaveLength(5);
});

test('today is marked and days before it cannot be picked', () => {
  const days = monthGrid(2026, 9, NOW).flat();
  const today = days.filter((d) => d.isToday);
  expect(today).toHaveLength(1);
  expect(today[0].time).toBe(day(9, 8));
  expect(days.find((d) => d.time === day(9, 7))?.past).toBe(true);
  expect(days.find((d) => d.time === day(9, 8))?.past).toBe(false);
});

test('a month needing six rows gets six', () => {
  // August 2026 starts on a Saturday and has 31 days.
  expect(monthGrid(2026, 7, NOW)).toHaveLength(6);
});

test('months shift across years and read in words', () => {
  expect(shiftMonth(2026, 11, 1)).toEqual([2027, 0]);
  expect(shiftMonth(2026, 0, -1)).toEqual([2025, 11]);
  expect(monthTitle(2026, 9)).toBe('October 2026');
});

test('end times turn a picked day into an expiry and back', () => {
  expect(END_TIMES.map((x) => x.label)).toEqual(['9 AM', '12 noon', '6 PM', 'End of day']);
  const sixPm = endsAt(day(9, 15), 'evening');
  expect(new Date(sixPm * 1000)).toEqual(new Date(2026, 9, 15, 18, 0, 0));
  expect(splitExpiry(sixPm)).toEqual({ day: day(9, 15), end: 'evening' });
  expect(splitExpiry(endsAt(day(9, 15), 'night'))).toEqual({ day: day(9, 15), end: 'night' });
  // A time the picker doesn't offer reads as end of that day.
  expect(splitExpiry(new Date(2026, 9, 15, 10, 30).getTime() / 1000)).toEqual({ day: day(9, 15), end: 'night' });
});

test('an end time already past today is not in the future', () => {
  expect(isFutureEnd(day(9, 8), 'morning', NOW)).toBe(false);
  expect(isFutureEnd(day(9, 8), 'evening', NOW)).toBe(true);
});
