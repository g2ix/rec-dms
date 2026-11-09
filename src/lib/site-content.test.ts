import { describe, expect, it } from "vitest";
import { SUBMISSION_READY, SUBMISSION_STEPS } from "@/content/submission-checklist";
import { siteContent } from "@/lib/site-content";

describe("site content", () => {
  it("uses the dashboard submission stages and checklist", () => {
    expect(siteContent.how.steps).toBe(SUBMISSION_STEPS);
    expect(siteContent.prepare.ready).toBe(SUBMISSION_READY);
    expect(siteContent.how.steps.map((step) => step.name)).toEqual([
      "Prepare",
      "Submit",
      "Screening",
      "Review",
      "Decision",
    ]);
  });

  it("points the header anchors at the page sections", () => {
    expect(siteContent.nav.map((item) => item.id)).toEqual([
      siteContent.how.id,
      siteContent.prepare.id,
      siteContent.contact.id,
    ]);
  });
});
