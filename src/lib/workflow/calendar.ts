import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { DurationUnit } from "@/lib/workflow/graph";

export const WORKFLOW_ZONE = "Asia/Manila";

/**
 * Adds a deadline to an instant.
 * Calendar days and working days keep the Manila clock time.
 * Working days skip Saturday, Sunday, and the holiday dates (yyyy-MM-dd in Manila).
 * A span that starts on a weekend or holiday still counts forward from that calendar day.
 */
export function addDuration(
  start: Date,
  amount: number,
  unit: DurationUnit,
  holidays: ReadonlySet<string>,
  zone = WORKFLOW_ZONE,
): Date {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("A duration amount must be a whole number of zero or more.");
  }
  if (unit === "HOURS") return new Date(start.getTime() + amount * 60 * 60 * 1000);
  const { day, time } = manilaParts(start, zone);
  if (unit === "CALENDAR_DAYS") return atDayTime(shiftDay(day, amount), time, zone);
  let cursor = day;
  for (let left = amount; left > 0; left -= 1) {
    cursor = shiftDay(cursor, 1);
    cursor = nextWorkingDay(cursor, holidays);
  }
  return atDayTime(cursor, time, zone);
}

/** The instant a reminder should run, counting backward with the same day rules. */
export function subtractDuration(
  start: Date,
  amount: number,
  unit: DurationUnit,
  holidays: ReadonlySet<string>,
  zone = WORKFLOW_ZONE,
): Date {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("A duration amount must be a whole number of zero or more.");
  }
  if (unit === "HOURS") return new Date(start.getTime() - amount * 60 * 60 * 1000);
  const { day, time } = manilaParts(start, zone);
  if (unit === "CALENDAR_DAYS") return atDayTime(shiftDay(day, -amount), time, zone);
  let cursor = day;
  for (let left = amount; left > 0; left -= 1) {
    cursor = shiftDay(cursor, -1);
    while (!isWorkingDay(cursor, holidays)) cursor = shiftDay(cursor, -1);
  }
  return atDayTime(cursor, time, zone);
}

export function manilaDay(date: Date, zone = WORKFLOW_ZONE): string {
  return formatInTimeZone(date, zone, "yyyy-MM-dd");
}

export function isWorkingDay(day: string, holidays: ReadonlySet<string>): boolean {
  const dow = weekday(day);
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(day);
}

function manilaParts(date: Date, zone: string): { day: string; time: string } {
  return {
    day: formatInTimeZone(date, zone, "yyyy-MM-dd"),
    time: formatInTimeZone(date, zone, "HH:mm:ss.SSS"),
  };
}

function atDayTime(day: string, time: string, zone: string): Date {
  return fromZonedTime(`${day}T${time}`, zone);
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, (date ?? 1) + days)).toISOString().slice(0, 10);
}

function weekday(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, date ?? 1)).getUTCDay();
}

function nextWorkingDay(day: string, holidays: ReadonlySet<string>): string {
  let cursor = day;
  while (!isWorkingDay(cursor, holidays)) cursor = shiftDay(cursor, 1);
  return cursor;
}
