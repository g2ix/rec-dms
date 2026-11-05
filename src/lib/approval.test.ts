import { describe, expect, it } from "vitest";
import { statusForEmail } from "@/lib/approval";

describe("approval rule", () => {
  it("activates usc.edu.ph addresses and holds every other domain", () => {
    expect(statusForEmail("researcher@usc.edu.ph")).toBe("ACTIVE");
    expect(statusForEmail("researcher@dept.usc.edu.ph")).toBe("ACTIVE");
    expect(statusForEmail("researcher@gmail.com")).toBe("PENDING_APPROVAL");
    expect(statusForEmail("researcher@notusc.edu.ph")).toBe("PENDING_APPROVAL");
  });
});
