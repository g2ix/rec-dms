import { civilDaysBetween, shiftCivilDay } from "@/lib/reports/days";

/**
 * Meeting day of one panel, from the `meetings.schedule` setting:
 * `{ "default": rule?, "panels": { "<panel code>": rule } }` where a rule is
 * `{ "weekday": 0–6 (0 = Sunday), "week": 1–5 or -1 for the last, "cutoffDays": number }`.
 */
export type MeetingRule = { weekday: number; week: number; cutoffDays: number };
export type MeetingSchedule = { default?: MeetingRule; panels?: Record<string, MeetingRule> };

function isRule(value: unknown): value is MeetingRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  return (
    Number.isInteger(rule.weekday) &&
    (rule.weekday as number) >= 0 &&
    (rule.weekday as number) <= 6 &&
    Number.isInteger(rule.week) &&
    ((rule.week as number) === -1 || ((rule.week as number) >= 1 && (rule.week as number) <= 5)) &&
    Number.isInteger(rule.cutoffDays) &&
    (rule.cutoffDays as number) >= 0
  );
}

export function parseMeetingSchedule(value: unknown): MeetingSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: MeetingSchedule = {};
  if (isRule(raw.default)) out.default = raw.default;
  if (raw.panels && typeof raw.panels === "object" && !Array.isArray(raw.panels)) {
    const panels: Record<string, MeetingRule> = {};
    for (const [code, rule] of Object.entries(raw.panels as Record<string, unknown>)) if (isRule(rule)) panels[code] = rule;
    out.panels = panels;
  }
  return out;
}

/** The rule for a panel, falling back to the default. Null when the setting names no meeting day. */
export function ruleFor(schedule: MeetingSchedule, panelCode: string | null | undefined): MeetingRule | null {
  if (panelCode && schedule.panels?.[panelCode]) return schedule.panels[panelCode] ?? null;
  return schedule.default ?? null;
}

function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, date ?? 1)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The nth weekday of a month (week -1 is the last), or null when the month has no such day. Month is 1–12. */
export function nthWeekday(year: number, month: number, weekday: number, week: number): string | null {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  if (week === -1) {
    const last = shiftCivilDay(first, daysInMonth(year, month) - 1);
    const back = (weekdayOf(last) - weekday + 7) % 7;
    return shiftCivilDay(last, -back);
  }
  const offset = (weekday - weekdayOf(first) + 7) % 7;
  const date = 1 + offset + (week - 1) * 7;
  if (date > daysInMonth(year, month)) return null;
  return shiftCivilDay(first, offset + (week - 1) * 7);
}

/** The meeting on or after `day` under `rule`. */
export function nextMeeting(day: string, rule: MeetingRule): string {
  let [year, month] = day.split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 24; guard += 1) {
    const meeting = nthWeekday(year, month, rule.weekday, rule.week);
    if (meeting && meeting >= day) return meeting;
    if (month === 12) {
      year += 1;
      month = 1;
    } else month += 1;
  }
  throw new Error("No meeting day found within two years.");
}

export type MeetingAssignment = {
  meeting: string | null;
  missedCutoff: boolean;
};

/**
 * A full review whose documents were complete fewer than `cutoffDays` before the meeting moves
 * to the following meeting and keeps the flag. Without a rule there is no meeting to assign.
 */
export function assignMeeting(input: {
  completeDay: string | null;
  today: string;
  fullReview: boolean;
  rule: MeetingRule | null;
}): MeetingAssignment {
  if (!input.rule) return { meeting: null, missedCutoff: false };
  const rule = input.rule;
  let meeting = nextMeeting(input.today, rule);
  if (!input.fullReview || !input.completeDay) return { meeting, missedCutoff: false };
  let missedCutoff = false;
  while (civilDaysBetween(shiftCivilDay(meeting, -rule.cutoffDays), input.completeDay) > 0) {
    missedCutoff = true;
    meeting = nextMeeting(shiftCivilDay(meeting, 1), rule);
  }
  return { meeting, missedCutoff };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", [-1]: "Last" };

export function describeRule(rule: MeetingRule): string {
  return `${ORDINALS[rule.week] ?? rule.week} ${WEEKDAYS[rule.weekday] ?? ""} of the month, documents complete ${rule.cutoffDays} days before`;
}
