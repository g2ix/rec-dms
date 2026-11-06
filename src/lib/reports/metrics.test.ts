import { describe, expect, it } from "vitest";
import { calendarDaysBetween } from "@/lib/reports/days";
import { median, nearestRank, summarizeTurnaround } from "@/lib/reports/metrics";
import { fromZonedTime } from "date-fns-tz";

function manilaNoon(day: string): Date {
  return fromZonedTime(`${day}T12:00:00`, "Asia/Manila");
}

describe("turnaround metrics", () => {
  it("uses the nearest rank and the mean of the two middle values", () => {
    expect(median([10, 28, 40])).toBe(28);
    expect(median([28, 40])).toBe(34);
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(nearestRank([28, 40], 90)).toBe(40);
  });

  it("matches a hand count of calendar days and the time limits", () => {
    // 1 Jan to 29 Jan is 28 days. 1 Jan to 10 Feb is 31 - 1 + 10 = 40 days.
    expect(calendarDaysBetween(manilaNoon("2026-01-01"), manilaNoon("2026-01-29"))).toBe(28);
    expect(calendarDaysBetween(manilaNoon("2026-01-01"), manilaNoon("2026-02-10"))).toBe(40);
    // 2 Mar to 20 Apr is (31 - 2) + 20 = 49 days. 2 Mar to 30 Apr is 29 + 30 = 59 days.
    expect(calendarDaysBetween(manilaNoon("2026-03-02"), manilaNoon("2026-04-20"))).toBe(49);
    expect(calendarDaysBetween(manilaNoon("2026-03-02"), manilaNoon("2026-04-30"))).toBe(59);

    const summary = summarizeTurnaround([
      { reviewType: "EXPEDITED", days: 28 },
      { reviewType: "EXPEDITED", days: 40 },
      { reviewType: "FULL", days: 49 },
      { reviewType: "FULL", days: 59 },
      { reviewType: "EXEMPT", days: 9 },
      { reviewType: "EXEMPT", days: 10 },
    ]);

    const expedited = summary.find((row) => row.reviewType === "EXPEDITED");
    const full = summary.find((row) => row.reviewType === "FULL");
    const exempt = summary.find((row) => row.reviewType === "EXEMPT");

    // Expedited limit 28: one of two is within. Median (28+40)/2 = 34. 90th rank of 2 is the 2nd value, 40.
    expect(expedited).toMatchObject({ limitDays: 28, count: 2, medianDays: 34, p90Days: 40, withinLimit: 1 });
    // Full limit 49: one of two is within. Median (49+59)/2 = 54. 90th is 59.
    expect(full).toMatchObject({ limitDays: 49, count: 2, medianDays: 54, p90Days: 59, withinLimit: 1 });
    // Exempt limit 9: one of two is within. Median (9+10)/2 = 9.5. 90th is 10.
    expect(exempt).toMatchObject({ limitDays: 9, count: 2, medianDays: 9.5, p90Days: 10, withinLimit: 1 });
  });
});
