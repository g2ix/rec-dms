import { isWorkingDay, manilaDay } from "@/lib/workflow/calendar";

const DAY_MS = 86_400_000;

/** Calendar days from the Manila date of `start` to the Manila date of `end`. */
export function calendarDaysBetween(start: Date, end: Date): number {
  return civilDaysBetween(manilaDay(start), manilaDay(end));
}

export function civilDaysBetween(startDay: string, endDay: string): number {
  const [ys, ms, ds] = startDay.split("-").map(Number);
  const [ye, me, de] = endDay.split("-").map(Number);
  const utcStart = Date.UTC(ys!, (ms ?? 1) - 1, ds ?? 1);
  const utcEnd = Date.UTC(ye!, (me ?? 1) - 1, de ?? 1);
  return Math.round((utcEnd - utcStart) / DAY_MS);
}

export function shiftCivilDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, (date ?? 1) + days)).toISOString().slice(0, 10);
}

/**
 * Working days from the Manila date of `now` until `due`.
 * A due date today is 0. A due date in the past is negative.
 */
export function workingDaysRemaining(due: Date, now: Date, holidays: ReadonlySet<string>): number {
  const start = manilaDay(now);
  const end = manilaDay(due);
  if (end === start) return 0;
  const forward = end > start;
  let count = 0;
  let cursor = forward ? start : end;
  const stop = forward ? end : start;
  while (cursor < stop) {
    cursor = shiftCivilDay(cursor, 1);
    if (isWorkingDay(cursor, holidays)) count += 1;
  }
  return forward ? count : -count;
}
