import { describe, expect, it } from "vitest";
import { addDuration, manilaDay, subtractDuration } from "@/lib/workflow/calendar";

const holidays = new Set(["2026-11-09", "2026-01-01"]);

describe("working-day calculator", () => {
  it("keeps Manila midnight on the Manila calendar day", () => {
    const midnight = new Date("2026-11-05T16:00:00.000Z");
    expect(manilaDay(midnight)).toBe("2026-11-06");
    const next = addDuration(midnight, 1, "CALENDAR_DAYS", holidays);
    expect(next.toISOString()).toBe("2026-11-06T16:00:00.000Z");
    expect(manilaDay(next)).toBe("2026-11-07");
  });

  it("skips weekends and holidays and crosses a month end", () => {
    const friday = new Date("2026-11-06T01:00:00.000Z");
    expect(manilaDay(friday)).toBe("2026-11-06");
    const monday = addDuration(friday, 1, "WORKING_DAYS", holidays);
    expect(manilaDay(monday)).toBe("2026-11-10");
    const monthEnd = new Date("2026-01-30T01:00:00.000Z");
    expect(manilaDay(addDuration(monthEnd, 1, "WORKING_DAYS", new Set(["2026-02-02"])))).toBe("2026-02-03");
    expect(manilaDay(addDuration(monthEnd, 1, "WORKING_DAYS", new Set()))).toBe("2026-02-02");
  });

  it("adds hours without skipping a weekend", () => {
    const fridayNight = new Date("2026-11-06T15:30:00.000Z");
    const due = addDuration(fridayNight, 5, "HOURS", holidays);
    expect(due.toISOString()).toBe("2026-11-06T20:30:00.000Z");
    expect(manilaDay(subtractDuration(due, 1, "WORKING_DAYS", holidays))).toBe("2026-11-06");
  });
});
