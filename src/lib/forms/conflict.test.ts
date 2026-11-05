import { describe, expect, it } from "vitest";
import { conflictResult } from "@/lib/forms/conflict";

describe("conflict detection", () => {
  it("returns nothing when the revision still matches", () => {
    expect(conflictResult(2, 2, "mine", { id: "u", name: "Juan D. Cruz" }, new Date("2026-11-05T08:00:00.000Z"))).toBeNull();
  });

  it("returns the stored value and who wrote the newer revision", () => {
    const conflict = conflictResult(1, 2, "their answer", { id: "u", name: "Juan D. Cruz" }, new Date("2026-11-05T08:00:00.000Z"));
    expect(conflict).toMatchObject({
      ok: false,
      code: "CONFLICT",
      revision: 2,
      value: "their answer",
      changedBy: { id: "u", name: "Juan D. Cruz" },
    });
    expect(conflict?.changedAt).toBe("2026-11-05T08:00:00.000Z");
  });
});
