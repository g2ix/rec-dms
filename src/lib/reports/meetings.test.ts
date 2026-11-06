import { describe, expect, it } from "vitest";
import { assignMeeting, nextSecondFriday, secondFriday } from "@/lib/reports/meetings";

describe("meeting Fridays", () => {
  it("finds the second Friday", () => {
    // 1 Nov 2026 is a Sunday, so the Fridays are 6, 13, 20, and 27.
    expect(secondFriday(2026, 11)).toBe("2026-11-13");
    // 1 Dec 2026 is a Tuesday, so the Fridays are 4, 11, 18, and 25.
    expect(secondFriday(2026, 12)).toBe("2026-12-11");
    expect(nextSecondFriday("2026-11-06")).toBe("2026-11-13");
    expect(nextSecondFriday("2026-11-13")).toBe("2026-11-13");
    expect(nextSecondFriday("2026-11-14")).toBe("2026-12-11");
  });

  it("flags a full review that misses the 14-day cutoff and moves it to the next meeting", () => {
    // 13 Nov minus 14 days is 30 Oct. 20 Oct is in time for 13 Nov.
    expect(assignMeeting({ completeDay: "2026-10-20", today: "2026-11-06", fullReview: true })).toEqual({
      meeting: "2026-11-13",
      missedCutoff: false,
    });
    // 1 Nov is after 30 Oct, so the protocol waits for 11 Dec and is flagged.
    expect(assignMeeting({ completeDay: "2026-11-01", today: "2026-11-06", fullReview: true })).toEqual({
      meeting: "2026-12-11",
      missedCutoff: true,
    });
    // A past meeting that was in time does not keep the flag on the following Friday.
    expect(assignMeeting({ completeDay: "2026-10-20", today: "2026-11-20", fullReview: true })).toEqual({
      meeting: "2026-12-11",
      missedCutoff: false,
    });
    expect(assignMeeting({ completeDay: "2026-11-01", today: "2026-11-06", fullReview: false })).toEqual({
      meeting: "2026-11-13",
      missedCutoff: false,
    });
  });
});
