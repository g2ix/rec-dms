import { describe, expect, it } from "vitest";
import { assignMeeting, nextMeeting, nthWeekday, parseMeetingSchedule, ruleFor } from "@/lib/reports/meetings";

const secondFriday = { weekday: 5, week: 2, cutoffDays: 14 };

describe("meeting days", () => {
  it("finds the nth weekday of a month", () => {
    // 1 Nov 2026 is a Sunday, so the Fridays are 6, 13, 20, and 27.
    expect(nthWeekday(2026, 11, 5, 1)).toBe("2026-11-06");
    expect(nthWeekday(2026, 11, 5, 2)).toBe("2026-11-13");
    expect(nthWeekday(2026, 11, 5, 3)).toBe("2026-11-20");
    expect(nthWeekday(2026, 11, 5, -1)).toBe("2026-11-27");
    expect(nthWeekday(2026, 11, 5, 5)).toBeNull();
    // 1 Dec 2026 is a Tuesday, so the Fridays are 4, 11, 18, and 25.
    expect(nthWeekday(2026, 12, 5, 2)).toBe("2026-12-11");
    expect(nextMeeting("2026-11-06", secondFriday)).toBe("2026-11-13");
    expect(nextMeeting("2026-11-13", secondFriday)).toBe("2026-11-13");
    expect(nextMeeting("2026-11-14", secondFriday)).toBe("2026-12-11");
  });

  it("reads a rule per panel and falls back to the default", () => {
    const schedule = parseMeetingSchedule({
      default: secondFriday,
      panels: { P1: { weekday: 5, week: 1, cutoffDays: 14 }, P3: { weekday: 5, week: 3, cutoffDays: 10 }, BAD: { weekday: 9 } },
    });
    expect(ruleFor(schedule, "P1")).toEqual({ weekday: 5, week: 1, cutoffDays: 14 });
    expect(ruleFor(schedule, "P2")).toEqual(secondFriday);
    expect(ruleFor(schedule, "BAD")).toEqual(secondFriday);
    expect(ruleFor(parseMeetingSchedule(null), "P1")).toBeNull();
  });

  it("flags a full review that misses the cutoff and moves it to the next meeting", () => {
    expect(assignMeeting({ completeDay: "2026-10-20", today: "2026-11-06", fullReview: true, rule: secondFriday })).toEqual({
      meeting: "2026-11-13",
      missedCutoff: false,
    });
    expect(assignMeeting({ completeDay: "2026-11-01", today: "2026-11-06", fullReview: true, rule: secondFriday })).toEqual({
      meeting: "2026-12-11",
      missedCutoff: true,
    });
    expect(assignMeeting({ completeDay: "2026-10-20", today: "2026-11-20", fullReview: true, rule: secondFriday })).toEqual({
      meeting: "2026-12-11",
      missedCutoff: false,
    });
    expect(assignMeeting({ completeDay: "2026-11-01", today: "2026-11-06", fullReview: false, rule: secondFriday })).toEqual({
      meeting: "2026-11-13",
      missedCutoff: false,
    });
    expect(assignMeeting({ completeDay: "2026-11-01", today: "2026-11-06", fullReview: true, rule: null })).toEqual({
      meeting: null,
      missedCutoff: false,
    });
  });
});
