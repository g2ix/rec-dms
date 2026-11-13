import { describe, expect, it } from "vitest";
import { resultHref } from "@/lib/action-result";

const id = "7b1f6f0e-2a53-4f0c-9d55-0c7a2f6f9a10";

describe("resultHref", () => {
  it("sends a form action to the protocol's Forms page", () => {
    expect(resultHref("form", id)).toBe(`/app/protocols/${id}/forms`);
  });

  it("keeps an Intake tab action (the one signature for F-27 and F-28) on the Intake tab", () => {
    expect(resultHref("intake", id)).toBe(`/app/protocols/${id}/intake`);
  });

  it("sends a whole-protocol action to the protocol page", () => {
    expect(resultHref("protocol", id)).toBe(`/app/protocols/${id}`);
  });

  it("sends a review task to My reviews", () => {
    expect(resultHref("review", id)).toBe("/app/reviews");
  });

  it("sends everything else to the protocol page", () => {
    expect(resultHref("other", id)).toBe(`/app/protocols/${id}`);
  });
});
