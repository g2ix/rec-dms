import { civilDaysBetween, shiftCivilDay } from "@/lib/reports/days";

/** Full review must reach complete documents at least this many calendar days before the meeting. */
export const FULL_REVIEW_CUTOFF_DAYS = 14;

function weekday(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, date ?? 1)).getUTCDay();
}

/** The second Friday of a calendar month, as yyyy-MM-dd. Month is 1–12. */
export function secondFriday(year: number, month: number): string {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const offset = (5 - weekday(first) + 7) % 7;
  return shiftCivilDay(first, offset + 7);
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** The second Friday on or after `day`. */
export function nextSecondFriday(day: string): string {
  const [year, month] = day.split("-").map(Number);
  let cursorYear = year!;
  let cursorMonth = month!;
  let meeting = secondFriday(cursorYear, cursorMonth);
  if (meeting < day) {
    const next = nextMonth(cursorYear, cursorMonth);
    cursorYear = next.year;
    cursorMonth = next.month;
    meeting = secondFriday(cursorYear, cursorMonth);
  }
  return meeting;
}

export type MeetingAssignment = {
  meeting: string;
  missedCutoff: boolean;
};

/**
 * Full-review protocols that miss the 14-day cutoff move to the following second Friday
 * and keep the flag. Other protocols stay on the next second Friday from today.
 */
export function assignMeeting(input: {
  completeDay: string | null;
  today: string;
  fullReview: boolean;
}): MeetingAssignment {
  let meeting = nextSecondFriday(input.today);
  if (!input.fullReview || !input.completeDay) return { meeting, missedCutoff: false };
  let missedCutoff = false;
  while (civilDaysBetween(shiftCivilDay(meeting, -FULL_REVIEW_CUTOFF_DAYS), input.completeDay) > 0) {
    missedCutoff = true;
    meeting = nextSecondFriday(shiftCivilDay(meeting, 1));
  }
  return { meeting, missedCutoff };
}
